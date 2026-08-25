#!/usr/bin/env python3
"""
homelab-ctl-mcp — MCP server for homelab service lifecycle.

Exposes verbs (status/up/stop/restart/pull/update/logs) as MCP tools, backed by
ctl/registry.py compose operations. Runs as a systemd user unit alongside the
FastAPI dashboard.

Deployment:
  - systemd unit: deploy/homelab-ctl-mcp.service
  - binds 0.0.0.0:8790 (streamable HTTP, path /mcp)
  - bearer-token auth: CTL_MCP_TOKEN env var (fail-closed)
  - scoped ufw rule allows from 172.16.0.0/12 (Docker bridges)

Security:
  - Dirty-repo gate blocks mutating verbs when `git status --porcelain` != ""
  - Per-sid asyncio locks serialize concurrent operations on the same service
  - Capability discovery exposes a compact catalog without app credentials
"""

import os
import sys
import json
import secrets
import asyncio
import subprocess
import time
from pathlib import Path
from typing import Optional

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount

from mcp.server.fastmcp import FastMCP

# Fail-closed auth: CTL_MCP_TOKEN must be set
CTL_MCP_TOKEN = os.environ.get("CTL_MCP_TOKEN")
if not CTL_MCP_TOKEN:
    print("ERROR: CTL_MCP_TOKEN environment variable not set. Refusing to start.", file=sys.stderr)
    sys.exit(1)

# Port can be overridden for testing
PORT = int(os.environ.get("CTL_MCP_PORT", "8790"))

# Import registry (loads services.yaml at import time)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ctl import registry
from ctl.catalog import discover_capabilities as match_capabilities, discover_workflows as match_workflows, policy_decision

# Per-sid locks for serialization
_locks: dict[str, asyncio.Lock] = {}

MUTATING_VERBS = {"up", "stop", "restart", "pull", "update"}
DENIED_SIDS: set[str] = set()


class BearerAuthMiddleware(BaseHTTPMiddleware):
    """Require Authorization: Bearer <CTL_MCP_TOKEN> on all paths."""

    async def dispatch(self, request: Request, call_next):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse({"error": "Missing or invalid Authorization header"}, status_code=401)
        token = auth.split(" ", 1)[1]
        if not secrets.compare_digest(token, CTL_MCP_TOKEN):
            return JSONResponse({"error": "Invalid token"}, status_code=401)
        return await call_next(request)


def _run_compose(service: dict, args: list[str], timeout: int) -> tuple[int, str]:
    """Run docker compose command, capture stdout/stderr, return rc and truncated output."""
    cmd = registry.base_cmd(service) + args
    cwd = registry.ROOT / service["dir"]
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, out[-4000:]


async def _run_verb(sid: str, args: list[str], timeout: int) -> tuple[int, str]:
    """Execute a compose verb with guards: unknown sid, denied sid, dirty repo, per-sid lock."""
    if sid not in registry.SVCS:
        available = ", ".join(sorted(registry.SVCS.keys()))
        return 1, f"Unknown service: {sid}. Available: {available}"

    if args[0] in MUTATING_VERBS:
        if sid in DENIED_SIDS:
            return 1, f"Mutating verb '{args[0]}' denied for '{sid}' (self-lockout protection)."
        # Dirty-repo gate
        git_status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=registry.ROOT,
            capture_output=True,
            text=True,
        )
        if git_status.stdout.strip():
            dirty = git_status.stdout.strip().splitlines()[:10]
            return 1, (
                "Dirty repo — commit or stash before deploying.\n"
                f"First {len(dirty)} dirty paths:\n" + "\n".join(dirty)
            )

    # Per-sid lock
    lock = _locks.setdefault(sid, asyncio.Lock())
    async with lock:
        return await asyncio.to_thread(_run_compose, registry.SVCS[sid], args, timeout)


# FastMCP server
mcp = FastMCP("homelab-ctl")


@mcp.tool()
async def discover_app_capabilities(task: str) -> str:
    """Return a compact, risk-labelled app capability shortlist for a task.

    Call this before selecting an app MCP server. It intentionally returns
    capability names and narrow tool identifiers rather than every tool schema.
    """
    matches = match_capabilities(task)
    return json.dumps({"task": task, "matches": matches}, separators=(",", ":"))


@mcp.tool()
async def discover_app_workflows(task: str) -> str:
    """Return a compact shortlist of cross-app workflow designs for a task."""
    matches = match_workflows(task)
    return json.dumps({"task": task, "matches": matches}, separators=(",", ":"))


@mcp.tool()
async def evaluate_capability_risk(risk: str) -> str:
    """Evaluate OmniLab's portable default policy for a capability risk tier."""
    return json.dumps({"risk": risk, **policy_decision(risk)}, separators=(",", ":"))


@mcp.tool()
async def status_all() -> str:
    """Get status of all registered services (docker compose ps)."""
    parts = []
    for s in registry.SERVICES:
        rc, out = await _run_verb(s["id"], ["ps"], 30)
        parts.append(f"=== {s['id']} (rc={rc}) ===\n{out}")
    return "\n".join(parts)


@mcp.tool()
async def svc_status(service_id: str) -> str:
    """Get status of a single service (docker compose ps)."""
    rc, out = await _run_verb(service_id, ["ps"], 30)
    return f"rc={rc}\n{out}"


@mcp.tool()
async def svc_up(service_id: str) -> str:
    """Start a service (docker compose up -d)."""
    rc, out = await _run_verb(service_id, ["up", "-d"], 300)
    return f"rc={rc}\n{out}"


@mcp.tool()
async def svc_stop(service_id: str) -> str:
    """Stop a service (docker compose stop)."""
    timeout = int(registry.SETTINGS.get("compose_timeout_stop", 120)) + 30
    rc, out = await _run_verb(service_id, ["stop"], timeout)
    return f"rc={rc}\n{out}"


@mcp.tool()
async def svc_restart(service_id: str) -> str:
    """Restart a service (stop then up -d)."""
    timeout = int(registry.SETTINGS.get("compose_timeout_stop", 120)) + 30
    rc1, out1 = await _run_verb(service_id, ["stop"], timeout)
    if rc1 != 0:
        return f"stop rc={rc1}\n{out1}"
    rc2, out2 = await _run_verb(service_id, ["up", "-d"], 300)
    return f"stop rc={rc1}\n{out1}\n\nup rc={rc2}\n{out2}"


@mcp.tool()
async def svc_pull(service_id: str) -> str:
    """Pull latest images for a service (docker compose pull)."""
    rc, out = await _run_verb(service_id, ["pull"], 300)
    return f"rc={rc}\n{out}"


@mcp.tool()
async def svc_update(service_id: str) -> str:
    """Pull and restart a service (docker compose pull && up -d)."""
    rc1, out1 = await _run_verb(service_id, ["pull"], 300)
    if rc1 != 0:
        return f"pull rc={rc1}\n{out1}"
    rc2, out2 = await _run_verb(service_id, ["up", "-d"], 300)
    return f"pull rc={rc1}\n{out1}\n\nup rc={rc2}\n{out2}"


@mcp.tool()
async def svc_logs(service_id: str, tail: int = 100) -> str:
    """Get recent logs for a service (docker compose logs --tail N)."""
    tail = max(1, min(int(tail), 500))
    rc, out = await _run_verb(service_id, ["logs", "--tail", str(tail)], 30)
    return f"rc={rc}\n{out}"


# Wrap with auth middleware
app = Starlette(routes=[Mount("/", mcp.streamable_http_app())], middleware=[Middleware(BearerAuthMiddleware)])


if __name__ == "__main__":
    import uvicorn
    print(f"Starting homelab-ctl-mcp on 0.0.0.0:{PORT} (streamable HTTP, path /mcp)", file=sys.stderr)
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")

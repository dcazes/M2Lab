import asyncio
import base64
import json
import os
import re
import secrets
import select
import sqlite3
import subprocess
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree

import docker
import psutil
import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .compose import run_compose
from .catalog import discover_capabilities, load_catalog, policy_decision
from .initiate import AUTOMATED_SERVICES, prepare_environment
from .identity import app_inventory as identity_app_inventory, status as identity_status, verify_app as verify_identity_app
from .mcp_registry import (
    harness_preview, mark_verified, registry_snapshot, update_server,
    write_harness_exports,
)
from .registry import ROOT, SERVICES, service_by_id, SETTINGS
from .setup_jobs import create_job, get_job, list_jobs, recover_interrupted_jobs, update_job

DLI = docker.DockerClient.from_env()
API = DLI.api

app = FastAPI(title="homelab-ctl", docs_url=None, redoc_url=None)

# ---------- per-service action mutex ----------
_action_locks: dict[str, asyncio.Lock] = {}
_audit_lock = asyncio.Lock()
_approvals: dict[str, dict] = {}
_APPROVAL_TTL = 120
_setup_tasks: dict[str, asyncio.Task] = {}
recover_interrupted_jobs()
_STATE_DIR = ROOT / ".state"
_AUDIT_PATH = _STATE_DIR / "audit.jsonl"
_CALENDAR_CONNECTION_PATH = _STATE_DIR / "nextcloud-calendar.json"
_IDENTITY_KEYS = ("OMNILAB_IDENTITY_EMAIL", "OMNILAB_IDENTITY_PASSWORD")

_PROVIDER_LABELS = {
    "cerebras": "Cerebras",
    "cohere": "Cohere",
    "google": "Google Gemini",
    "groq": "Groq",
    "huggingface": "Hugging Face",
    "mistral": "Mistral",
    "nvidia": "NVIDIA NIM",
    "openrouter": "OpenRouter",
    "together": "Together AI",
    "zhipu": "Zhipu AI",
}
_LITELLM_PROVIDER_KEYS = {
    "NVIDIA_NIM_API_KEY": "NVIDIA NIM",
    "GEMINI_API_KEY": "Google Gemini",
    "HUGGINGFACE_API_KEY": "Hugging Face",
    "MISTRAL_API_KEY": "Mistral",
    "OPENAI_API_KEY": "OpenAI",
}

# ---------- TTL cache for HTTP health probes ----------
_health_cache: dict[str, tuple[bool | None, float]] = {}
_HEALTH_TTL = 10.0  # seconds


def _cached_http_health(sid: str, probe_fn) -> bool | None:
    now = time.time()
    if sid in _health_cache:
        result, ts = _health_cache[sid]
        if now - ts < _HEALTH_TTL:
            return result
    result = probe_fn()
    _health_cache[sid] = (result, now)
    return result


# During the staged rollout the dashboard remains tailnet-only. Once Caddy has
# been tested, OMNILAB_REQUIRE_IDENTITY=true makes every mutation require the
# Authentik identity headers plus the local Caddy-to-dashboard shared token.


# ---------- helpers ----------
def project_containers(project: str, all_=True):
    return DLI.containers.list(all=all_, filters={"label": f"com.docker.compose.project={project}"})


def svc_state(s: dict) -> dict:
    ignored = set(s.get("ignore_containers", []))
    rows = []
    for c in project_containers(s["project"]):
        name = c.attrs["Name"].lstrip("/")
        labels = c.labels or {}
        if labels.get("com.docker.compose.service") in ignored:
            continue
        rows.append({
            "container": name,
            "service": labels.get("com.docker.compose.service"),
            "state": c.attrs["State"]["Status"],
            "health": (c.attrs["State"].get("Health") or {}).get("Status"),
        })
    if not rows:
        overall = "absent"
    elif any(row["state"] in {"restarting", "dead", "removing"} for row in rows):
        overall = "degraded"
    elif all(row["state"] == "running" for row in rows) and not any(
        row["health"] in {"starting", "unhealthy"} for row in rows
    ):
        overall = "running"
    elif all(row["state"] in {"created", "exited"} for row in rows):
        overall = "stopped"
    else:
        overall = "degraded"
    return {"overall": overall, "containers": rows}


def _docker_available() -> bool:
    try:
        return bool(DLI.ping())
    except Exception:
        return False


def _tailscale_snapshot() -> dict:
    """Return only the small, non-sensitive subset needed by the dashboard."""
    try:
        result = subprocess.run(
            ["tailscale", "status", "--json"], capture_output=True, text=True, timeout=5, check=False,
        )
        if result.returncode != 0:
            return {"installed": True, "connected": False, "hostname": None, "serve_ports": []}
        payload = json.loads(result.stdout)
        self_node = payload.get("Self") or {}
        connected = payload.get("BackendState") == "Running" and bool(self_node.get("Online", True))
    except FileNotFoundError:
        return {"installed": False, "connected": False, "hostname": None, "serve_ports": []}
    except Exception:
        return {"installed": True, "connected": False, "hostname": None, "serve_ports": []}

    ports: list[int] = []
    try:
        served = subprocess.run(
            ["tailscale", "serve", "status", "--json"], capture_output=True, text=True, timeout=5, check=False,
        )
        if served.returncode == 0:
            config = json.loads(served.stdout)
            ports = sorted(int(port) for port in (config.get("TCP") or {}) if str(port).isdigit())
    except Exception:
        pass
    return {
        "installed": True,
        "connected": connected,
        "hostname": self_node.get("HostName"),
        "serve_ports": ports,
    }


def _tailscale_serve_proxies() -> dict[int, str]:
    try:
        result = subprocess.run(
            ["tailscale", "serve", "status", "--json"], capture_output=True, text=True, timeout=5, check=False,
        )
        if result.returncode != 0:
            return {}
        payload = json.loads(result.stdout)
    except Exception:
        return {}
    proxies: dict[int, str] = {}
    for host, web in (payload.get("Web") or {}).items():
        try:
            port = int(host.rsplit(":", 1)[-1]) if ":" in host else 443
        except ValueError:
            continue
        for handler in (web.get("Handlers") or {}).values():
            if handler.get("Proxy"):
                proxies[port] = str(handler["Proxy"])
                break
    return proxies


def request_source(request: Request) -> str:
    """Classify request origin: 'local', 'tailnet', or 'other'."""
    ip = request.client.host if request.client else "unknown"
    if ip.startswith("127."):
        return "local"
    if ip.startswith("100."):
        return "tailnet"
    return f"other:{ip}"


def require_trusted_request(request: Request) -> None:
    """Reject control-plane mutations from outside loopback/Tailscale."""
    if request_source(request).startswith("other:"):
        raise HTTPException(403, "Control actions are restricted to localhost or the tailnet")
    # The loopback listener is the documented owner-only break-glass path.
    # It never leaves the host; all tailnet traffic must traverse Caddy once
    # enforcement is enabled.
    if (os.environ.get("OMNILAB_REQUIRE_IDENTITY", "false").lower() == "true"
            and request_source(request) != "local" and not request_identity(request)):
        raise HTTPException(401, "Sign in through the Authentik-protected M2Lab URL")


def request_identity(request: Request) -> dict | None:
    """Accept identity only from the Caddy hop, never from browser headers."""
    expected = os.environ.get("OMNILAB_INGRESS_TOKEN", "")
    if not expected or not secrets.compare_digest(request.headers.get("X-M2Lab-Ingress", ""), expected):
        return None
    subject = request.headers.get("X-Authentik-Uid", "").strip()
    email = request.headers.get("X-Authentik-Email", "").strip()
    if not subject or not email:
        return None
    groups = [group.strip() for group in request.headers.get("X-Authentik-Groups", "").split(",") if group.strip()]
    return {"subject": subject, "email": email, "groups": groups}


async def audit_event(request: Request, event: str, **fields) -> None:
    """Append a secret-free, local audit record for state-changing actions."""
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "source": request_source(request),
        **fields,
    }
    identity = request_identity(request)
    if identity:
        record["actor"] = {"subject": identity["subject"], "email": identity["email"]}
    async with _audit_lock:
        _STATE_DIR.mkdir(mode=0o700, exist_ok=True)
        with _AUDIT_PATH.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, separators=(",", ":")) + "\n")


def _consume_approval(request: Request, token: str | None, sid: str, action: str) -> None:
    approval = _approvals.pop(token, None) if token else None
    if not approval or approval["expires_at"] < time.time():
        raise HTTPException(403, "A fresh explicit approval is required")
    if approval["service_id"] != sid or approval["action"] != action:
        raise HTTPException(403, "Approval does not match this action")
    identity = request_identity(request)
    if approval.get("subject") and (not identity or approval["subject"] != identity["subject"]):
        raise HTTPException(403, "Approval belongs to a different signed-in user")


def http_health(s: dict) -> bool | None:
    h = s.get("health") or {}
    if h.get("mode") != "http":
        return None
    try:
        with urllib.request.urlopen(h["url"], timeout=2) as r:
            return r.status == h.get("expect", 200)
    except Exception:
        return False


# ---------- API ----------
@app.get("/api/catalog")
async def get_catalog():
    return load_catalog()


@app.get("/api/capabilities")
async def get_capabilities(query: str = ""):
    return {"query": query, "matches": discover_capabilities(query)}


@app.post("/api/policy/evaluate")
async def evaluate_policy(request: Request):
    body = await request.json()
    risk = str(body.get("risk", "privileged"))
    return {"risk": risk, **policy_decision(risk)}


@app.post("/api/approvals")
async def create_approval(request: Request):
    require_trusted_request(request)
    body = await request.json()
    sid = str(body.get("service_id", ""))
    action = str(body.get("action", ""))
    if action not in {"up", "stop", "restart", "pull", "update", "mcp-edit", "mcp-verify", "mcp-sync", "setup-start", "setup-resume", "model-wire", "model-pull"}:
        raise HTTPException(400, "Unknown approval action")
    if action.startswith("mcp-"):
        known = {item["id"] for item in registry_snapshot()["servers"]} | {"registry"}
        if sid not in known:
            raise HTTPException(404, "Unknown MCP server")
    elif action.startswith("setup-"):
        if sid != "foundation":
            service_by_id(sid)
    elif action == "model-wire":
        if sid != "models":
            raise HTTPException(400, "model-wire approval must target 'models'")
    elif action == "model-pull":
        if sid != "ollama":
            raise HTTPException(400, "model-pull approval must target 'ollama'")
    else:
        service_by_id(sid)
    if body.get("confirm") != f"{action}:{sid}":
        raise HTTPException(400, "Approval confirmation does not match")
    token = secrets.token_urlsafe(24)
    identity = request_identity(request)
    _approvals[token] = {"service_id": sid, "action": action, "expires_at": time.time() + _APPROVAL_TTL,
                         "subject": identity["subject"] if identity else None}
    await audit_event(request, "approval.granted", service_id=sid, action=action)
    return {"token": token, "expires_in": _APPROVAL_TTL}


@app.get("/api/audit")
async def list_audit(limit: int = 50):
    limit = max(1, min(limit, 200))
    if not _AUDIT_PATH.exists():
        return {"events": []}
    lines = _AUDIT_PATH.read_text(encoding="utf-8").splitlines()[-limit:]
    events = [json.loads(line) for line in reversed(lines) if line.strip()]
    return {"events": events}


@app.get("/api/identity/status")
async def get_identity_status(request: Request):
    require_trusted_request(request)
    states = await asyncio.to_thread(_service_state_map)
    result = identity_status(states)
    result["enforced"] = os.environ.get("OMNILAB_REQUIRE_IDENTITY", "false").lower() == "true"
    identity = request_identity(request)
    result["signed_in"] = {"email": identity["email"], "groups": identity["groups"]} if identity else None
    return result


@app.get("/api/identity/apps")
async def get_identity_apps(request: Request):
    require_trusted_request(request)
    states = await asyncio.to_thread(_service_state_map)
    return {"apps": identity_app_inventory(states)}


@app.post("/api/identity/apps/{sid}/verify")
async def verify_identity_application(sid: str, request: Request):
    require_trusted_request(request)
    try:
        result = await asyncio.to_thread(verify_identity_app, sid, _service_state_map())
    except KeyError:
        raise HTTPException(404, "Unknown identity application") from None
    await audit_event(request, "identity.verify", service_id=sid, result=result["verification"])
    return result


@app.get("/api/services")
async def list_services(request: Request):
    tailnet_base = SETTINGS.get("tailnet_base", "")
    src = request_source(request)
    loop = asyncio.get_event_loop()

    # First pass: gather container state OFF the event loop — the docker SDK
    # does blocking socket calls, and inline execution here stalls every other
    # request (system polls, actions) for the duration, which reads as UI stutter.
    states, serve_proxies = await asyncio.gather(
        loop.run_in_executor(None, lambda: {s["id"]: svc_state(s) for s in SERVICES}),
        loop.run_in_executor(None, _tailscale_serve_proxies),
    )

    service_data = []
    for s in SERVICES:
        st = states[s["id"]]
        tailnet_port = s.get("tailnet_port")
        tailnet_path = s.get("tailnet_path", "")
        tailnet_url = f"{tailnet_base}:{tailnet_port}{tailnet_path}/" if tailnet_base and tailnet_port else None
        service_data.append({
            "id": s["id"],
            "display_name": s["display_name"],
            "description": s.get("description"),
            "category": s.get("category"),
            "role": s.get("role", "application"),
            "visibility": s.get("visibility", "user"),
            "lifecycle": s.get("lifecycle", "managed"),
            "icon": s.get("icon", "📦"),
            "port": s.get("port"),
            "url": s.get("url"),
            "tailnet_url": tailnet_url,
            "tailnet_route_active": tailnet_port in serve_proxies if tailnet_port else None,
            "tailnet_proxy": serve_proxies.get(tailnet_port) if tailnet_port else None,
            "state": st["overall"],
            "containers": st["containers"],
            "_health_probe": s,  # keep reference for health check
        })
    
    # Second pass: parallel HTTP health probes with TTL cache

    async def probe_health(svc):
        s = svc["_health_probe"]
        sid = s["id"]
        def do_probe():
            return http_health(s)
        healthy = await loop.run_in_executor(None, lambda: _cached_http_health(sid, do_probe))
        svc["healthy"] = healthy
        if healthy is False and svc["state"] == "running":
            svc["state"] = "degraded"
        svc["external_ready"] = bool(
            svc["state"] == "running"
            and healthy is not False
            and (svc["tailnet_route_active"] is not False)
        )
        del svc["_health_probe"]
    
    await asyncio.gather(*[probe_health(svc) for svc in service_data])
    
    return {"services": service_data, "source": src}


def _service_state_map() -> dict[str, str]:
    return {service["id"]: svc_state(service)["overall"] for service in SERVICES}


def _ollama_models() -> list[dict]:
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=2) as response:
            payload = json.load(response)
    except (OSError, ValueError, urllib.error.URLError):
        return []
    models = payload.get("models", []) if isinstance(payload, dict) else []
    return [
        {
            "name": str(model.get("name") or model.get("model") or "").strip(),
            "size": int(model.get("size") or 0),
            "modified_at": model.get("modified_at"),
        }
        for model in models
        if isinstance(model, dict) and (model.get("name") or model.get("model"))
    ]


def _pull_ollama_model(model_name: str = "nomic-embed-text") -> bool:
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:11434/api/pull",
            data=json.dumps({"name": model_name, "stream": False}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            return resp.status == 200
    except Exception:
        return False


@app.post("/api/models/ollama/pull")
async def pull_ollama_embedding(request: Request):
    require_trusted_request(request)
    _consume_approval(request, request.headers.get("X-M2Lab-Approval"), "ollama", "model-pull")
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    model_name = str(body.get("model", "nomic-embed-text")).strip()
    loop = asyncio.get_event_loop()
    success = await loop.run_in_executor(None, lambda: _pull_ollama_model(model_name))
    await audit_event(request, "ollama.model_pull", model=model_name, success=success)
    return {"ok": success, "model": model_name}


@app.post("/api/model-access/wire")
async def wire_model_pipeline(request: Request):
    """Wire API keys into LiteLLM, trigger Ollama embedding pull, and wire open-webui/surfsense."""
    require_trusted_request(request)
    _consume_approval(request, request.headers.get("X-M2Lab-Approval"), "models", "model-wire")
    try:
        body = await request.json()
    except json.JSONDecodeError:
        body = {}

    keys_to_update = {}
    for key_name in ("NVIDIA_NIM_API_KEY", "GEMINI_API_KEY", "HUGGINGFACE_API_KEY", "MISTRAL_API_KEY", "OPENAI_API_KEY"):
        val = str(body.get(key_name, "")).strip()
        if val:
            keys_to_update[key_name] = val

    litellm_path = _env_path("litellm")
    current_litellm = _parse_env_file(litellm_path)
    current_litellm.update(keys_to_update)
    _write_env_file(litellm_path, current_litellm)

    # Sync gateway key if FreeLLMAPI is configured
    _sync_freellmapi_gateway()

    # Apply wiring to Open WebUI and SurfSense .env files
    for sid in ("open-webui", "surfsense"):
        if (ROOT / service_by_id(sid)["dir"] / ".env.example").exists():
            env_file = _env_path(sid)
            curr = _parse_env_file(env_file)
            _apply_automatic_model_wiring(sid, curr)
            _write_env_file(env_file, curr)

    # Pull nomic-embed-text if requested
    pull_embed = bool(body.get("pull_embedding", True))
    embed_status = "skipped"
    if pull_embed:
        if svc_state(service_by_id("ollama"))["overall"] == "running":
            loop = asyncio.get_event_loop()
            embed_ok = await loop.run_in_executor(None, lambda: _pull_ollama_model("nomic-embed-text"))
            embed_status = "pulled" if embed_ok else "failed"
        else:
            embed_status = "skipped"  # Ollama not running — nothing was pulled

    await audit_event(request, "models.pipeline_wired", configured_keys=list(keys_to_update.keys()), embedding_pulled=embed_status == "pulled")
    return {
        "ok": True,
        "configured_keys": list(keys_to_update.keys()),
        "embedding_status": embed_status,
    }


@app.get("/api/model-access")
async def get_model_access(request: Request):
    """Safe model-routing inventory. Provider and gateway secrets never leave the host."""
    require_trusted_request(request)
    states, free_providers, ollama_models = await asyncio.gather(
        asyncio.to_thread(_service_state_map),
        asyncio.to_thread(_freellmapi_providers),
        asyncio.to_thread(_ollama_models),
    )
    litellm_values = _parse_env_file(_env_path("litellm"))
    gateway_key = _freellmapi_gateway_key()
    configured_gateway = litellm_values.get("FREE_LLMAPI_API_KEY", "")
    direct_providers = [
        {"id": key, "name": name, "configured": bool(litellm_values.get(key, "").strip())}
        for key, name in _LITELLM_PROVIDER_KEYS.items()
    ]
    return {
        "services": {sid: states.get(sid, "absent") for sid in ("freellmapi", "ollama", "litellm")},
        "gateway": {
            "available": bool(gateway_key),
            "wired": bool(gateway_key and configured_gateway == gateway_key),
        },
        "free_providers": free_providers,
        "direct_providers": direct_providers,
        "ollama_models": ollama_models,
    }


@app.get("/api/mcp/servers")
async def list_mcp_servers(request: Request, verify: bool = False):
    require_trusted_request(request)
    loop = asyncio.get_event_loop()
    states = await loop.run_in_executor(None, _service_state_map)
    return await loop.run_in_executor(None, lambda: registry_snapshot(states, verify=verify))


@app.get("/api/mcp/servers/{server_id}/tools")
async def list_mcp_tools(server_id: str, request: Request):
    require_trusted_request(request)
    snapshot = registry_snapshot(_service_state_map(), verify=False)
    server = next((item for item in snapshot["servers"] if item["id"] == server_id), None)
    if not server:
        raise HTTPException(404, "Unknown MCP server")
    return {"server_id": server_id, "state": server["state"], "tools": server["tools"]}


@app.put("/api/mcp/servers/{server_id}")
async def put_mcp_server(server_id: str, request: Request):
    require_trusted_request(request)
    _consume_approval(request, request.headers.get("X-M2Lab-Approval"), server_id, "mcp-edit")
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "JSON body must be an object")
    try:
        update_server(server_id, body)
    except KeyError:
        raise HTTPException(404, "Unknown MCP server") from None
    except ValueError as error:
        raise HTTPException(400, str(error)) from None
    await audit_event(request, "mcp.settings", service_id=server_id,
                      keys=sorted(key for key in body if key in {"enabled", "context", "harnesses", "tools"}))
    return {"ok": True, "server_id": server_id}


@app.post("/api/mcp/servers/{server_id}/verify")
async def verify_mcp_server(server_id: str, request: Request):
    require_trusted_request(request)
    _consume_approval(request, request.headers.get("X-M2Lab-Approval"), server_id, "mcp-verify")
    initial = registry_snapshot(_service_state_map(), verify=False)
    candidate = next((item for item in initial["servers"] if item["id"] == server_id), None)
    if candidate and server_id in {"firecrawl", "paperless-ngx", "immich", "ollama"} and candidate["app_state"] == "running":
        # Units are isolated per app; failure is reflected by the subsequent
        # endpoint probe and never rolls back the application itself.
        await asyncio.to_thread(subprocess.run,
            ["systemctl", "--user", "start", f"homelab-app-mcp@{server_id}.service"],
            capture_output=True, text=True, timeout=20)
    snapshot = registry_snapshot(_service_state_map(), verify=True)
    server = next((item for item in snapshot["servers"] if item["id"] == server_id), None)
    if not server:
        raise HTTPException(404, "Unknown MCP server")
    mark_verified(server_id)
    await audit_event(request, "mcp.verify", service_id=server_id, ok=server["state"] == "live")
    return server


@app.get("/api/mcp/harnesses/preview")
async def preview_mcp_harnesses(request: Request):
    require_trusted_request(request)
    return harness_preview(registry_snapshot(_service_state_map(), verify=False))


@app.post("/api/mcp/harnesses/sync")
async def sync_mcp_harnesses(request: Request):
    require_trusted_request(request)
    _consume_approval(request, request.headers.get("X-M2Lab-Approval"), "registry", "mcp-sync")
    paths = write_harness_exports()
    await audit_event(request, "mcp.harness_sync", keys=sorted(paths))
    return {"ok": True, "exports": paths,
            "note": "Managed profiles were generated without overwriting user-owned harness configuration."}


# ---------- destroy (deliberate, double-confirmed in UI) ----------
@app.post("/api/services/{sid}/destroy")
async def destroy(sid: str, request: Request):
    require_trusted_request(request)
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse(status_code=400, content={"detail": "Invalid JSON body"})
    if body.get("confirm") != sid:
        raise HTTPException(400, 'body must be {"confirm":"<service-id>"}')
    s = service_by_id(sid)
    if s.get("lifecycle") == "always_on":
        raise HTTPException(409, "Always-on infrastructure cannot be destroyed from the dashboard")
    async with _action_locks.setdefault(sid, asyncio.Lock()):
        rc, out = await run_compose(s, ["down"])
    await audit_event(request, "service.destroy", service_id=sid, ok=rc == 0)
    return JSONResponse({"ok": rc == 0, "output": out[-4000:]})


@app.post("/api/services/{sid}/{action}")
async def action(sid: str, action: str, request: Request):
    require_trusted_request(request)
    s = service_by_id(sid)
    if action not in {"up", "stop", "restart", "pull", "update"}:
        raise HTTPException(400, f"unknown action {action!r}")
    if action == "stop" and s.get("lifecycle") == "always_on":
        raise HTTPException(409, "Always-on infrastructure can be repaired or restarted, but not stopped")
    if action == "up" and svc_state(s)["overall"] == "absent" and sid not in _FOUNDATION_SERVICES and not _foundation_ready():
        raise HTTPException(409, "Use Settings setup wizard after completing the Authentik identity foundation")
    _consume_approval(request, request.headers.get("X-M2Lab-Approval"), sid, action)
    async with _action_locks.setdefault(sid, asyncio.Lock()):
        if sid == "litellm" and action in {"up", "restart", "update"}:
            await asyncio.to_thread(_sync_freellmapi_gateway)
        if action == "restart":
            rc, out = await run_compose(s, ["restart"])
        elif action == "update":
            rc1, o1 = await run_compose(s, ["pull"])
            rc2, o2 = await run_compose(s, ["up", "-d"])
            rc, out = (rc1 or rc2), o1 + "\n" + o2
        else:
            rc, out = await run_compose(s, [action] if action != "up" else ["up", "-d"])
    await audit_event(request, "service.action", service_id=sid, action=action, ok=rc == 0)
    return JSONResponse({"ok": rc == 0, "output": out[-8000:]}, status_code=200 if rc == 0 else 500)


@app.get("/api/services/{sid}/logs")
async def service_logs(sid: str, request: Request, tail: int = 120):
    """Return a bounded recent log snapshot for trusted dashboard clients."""
    require_trusted_request(request)
    service = service_by_id(sid)
    tail = max(20, min(tail, 500))
    rc, output = await run_compose(service, ["logs", "--no-color", "--tail", str(tail)])
    return JSONResponse(
        {"ok": rc == 0, "service_id": sid, "lines": output[-40000:].splitlines()},
        status_code=200 if rc == 0 else 500,
    )


@app.get("/api/services/{sid}/update-status")
async def service_update_status(sid: str, request: Request):
    """Compare local image digests with registry metadata without pulling."""
    require_trusted_request(request)
    service = service_by_id(sid)

    def inspect() -> list[dict]:
        rows: list[dict] = []
        refs = sorted({container.attrs.get("Config", {}).get("Image", "") for container in project_containers(service["project"])})
        for ref in refs:
            if not ref:
                continue
            current_digest = None
            remote_digest = None
            available = None
            try:
                image = DLI.images.get(ref)
                repo_digests = image.attrs.get("RepoDigests") or []
                if repo_digests:
                    current_digest = repo_digests[0].split("@", 1)[-1]
                remote_digest = DLI.images.get_registry_data(ref).id
                if current_digest and remote_digest:
                    available = current_digest != remote_digest
            except Exception:
                pass
            rows.append({"image": ref, "current_digest": current_digest, "remote_digest": remote_digest, "update_available": available})
        return rows

    loop = asyncio.get_event_loop()
    images = await loop.run_in_executor(None, inspect)
    known = [row["update_available"] for row in images if row["update_available"] is not None]
    update_available = any(known) if known else None
    return {"service_id": sid, "checked": True, "update_available": update_available, "images": images}


@app.get("/api/system")
def system():
    du = psutil.disk_usage(ROOT.anchor or "/")
    return {
        "cpu_percent": psutil.cpu_percent(interval=0.2),
        "mem": psutil.virtual_memory()._asdict(),
        "disk": {"total": du.total, "used": du.used, "percent": du.percent},
        "docker_ok": _docker_available(),
        "tailscale": _tailscale_snapshot(),
        "uptime_seconds": time.time() - psutil.boot_time(),
        "load_avg": list(os.getloadavg()),
    }


# ---------- per-app setup/settings ----------
# These endpoints read/write service .env files for configuration.
# Only supports services that have an .env.example template.
# Security: binds to 127.0.0.1, exposed only via Tailscale.

def _env_path(sid: str) -> Path:
    s = service_by_id(sid)
    return ROOT / s["dir"] / ".env"

def _env_example_path(sid: str) -> Path:
    s = service_by_id(sid)
    return ROOT / s["dir"] / ".env.example"

def _parse_env_file(path: Path) -> dict[str, str]:
    """Parse a .env file into a dict. Ignores comments and empty lines."""
    if not path.exists():
        return {}
    result = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            result[k.strip()] = v.strip()
    return result


def _is_secret_key(key: str) -> bool:
    """Whether a setting must never be returned to a browser client."""
    upper = key.upper()
    explicit = {"DATABASE_URL", "DB_URL", "CONNECTION_STRING", "DSN"}
    return upper in explicit or any(
        token in upper for token in ("PASSWORD", "TOKEN", "SECRET", "KEY", "HASH", "CREDENTIAL")
    )


def _write_env_file(path: Path, values: dict[str, str]) -> None:
    """Atomically write a host-only env file with restrictive permissions."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    lines = [f"{key}={value}" for key, value in values.items()]
    temporary.write_text("\n".join(lines) + ("\n" if lines else ""))
    temporary.chmod(0o600)
    os.replace(temporary, path)


_FEATURED_SETUP_KEYS = {
    "adventurelog": {"SITE_URL"},
    "firecrawl": {"MODEL_NAME", "MODEL_EMBEDDING_NAME", "OLLAMA_BASE_URL", "SEARXNG_ENDPOINT", "BLOCK_MEDIA"},
    "freellmapi": {"PORT"},
    "immich": {"UPLOAD_LOCATION", "DB_DATA_LOCATION", "IMMICH_VERSION"},
    "mealie": {"TZ"},
    "nextcloud": {"NEXTCLOUD_ADMIN_USER"},
    "open-webui": {"WEBUI_AUTH", "WEBUI_NAME", "ENABLE_OAUTH_SIGNUP"},
    "paperless-ngx": {"TZ", "PAPERLESS_URL"},
    "puppygraph": {"PUPPYGRAPH_USERNAME"},
    "surfsense": {
        "EMBEDDING_MODEL", "SURFSENSE_PUBLIC_URL", "SURFSENSE_ENABLE_MODEL_FALLBACK",
        "SURFSENSE_ENABLE_SKILLS", "SURFSENSE_ENABLE_SPECIALIZED_SUBAGENTS",
    },
}

_SETUP_DESCRIPTIONS = {
    "SITE_URL": "The public address this app uses when it creates links.",
    "MODEL_NAME": "The default chat model used for AI-assisted features.",
    "MODEL_EMBEDDING_NAME": "The model used to turn content into searchable vectors.",
    "OLLAMA_BASE_URL": "Where this app reaches your local Ollama models.",
    "SEARXNG_ENDPOINT": "The private search engine used for web discovery.",
    "BLOCK_MEDIA": "Skip images and media when crawling to reduce bandwidth.",
    "PORT": "The host port used by this app.",
    "UPLOAD_LOCATION": "Where the photo and video library is stored.",
    "DB_DATA_LOCATION": "Where the application database is stored.",
    "IMMICH_VERSION": "The Immich release channel or version to run.",
    "TZ": "The timezone used for dates, schedules, and notifications.",
    "NEXTCLOUD_ADMIN_USER": "The administrator account created on first setup.",
    "WEBUI_AUTH": "Require users to sign in before using the chat interface.",
    "WEBUI_NAME": "The product name shown in the Open WebUI interface.",
    "ENABLE_OAUTH_SIGNUP": "Allow Authentik users to create their account on first sign-in.",
    "PAPERLESS_URL": "The canonical private URL Paperless uses for links and security checks.",
    "PUPPYGRAPH_USERNAME": "The username used to access the graph query interface.",
    "EMBEDDING_MODEL": "The model that powers semantic search across your knowledge base.",
    "SURFSENSE_PUBLIC_URL": "The private URL SurfSense uses in links and callbacks.",
    "SURFSENSE_ENABLE_MODEL_FALLBACK": "Try a backup model when the preferred route is unavailable.",
    "SURFSENSE_ENABLE_SKILLS": "Allow reusable skills in SurfSense conversations.",
    "SURFSENSE_ENABLE_SPECIALIZED_SUBAGENTS": "Allow specialized agents to handle focused tasks.",
}


def _freellmapi_database() -> Path:
    return ROOT / service_by_id("freellmapi")["dir"] / "data" / "freeapi.db"


def _freellmapi_gateway_key() -> str | None:
    """Read FreeLLMAPI's generated unified key without exposing it to clients."""
    path = _freellmapi_database()
    if not path.exists():
        return None
    try:
        connection = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True, timeout=1)
        try:
            row = connection.execute("SELECT value FROM settings WHERE key = 'unified_api_key'").fetchone()
        finally:
            connection.close()
    except sqlite3.Error:
        return None
    return str(row[0]).strip() if row and row[0] else None


def _freellmapi_providers() -> list[dict]:
    """Return provider identity and health only; encrypted credentials stay unread."""
    path = _freellmapi_database()
    if not path.exists():
        return []
    try:
        connection = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True, timeout=1)
        try:
            rows = connection.execute(
                """SELECT platform, COUNT(*), SUM(enabled),
                          SUM(CASE WHEN enabled = 1 AND status = 'healthy' THEN 1 ELSE 0 END)
                   FROM api_keys GROUP BY platform ORDER BY platform"""
            ).fetchall()
        finally:
            connection.close()
    except sqlite3.Error:
        return []
    return [
        {
            "id": platform,
            "name": _PROVIDER_LABELS.get(platform, platform.replace("_", " ").title()),
            "configured": total > 0,
            "enabled": bool(enabled),
            "healthy": bool(healthy),
            "key_count": total,
        }
        for platform, total, enabled, healthy in rows
    ]


def _sync_freellmapi_gateway() -> bool:
    """Couple FreeLLMAPI to LiteLLM host-side; returns whether config changed."""
    gateway_key = _freellmapi_gateway_key()
    if not gateway_key:
        return False
    path = _env_path("litellm")
    values = _parse_env_file(path)
    if values.get("FREE_LLMAPI_API_KEY") == gateway_key:
        return False
    values["FREE_LLMAPI_API_KEY"] = gateway_key
    _write_env_file(path, values)
    return True


def _apply_automatic_model_wiring(sid: str, values: dict[str, str]) -> list[str]:
    """Apply host-managed model routes while preserving every unrelated value."""
    desired: dict[str, str] = {}
    if sid == "litellm":
        gateway_key = _freellmapi_gateway_key()
        if gateway_key:
            desired["FREE_LLMAPI_API_KEY"] = gateway_key
    elif sid == "open-webui":
        litellm_key = _parse_env_file(_env_path("litellm")).get("LITELLM_MASTER_KEY", "")
        if litellm_key:
            desired.update({
                "LITELLM_MASTER_KEY": litellm_key,
                "OPENAI_API_KEY": litellm_key,
                "OPENAI_API_BASE_URL": "http://host.docker.internal:4000/v1",
            })
    changed = [key for key, value in desired.items() if values.get(key) != value]
    values.update(desired)
    return changed


def _bootstrap_identity() -> dict[str, str] | None:
    values = _parse_env_file(_env_path("vaultwarden"))
    email = values.get(_IDENTITY_KEYS[0], "").strip()
    password = values.get(_IDENTITY_KEYS[1], "")
    return {"email": email, "password": password} if email and password else None


@app.get("/api/bootstrap-identity")
async def get_bootstrap_identity(request: Request):
    require_trusted_request(request)
    identity = _bootstrap_identity()
    return {"configured": bool(identity), "email": identity["email"] if identity else None}


@app.put("/api/bootstrap-identity")
async def put_bootstrap_identity(request: Request):
    require_trusted_request(request)
    raise HTTPException(410, "Shared app passwords were replaced by Authentik-first onboarding")

def _load_env_example(sid: str) -> dict[str, dict]:
    """Parse .env.example into structured config with placeholders.

    Honors inline `# important` / `# advanced` tags after a key line so the
    UI can group settings. Without a tag we fall back to a heuristic:
    names containing PASSWORD/TOKEN/SECRET/KEY/HASH -> important (auth),
    everything else -> advanced (rarely touched).
    """
    path = _env_example_path(sid)
    if not path.exists():
        return {}
    result = {}
    raw_lines = path.read_text().splitlines()
    for i, raw in enumerate(raw_lines):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        key = k.strip()
        # Look at the next non-blank line for a `# important` / `# advanced`
        # comment that documents THIS key.
        priority = None
        for j in range(i + 1, min(i + 4, len(raw_lines))):
            nxt = raw_lines[j].strip()
            if not nxt:
                continue
            if not nxt.startswith("#"):
                break
            low = nxt.lower()
            if "important" in low:
                priority = "important"
                break
            if "advanced" in low:
                priority = "advanced"
                break
        if priority is None:
            priority = "important" if key in _FEATURED_SETUP_KEYS.get(sid, set()) else "advanced"
        result[key] = {
            "placeholder": v.strip(),
            "description": _SETUP_DESCRIPTIONS.get(key, "Internal deployment setting. Change only when you know the app requires it."),
            "required": bool(v.strip()),
            "priority": priority,
            "secret": _is_secret_key(key),
        }
    return result


@app.get("/api/services/{sid}/setup")
async def get_setup(sid: str, request: Request):
    """Return current .env values + .env.example template for the service."""
    require_trusted_request(request)
    service_by_id(sid)  # validates sid
    current = _parse_env_file(_env_path(sid))
    template = _load_env_example(sid)
    # Never send a stored secret back to the browser. A configured flag lets the
    # UI show progress while preserving the secret in the host-only .env file.
    for key, val in current.items():
        if key.startswith("OMNILAB_"):
            continue
        if key in template:
            if template[key]["secret"]:
                template[key]["configured"] = bool(val)
            else:
                template[key]["value"] = val
        else:
            secret = _is_secret_key(key)
            priority = "important" if secret else "advanced"
            template[key] = {
                "placeholder": "",
                "description": "",
                "required": False,
                "priority": priority,
                "secret": secret,
                "configured": bool(val) if secret else False,
                **({} if secret else {"value": val}),
            }
    return {"service_id": sid, "config": template}


@app.put("/api/services/{sid}/setup")
async def update_setup(sid: str, request: Request):
    """Write .env file for the service. Only accepts keys from .env.example."""
    require_trusted_request(request)
    service_by_id(sid)
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    
    template = _load_env_example(sid)
    allowed_keys = set(template.keys())
    # Filter to only allowed keys. Merge with the current file so a browser
    # saving one setting cannot erase other settings or masked secret values.
    if not isinstance(body, dict):
        raise HTTPException(400, "JSON body must be an object")
    filtered = {}
    for key, value in body.items():
        if key not in allowed_keys:
            continue
        if not isinstance(value, str):
            raise HTTPException(400, f"Setting '{key}' must be a string")
        if "\n" in value or "\r" in value:
            raise HTTPException(400, f"Setting '{key}' cannot contain a newline")
        filtered[key] = value
    current = _parse_env_file(_env_path(sid))
    current.update(filtered)
    
    env_path = _env_path(sid)
    _write_env_file(env_path, current)
    await audit_event(request, "service.settings", service_id=sid, keys=sorted(filtered))
    return {"ok": True, "written": list(filtered.keys())}


@app.post("/api/services/{sid}/setup/regenerate")
async def regenerate_secret(sid: str, request: Request):
    """Generate a new secure random value for a secret key (e.g., ADMIN_TOKEN, JWT_SECRET)."""
    require_trusted_request(request)
    service_by_id(sid)
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON body")
    
    key = body.get("key")
    if not key:
        raise HTTPException(400, "Missing 'key' field")
    
    template = _load_env_example(sid)
    if key not in template:
        raise HTTPException(400, f"Key '{key}' not in .env.example template")
    
    # Generate secure random value (32 bytes = 64 hex chars)
    new_value = secrets.token_hex(32)
    
    # Update .env file
    current = _parse_env_file(_env_path(sid))
    current[key] = new_value
    env_path = _env_path(sid)
    _write_env_file(env_path, current)
    await audit_event(request, "service.secret_regenerated", service_id=sid, key=key)
    
    # Deliberately do not return the secret. It is written directly to the
    # host's .env file and can be used by the service after a restart.
    return {"ok": True, "key": key, "configured": True}


# ---------- resumable setup/onboarding jobs ----------
_FOUNDATION_INFRA_ORDER = ("authentik", "sso-ingress")
_FOUNDATION_SERVICES = (*_FOUNDATION_INFRA_ORDER, "vaultwarden")


def _secret_missing(value: str | None) -> bool:
    return not value or value.lower() in {"change_me", "changeme"} or value.startswith("replace_with_")


def _prepare_identity_foundation() -> list[str]:
    """Generate host-side infrastructure secrets without returning values."""
    changed: list[str] = []
    root_values = _parse_env_file(ROOT / ".env")
    ingress_token = root_values.get("OMNILAB_INGRESS_TOKEN")
    if _secret_missing(ingress_token):
        ingress_token = secrets.token_hex(32)
        root_values["OMNILAB_INGRESS_TOKEN"] = ingress_token
        changed.append("root ingress token")
    root_values.setdefault("OMNILAB_REQUIRE_IDENTITY", "false")
    _write_env_file(ROOT / ".env", root_values)

    authentik_values = _parse_env_file(ROOT / "authentik" / ".env")
    authentik_values.setdefault("AUTHENTIK_TAG", "2026.5.0")
    for key, size in (("AUTHENTIK_SECRET_KEY", 32), ("AUTHENTIK_POSTGRESQL__PASSWORD", 24),
                      ("AUTHENTIK_BOOTSTRAP_TOKEN", 32)):
        if _secret_missing(authentik_values.get(key)):
            authentik_values[key] = secrets.token_hex(size)
            changed.append(f"authentik {key.lower()}")
    _write_env_file(ROOT / "authentik" / ".env", authentik_values)

    ingress_values = _parse_env_file(ROOT / "ingress" / ".env")
    if ingress_values.get("OMNILAB_INGRESS_TOKEN") != ingress_token:
        ingress_values["OMNILAB_INGRESS_TOKEN"] = ingress_token
        changed.append("caddy ingress token")
    _write_env_file(ROOT / "ingress" / ".env", ingress_values)
    return changed


async def _wait_for_service(sid: str, timeout: int = 180) -> bool:
    deadline = time.monotonic() + timeout
    service = service_by_id(sid)
    while time.monotonic() < deadline:
        state = await asyncio.to_thread(svc_state, service)
        application_health = await asyncio.to_thread(http_health, service)
        if state["overall"] == "running" and application_health is not False:
            return True
        await asyncio.sleep(2)
    return False


async def _start_setup_service(job_id: str, sid: str, progress: int) -> None:
    service = service_by_id(sid)
    current_state = await asyncio.to_thread(svc_state, service)
    current_health = await asyncio.to_thread(http_health, service)
    if current_state["overall"] == "running" and current_health is not False:
        update_job(job_id, status="verifying", stage=f"verify_{sid}", progress=progress,
                   summary=f"{service['display_name']} is already ready",
                   message=f"Reused the healthy {service['display_name']} installation")
        return
    update_job(job_id, status="starting", stage=f"start_{sid}", progress=progress,
               summary=f"Starting {service['display_name']}", message=f"Starting {service['display_name']} and its backend processes")
    rc, _output = await run_compose(service, ["up", "-d"])
    if rc != 0:
        raise RuntimeError(f"{service['display_name']} could not be started. Open its sanitized service logs for details.")
    update_job(job_id, status="waiting", stage=f"wait_{sid}", progress=progress,
               summary=f"Waiting for {service['display_name']}", message=f"Containers started; waiting for {service['display_name']} health")
    if not await _wait_for_service(sid):
        raise RuntimeError(f"{service['display_name']} did not become ready before the setup timeout.")


async def _foundation_preflight(job_id: str) -> None:
    update_job(job_id, status="verifying", stage="preflight", progress=3,
               summary="Checking this host", message="Checking Docker, shared networks, ports, and the Tailscale session")
    if not await asyncio.to_thread(_docker_available):
        raise RuntimeError("Docker is not available. Start Docker, then retry setup.")
    missing_networks = []
    for network in ("homelab_frontend", "homelab_backend"):
        try:
            await asyncio.to_thread(DLI.networks.get, network)
        except Exception:
            missing_networks.append(network)
    if missing_networks:
        raise RuntimeError(f"Required Docker networks are missing: {', '.join(missing_networks)}. Run the host bootstrap, then retry.")
    tailscale = await asyncio.to_thread(_tailscale_snapshot)
    if not tailscale["installed"]:
        raise RuntimeError("Tailscale is not installed. Install it and sign in before continuing.")
    if not tailscale["connected"]:
        raise RuntimeError("Tailscale is installed but not signed in. Complete `tailscale up`, then retry setup.")


async def _validate_caddy() -> None:
    ingress = service_by_id("sso-ingress")
    rc, output = await run_compose(ingress, [
        "run", "--rm", "--no-deps", "caddy", "caddy", "validate",
        "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile",
    ])
    if rc != 0:
        detail = next((line.strip() for line in reversed(output.splitlines()) if line.strip()), "configuration is invalid")
        raise RuntimeError(f"Caddy configuration validation failed: {detail[:240]}")


async def _route_authentik() -> tuple[bool, str | None]:
    process = await asyncio.create_subprocess_exec(
        "tailscale", "serve", "--bg", "--yes", "--https=8462", "http://127.0.0.1:19062",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await process.communicate()
    if process.returncode == 0:
        proxies = await asyncio.to_thread(_tailscale_serve_proxies)
        if proxies.get(8462) == "http://127.0.0.1:19062":
            return True, None
        return False, "Tailscale accepted the route but did not report the expected 8462 listener."
    message = stderr.decode(errors="replace").strip()
    if "permission" in message.lower() or "sudo" in message.lower():
        return False, "Tailscale needs one-time operator permission on this host before M2Lab can manage private routes."
    return False, "Tailscale could not publish the Authentik URL."


async def _verify_external_authentik(timeout: int = 45) -> bool:
    url = f"{SETTINGS['tailnet_base']}:8462/-/health/ready/"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            def probe() -> bool:
                with urllib.request.urlopen(url, timeout=5) as response:
                    return response.status == 200
            if await asyncio.to_thread(probe):
                return True
        except Exception:
            pass
        await asyncio.sleep(2)
    return False


async def _run_foundation_job(job_id: str) -> None:
    try:
        await _foundation_preflight(job_id)
        update_job(job_id, status="preparing", stage="secrets", progress=5,
                   summary="Preparing identity services", message="Generating protected infrastructure credentials")
        changed = await asyncio.to_thread(_prepare_identity_foundation)
        update_job(job_id, status="preparing", stage="secrets_ready", progress=10,
                   summary="Security files prepared", message=f"Prepared {len(changed)} protected settings; values were not exposed")
        await _start_setup_service(job_id, "authentik", 25)
        update_job(job_id, status="verifying", stage="validate_caddy", progress=48,
                   summary="Validating private ingress", message="Checking every Caddy listener before it can receive traffic")
        await _validate_caddy()
        await _start_setup_service(job_id, "sso-ingress", 58)
        update_job(job_id, status="configuring", stage="tailscale", progress=72,
                   summary="Publishing private Authentik URL", message="Connecting the existing tailnet URL to the identity gateway")
        routed, route_error = await _route_authentik()
        if not routed:
            update_job(job_id, status="user_action_required", stage="tailscale_permission", progress=72,
                       summary="Tailscale permission required", message=route_error or "Tailscale route needs attention",
                       action={"kind": "tailscale_permission", "label": "Review host permission"}, error=route_error)
            return
        update_job(job_id, status="verifying", stage="verify_external_authentik", progress=80,
                   summary="Verifying Authentik", message="Checking the complete Tailscale, Caddy, and Authentik path")
        if not await _verify_external_authentik():
            raise RuntimeError("Authentik started locally, but its private 8462 URL did not pass the end-to-end health check.")
        update_job(job_id, status="user_action_required", stage="create_owner", progress=86,
                   summary="Create your M2Lab owner", message="Authentik is ready. Create the first owner, enroll MFA or a passkey, and save recovery codes.",
                   action={"kind": "open_url", "label": "Open Authentik setup", "url": f"{SETTINGS['tailnet_base']}:8462/if/flow/initial-setup/"})
    except Exception as error:
        update_job(job_id, status="failed", stage="failed", progress=0,
                   summary="Core setup needs attention", message="Setup stopped safely at the failed stage.", error=str(error)[:500])
    finally:
        _setup_tasks.pop(job_id, None)


def _foundation_ready() -> bool:
    snapshot = list_jobs(100)
    completed = any(job["target"] == "foundation" and job["status"] == "ready" for job in snapshot["jobs"])
    if not completed:
        return False
    if _tailscale_serve_proxies().get(8462) != "http://127.0.0.1:19062":
        return False
    return all(
        svc_state(service_by_id(sid))["overall"] == "running"
        and http_health(service_by_id(sid)) is not False
        for sid in _FOUNDATION_SERVICES
    )


async def _run_app_setup_job(job_id: str, sid: str) -> None:
    try:
        if not _foundation_ready():
            raise RuntimeError("Complete Authentik core setup before onboarding a human-facing application.")
        catalog = load_catalog()
        app_by_id = {item["id"]: item for item in catalog.get("apps", [])}
        target_app = next((item for item in app_by_id.values() if item.get("service_id") == sid), None)
        ordered: list[str] = []
        seen: set[str] = set()
        def add_app(app_id: str) -> None:
            if app_id in seen:
                return
            seen.add(app_id)
            item = app_by_id.get(app_id)
            for dependency in (item or {}).get("dependencies", []):
                add_app(dependency)
            service_id = (item or {}).get("service_id")
            if service_id:
                ordered.append(service_id)
        if target_app:
            add_app(target_app["id"])
        if sid not in ordered:
            ordered.append(sid)
        update_job(job_id, status="preparing", stage="prepare", progress=10,
                   summary=f"Preparing {service_by_id(sid)['display_name']}", message="Creating host-only configuration and checking dependencies")
        # Tier 1: Infrastructure & Databases (e.g. litellm, freellmapi, ollama)
        # Tier 2: User Applications (e.g. surfsense, paperless-ngx, immich, actual-budget)
        tier_infra = [sid for sid in ordered if service_by_id(sid).get("role") == "infrastructure" or sid in {"litellm", "ollama", "freellmapi"}]
        tier_apps = [sid for sid in ordered if sid not in tier_infra]
        staggered_order = tier_infra + tier_apps

        for index, service_id in enumerate(staggered_order):
            current = _parse_env_file(_env_path(service_id))
            example = _parse_env_file(_env_example_path(service_id))
            if service_id in AUTOMATED_SERVICES:
                prepared, _changed = prepare_environment(service_id, current, example, identity=None)
            else:
                prepared = {**example, **current}
            _apply_automatic_model_wiring(service_id, prepared)
            if prepared:
                _write_env_file(_env_path(service_id), prepared)
            await _start_setup_service(job_id, service_id, 25 + int(35 * (index + 1) / len(staggered_order)))
            # Stagger launch slightly between heavy containers to avoid CPU/IO spikes
            if index < len(staggered_order) - 1:
                await asyncio.sleep(1)
        identity_app = next((item for item in identity_app_inventory({sid: "running"}) if item["id"] == sid), None)
        if identity_app and identity_app["mode"] != "machine_only":
            note = ("Authentik protects access, but this app requires one local account handoff."
                    if identity_app["mode"] == "access_gate_only" else
                    "Complete the application identity handoff; M2Lab will verify it afterward.")
            update_job(job_id, status="user_action_required", stage="identity_handoff", progress=75,
                       summary=f"Finish {service_by_id(sid)['display_name']} sign-in", message=note,
                       action={"kind": "open_url", "label": f"Open {service_by_id(sid)['display_name']}", "url": identity_app["external_url"]})
            return
        update_job(job_id, status="ready", stage="ready", progress=100,
                   summary=f"{service_by_id(sid)['display_name']} is ready", message="Application health and setup checks passed")
    except Exception as error:
        update_job(job_id, status="failed", stage="failed", progress=0,
                   summary=f"{service_by_id(sid)['display_name']} setup needs attention", message="Setup stopped safely.", error=str(error)[:500])
    finally:
        _setup_tasks.pop(job_id, None)


@app.get("/api/setup/jobs")
async def get_setup_jobs(request: Request):
    require_trusted_request(request)
    return await asyncio.to_thread(list_jobs)


@app.get("/api/setup/jobs/{job_id}")
async def get_setup_job(job_id: str, request: Request):
    require_trusted_request(request)
    try:
        return await asyncio.to_thread(get_job, job_id)
    except KeyError:
        raise HTTPException(404, "Unknown setup job") from None


@app.post("/api/setup/targets/{target}/start")
async def start_setup_job(target: str, request: Request):
    require_trusted_request(request)
    _consume_approval(request, request.headers.get("X-M2Lab-Approval"), target, "setup-start")
    if target != "foundation":
        service_by_id(target)
    job = await asyncio.to_thread(create_job, target, "foundation" if target == "foundation" else "application",
                                  "Preparing identity foundation" if target == "foundation" else f"Preparing {service_by_id(target)['display_name']}")
    if job["status"] == "queued" and job["id"] not in _setup_tasks:
        coroutine = _run_foundation_job(job["id"]) if target == "foundation" else _run_app_setup_job(job["id"], target)
        _setup_tasks[job["id"]] = asyncio.create_task(coroutine)
    await audit_event(request, "setup.started", service_id=target, job_id=job["id"])
    return job


@app.post("/api/setup/jobs/{job_id}/resume")
async def resume_setup_job(job_id: str, request: Request):
    require_trusted_request(request)
    try:
        job = get_job(job_id)
    except KeyError:
        raise HTTPException(404, "Unknown setup job") from None
    _consume_approval(request, request.headers.get("X-M2Lab-Approval"), job["target"], "setup-resume")
    body = await request.json()
    if not body.get("completed"):
        raise HTTPException(400, "Confirm the displayed handoff is complete before resuming")
    if job["target"] == "foundation" and job["stage"] == "tailscale_permission":
        routed, route_error = await _route_authentik()
        if not routed:
            raise HTTPException(409, route_error or "The Authentik route is not ready")
        if not await _verify_external_authentik():
            raise HTTPException(409, "The 8462 route exists, but Authentik is not reachable through it yet")
        result = update_job(job_id, status="user_action_required", stage="create_owner", progress=86,
                            summary="Create your M2Lab owner",
                            message="Authentik is ready. Create the first owner, enroll MFA or a passkey, and save recovery codes.",
                            action={"kind": "open_url", "label": "Open Authentik setup", "url": f"{SETTINGS['tailnet_base']}:8462/if/flow/initial-setup/"})
    elif job["target"] == "foundation" and job["stage"] == "create_owner":
        if not await _wait_for_service("authentik", 10) or not await _verify_external_authentik(10):
            raise HTTPException(409, "Authentik is not reachable yet")
        try:
            await _start_setup_service(job_id, "vaultwarden", 94)
        except RuntimeError as error:
            update_job(job_id, status="failed", stage="start_vaultwarden", progress=90,
                       summary="Vaultwarden needs attention", message="Identity is ready, but Vaultwarden did not start.", error=str(error)[:500])
            raise HTTPException(500, str(error)) from error
        result = update_job(job_id, status="ready", stage="ready", progress=100,
                            summary="Identity foundation is ready", message="Authentik, Caddy, Tailscale routing, and Vaultwarden are ready")
    elif job["status"] == "user_action_required":
        sid = job["target"]
        if not await _wait_for_service(sid, 10):
            raise HTTPException(409, f"{service_by_id(sid)['display_name']} is not reachable yet")
        result = update_job(job_id, status="ready", stage="ready", progress=100,
                            summary=f"{service_by_id(sid)['display_name']} is ready", message="User handoff confirmed and application health passed")
    else:
        raise HTTPException(409, "This setup job is not waiting for a user handoff")
    await audit_event(request, "setup.resumed", service_id=job["target"], job_id=job_id)
    return result


@app.post("/api/initiate/{sid}/prepare")
async def prepare_initiate_service(sid: str, request: Request):
    """Prepare a supported service without returning generated credentials."""
    require_trusted_request(request)
    service = service_by_id(sid)
    if sid not in AUTOMATED_SERVICES:
        raise HTTPException(400, f"Service '{sid}' is not available in automated initiation")
    if sid not in _FOUNDATION_SERVICES and not _foundation_ready():
        raise HTTPException(409, "Complete Authentik core setup before preparing this application")

    current = _parse_env_file(_env_path(sid))
    example = _parse_env_file(_env_example_path(sid))
    containers_exist = svc_state(service)["overall"] != "absent"
    prepared, changed = prepare_environment(
        sid,
        current,
        example,
        replace_placeholders=not containers_exist,
        identity=_bootstrap_identity(),
    )
    changed.extend(_apply_automatic_model_wiring(sid, prepared))
    _write_env_file(_env_path(sid), prepared)
    await audit_event(request, "initiate.service_prepared", service_id=sid, keys=sorted(changed))
    return {"ok": True, "service_id": sid, "prepared": sorted(changed), "configured": True}


@app.post("/api/install/{sid}/prepare")
async def prepare_install_service(sid: str, request: Request):
    """Prepare one catalog service without exposing generated credentials."""
    require_trusted_request(request)
    service = service_by_id(sid)
    if sid not in _FOUNDATION_SERVICES and not _foundation_ready():
        raise HTTPException(409, "Complete Authentik core setup before preparing this application")
    current = _parse_env_file(_env_path(sid))
    example = _parse_env_file(_env_example_path(sid))
    containers_exist = svc_state(service)["overall"] != "absent"
    if sid in AUTOMATED_SERVICES:
        prepared, changed = prepare_environment(
            sid,
            current,
            example,
            replace_placeholders=not containers_exist,
            identity=_bootstrap_identity(),
        )
        changed.extend(_apply_automatic_model_wiring(sid, prepared))
    else:
        # Generic services keep their documented defaults and any operator
        # values. Service-specific secret relationships are never guessed.
        prepared = {**example, **current}
        changed = [key for key in example if key not in current]
    if prepared:
        _write_env_file(_env_path(sid), prepared)
    await audit_event(request, "install.service_prepared", service_id=sid, keys=sorted(changed))
    return {"ok": True, "service_id": sid, "prepared": sorted(changed), "configured": True}


def _read_calendar_connection() -> dict[str, str] | None:
    if not _CALENDAR_CONNECTION_PATH.exists():
        return None
    try:
        data = json.loads(_CALENDAR_CONNECTION_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    required = ("username", "app_password", "calendar")
    return data if all(isinstance(data.get(key), str) and data[key] for key in required) else None


def _calendar_url(connection: dict[str, str]) -> str:
    username = urllib.parse.quote(connection["username"], safe="")
    calendar = urllib.parse.quote(connection["calendar"], safe="")
    return f"http://127.0.0.1:8020/remote.php/dav/calendars/{username}/{calendar}/"


def _calendar_request(connection: dict[str, str], method: str, body: bytes) -> bytes:
    auth = base64.b64encode(f'{connection["username"]}:{connection["app_password"]}'.encode()).decode()
    request = urllib.request.Request(
        _calendar_url(connection),
        data=body,
        method=method,
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/xml; charset=utf-8",
            "Depth": "1" if method == "REPORT" else "0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return response.read(2_000_000)
    except urllib.error.HTTPError as error:
        if error.code in {401, 403, 404}:
            raise ValueError("Nextcloud rejected the username, app password, or calendar slug") from error
        raise ValueError(f"Nextcloud calendar returned HTTP {error.code}") from error
    except OSError as error:
        raise ValueError("Nextcloud calendar is not reachable") from error


def _parse_ics_datetime(value: str) -> tuple[str, bool]:
    value = value.strip()
    if re.fullmatch(r"\d{8}", value):
        parsed = datetime.strptime(value, "%Y%m%d")
        return parsed.date().isoformat(), True
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y%m%dT%H%M%S"):
        try:
            parsed = datetime.strptime(value, fmt)
            if value.endswith("Z"):
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.isoformat(), False
        except ValueError:
            continue
    raise ValueError("Unsupported calendar date")


def _parse_calendar_events(payload: bytes, calendar: str) -> list[dict]:
    try:
        root = ElementTree.fromstring(payload)
    except ElementTree.ParseError as error:
        raise ValueError("Nextcloud returned an invalid calendar response") from error
    events: list[dict] = []
    for node in root.findall(".//{urn:ietf:params:xml:ns:caldav}calendar-data"):
        raw = node.text or ""
        unfolded = re.sub(r"\r?\n[ \t]", "", raw)
        for block in unfolded.split("BEGIN:VEVENT")[1:]:
            event_text = block.split("END:VEVENT", 1)[0]
            props: dict[str, str] = {}
            for line in event_text.splitlines():
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                props[key.split(";", 1)[0].upper()] = value.replace("\\,", ",").replace("\\n", " ")
            if "DTSTART" not in props:
                continue
            try:
                start, all_day = _parse_ics_datetime(props["DTSTART"])
                end = _parse_ics_datetime(props["DTEND"])[0] if props.get("DTEND") else None
            except ValueError:
                continue
            events.append({
                "uid": props.get("UID", secrets.token_hex(8)),
                "title": props.get("SUMMARY", "Untitled event")[:300],
                "start": start,
                "end": end,
                "all_day": all_day,
                "calendar": calendar,
            })
            if len(events) >= 500:
                return events
    return events


@app.get("/api/connections/nextcloud-calendar")
async def get_calendar_connection(request: Request):
    require_trusted_request(request)
    connection = _read_calendar_connection()
    nextcloud_running = svc_state(service_by_id("nextcloud"))["overall"] == "running"
    return {
        "configured": bool(connection),
        "username": connection["username"] if connection else None,
        "calendar": connection["calendar"] if connection else None,
        "nextcloud_running": nextcloud_running,
    }


@app.put("/api/connections/nextcloud-calendar")
async def put_calendar_connection(request: Request):
    require_trusted_request(request)
    body = await request.json()
    connection = {
        "username": str(body.get("username", "")).strip(),
        "app_password": str(body.get("app_password", "")).strip(),
        "calendar": str(body.get("calendar", "")).strip(),
    }
    if not all(connection.values()) or any("\n" in value or "\r" in value for value in connection.values()):
        raise HTTPException(400, "Username, app password, and calendar slug are required")
    if not re.fullmatch(r"[A-Za-z0-9._@+\- ]{1,128}", connection["username"]):
        raise HTTPException(400, "Invalid Nextcloud username")
    if not re.fullmatch(r"[A-Za-z0-9._\-]{1,128}", connection["calendar"]):
        raise HTTPException(400, "Invalid calendar slug")
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, lambda: _calendar_request(connection, "PROPFIND", b"<?xml version='1.0'?><d:propfind xmlns:d='DAV:'><d:prop><d:displayname/></d:prop></d:propfind>"))
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    _STATE_DIR.mkdir(mode=0o700, exist_ok=True)
    temporary = _CALENDAR_CONNECTION_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(connection), encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, _CALENDAR_CONNECTION_PATH)
    await audit_event(request, "connection.nextcloud_calendar_saved")
    return {"configured": True, "username": connection["username"], "calendar": connection["calendar"], "nextcloud_running": True}


@app.get("/api/calendar/events")
async def calendar_events(request: Request, start: str, end: str):
    require_trusted_request(request)
    connection = _read_calendar_connection()
    if not connection:
        return {"configured": False, "events": []}
    try:
        start_date = datetime.strptime(start, "%Y-%m-%d")
        end_date = datetime.strptime(end, "%Y-%m-%d")
    except ValueError as error:
        raise HTTPException(400, "start and end must use YYYY-MM-DD") from error
    if end_date <= start_date or (end_date - start_date).days > 62:
        raise HTTPException(400, "Calendar range must be between 1 and 62 days")
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="{start_date.strftime('%Y%m%dT000000Z')}" end="{end_date.strftime('%Y%m%dT000000Z')}"/></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>""".encode()
    loop = asyncio.get_event_loop()
    try:
        payload = await loop.run_in_executor(None, lambda: _calendar_request(connection, "REPORT", body))
        events = _parse_calendar_events(payload, connection["calendar"])
    except ValueError as error:
        raise HTTPException(502, str(error)) from error
    return {"configured": True, "events": events}


# ---------- static UI ----------
dist = ROOT / "ctl-web-next" / "dist"
if not dist.is_dir():
    raise RuntimeError(
        f"Dashboard bundle missing: {dist} — run `npm run build` in ctl-web-next/"
    )
app.mount("/", StaticFiles(directory=str(dist), html=True), name="web")


def main():
    import uvicorn
    port = int(os.environ.get("DASHBOARD_PORT", SETTINGS.get("dashboard_port", 8787)))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()

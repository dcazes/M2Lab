import asyncio
import base64
import json
import os
import re
import secrets
import select
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
from .mcp_registry import (
    harness_preview, mark_verified, registry_snapshot, update_server,
    write_harness_exports,
)
from .registry import ROOT, SERVICES, service_by_id, SETTINGS

DLI = docker.DockerClient.from_env()
API = DLI.api

app = FastAPI(title="homelab-ctl", docs_url=None, redoc_url=None)

# ---------- per-service action mutex ----------
_action_locks: dict[str, asyncio.Lock] = {}
_audit_lock = asyncio.Lock()
_approvals: dict[str, dict] = {}
_APPROVAL_TTL = 120
_STATE_DIR = ROOT / ".state"
_AUDIT_PATH = _STATE_DIR / "audit.jsonl"
_CALENDAR_CONNECTION_PATH = _STATE_DIR / "nextcloud-calendar.json"
_IDENTITY_KEYS = ("OMNILAB_IDENTITY_EMAIL", "OMNILAB_IDENTITY_PASSWORD")

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


# Security model: the control plane binds to 127.0.0.1 and is exposed only via
# Tailscale Serve — tailnet membership is the authentication boundary. No
# application-level token by design; do not expose this port beyond localhost.


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
    running = sum(1 for r in rows if r["state"] == "running")
    if not rows:
        overall = "absent"
    elif running == len(rows):
        overall = "running"
    elif running == 0:
        overall = "stopped"
    else:
        overall = "degraded"
    return {"overall": overall, "containers": rows}


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


async def audit_event(request: Request, event: str, **fields) -> None:
    """Append a secret-free, local audit record for state-changing actions."""
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "source": request_source(request),
        **fields,
    }
    async with _audit_lock:
        _STATE_DIR.mkdir(mode=0o700, exist_ok=True)
        with _AUDIT_PATH.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, separators=(",", ":")) + "\n")


def _consume_approval(token: str | None, sid: str, action: str) -> None:
    approval = _approvals.pop(token, None) if token else None
    if not approval or approval["expires_at"] < time.time():
        raise HTTPException(403, "A fresh explicit approval is required")
    if approval["service_id"] != sid or approval["action"] != action:
        raise HTTPException(403, "Approval does not match this action")


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
    if action not in {"up", "stop", "restart", "pull", "update", "mcp-edit", "mcp-verify", "mcp-sync"}:
        raise HTTPException(400, "Unknown approval action")
    if action.startswith("mcp-"):
        known = {item["id"] for item in registry_snapshot()["servers"]} | {"registry"}
        if sid not in known:
            raise HTTPException(404, "Unknown MCP server")
    else:
        service_by_id(sid)
    if body.get("confirm") != f"{action}:{sid}":
        raise HTTPException(400, "Approval confirmation does not match")
    token = secrets.token_urlsafe(24)
    _approvals[token] = {"service_id": sid, "action": action, "expires_at": time.time() + _APPROVAL_TTL}
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


@app.get("/api/services")
async def list_services(request: Request):
    tailnet_base = SETTINGS.get("tailnet_base", "")
    src = request_source(request)
    loop = asyncio.get_event_loop()

    # First pass: gather container state OFF the event loop — the docker SDK
    # does blocking socket calls, and inline execution here stalls every other
    # request (system polls, actions) for the duration, which reads as UI stutter.
    states = await loop.run_in_executor(None, lambda: {s["id"]: svc_state(s) for s in SERVICES})

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
            "icon": s.get("icon", "📦"),
            "port": s.get("port"),
            "url": s.get("url"),
            "tailnet_url": tailnet_url,
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
        del svc["_health_probe"]
    
    await asyncio.gather(*[probe_health(svc) for svc in service_data])
    
    return {"services": service_data, "source": src}


def _service_state_map() -> dict[str, str]:
    return {service["id"]: svc_state(service)["overall"] for service in SERVICES}


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
    _consume_approval(request.headers.get("X-OmniLab-Approval"), server_id, "mcp-edit")
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
    _consume_approval(request.headers.get("X-OmniLab-Approval"), server_id, "mcp-verify")
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
    _consume_approval(request.headers.get("X-OmniLab-Approval"), "registry", "mcp-sync")
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
    _consume_approval(request.headers.get("X-OmniLab-Approval"), sid, action)
    async with _action_locks.setdefault(sid, asyncio.Lock()):
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
        "docker_ok": bool(DLI.ping()),
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
    body = await request.json()
    email = str(body.get("email", "")).strip()
    password = str(body.get("password", ""))
    if not body.get("acknowledge_shared_credential_risk"):
        raise HTTPException(400, "Shared credential risk acknowledgement is required")
    if not email or len(email) > 254 or "\n" in email or "\r" in email:
        raise HTTPException(400, "Enter a valid app login")
    if len(password) < 10 or len(password) > 256 or "\n" in password or "\r" in password:
        raise HTTPException(400, "The shared app password must contain 10 to 256 characters")
    values = _parse_env_file(_env_path("vaultwarden"))
    values[_IDENTITY_KEYS[0]] = email
    values[_IDENTITY_KEYS[1]] = password
    _write_env_file(_env_path("vaultwarden"), values)
    await audit_event(request, "bootstrap.identity_saved")
    return {"configured": True, "email": email}

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
            if _is_secret_key(key):
                priority = "important"
            else:
                priority = "advanced"
        result[key] = {
            "placeholder": v.strip(),
            "description": "",
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


@app.post("/api/initiate/{sid}/prepare")
async def prepare_initiate_service(sid: str, request: Request):
    """Prepare a supported service without returning generated credentials."""
    require_trusted_request(request)
    service = service_by_id(sid)
    if sid not in AUTOMATED_SERVICES:
        raise HTTPException(400, f"Service '{sid}' is not available in automated initiation")

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
    _write_env_file(_env_path(sid), prepared)
    await audit_event(request, "initiate.service_prepared", service_id=sid, keys=sorted(changed))
    return {"ok": True, "service_id": sid, "prepared": sorted(changed), "configured": True}


@app.post("/api/install/{sid}/prepare")
async def prepare_install_service(sid: str, request: Request):
    """Prepare one catalog service without exposing generated credentials."""
    require_trusted_request(request)
    service = service_by_id(sid)
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
        if sid == "open-webui":
            litellm_key = _parse_env_file(_env_path("litellm")).get("LITELLM_MASTER_KEY", "")
            if litellm_key:
                prepared["LITELLM_MASTER_KEY"] = litellm_key
                changed.append("LITELLM_MASTER_KEY")
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

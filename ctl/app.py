import asyncio
import json
import os
import secrets
import select
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import docker
import psutil
import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .compose import run_compose
from .catalog import discover_capabilities, load_catalog, policy_decision
from .initiate import AUTOMATED_SERVICES, prepare_environment
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
    if action not in {"up", "stop", "restart", "pull", "update"}:
        raise HTTPException(400, "Unknown approval action")
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
            "required": True,
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
    )
    _write_env_file(_env_path(sid), prepared)
    await audit_event(request, "initiate.service_prepared", service_id=sid, keys=sorted(changed))
    return {"ok": True, "service_id": sid, "prepared": sorted(changed), "configured": True}


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

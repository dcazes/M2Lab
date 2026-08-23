import asyncio
import json
import os
import secrets
import select
import time
import urllib.request
from pathlib import Path

import docker
import psutil
import yaml
from fastapi import Depends, FastAPI, HTTPException, Request, Header
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .compose import run_compose
from .registry import ROOT, SERVICES, service_by_id, SETTINGS

DLI = docker.DockerClient.from_env()
API = DLI.api

app = FastAPI(title="homelab-ctl", docs_url=None, redoc_url=None)

# ---------- per-service action mutex ----------
_action_locks: dict[str, asyncio.Lock] = {}

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
@app.post("/api/services/{sid}/destroy", dependencies=[Depends(require_token)])
async def destroy(sid: str, request: Request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse(status_code=400, content={"detail": "Invalid JSON body"})
    if body.get("confirm") != sid:
        raise HTTPException(400, 'body must be {"confirm":"<service-id>"}')
    s = service_by_id(sid)
    async with _action_locks.setdefault(sid, asyncio.Lock()):
        rc, out = await run_compose(s, ["down"])
    return JSONResponse({"ok": rc == 0, "output": out[-4000:]})


@app.post("/api/services/{sid}/{action}", dependencies=[Depends(require_token)])
async def action(sid: str, action: str):
    s = service_by_id(sid)
    if action not in {"up", "stop", "restart", "pull", "update"}:
        raise HTTPException(400, f"unknown action {action!r}")
    async with _action_locks.setdefault(sid, asyncio.Lock()):
        if action == "restart":
            rc, out = await run_compose(s, ["restart"])
        elif action == "update":
            rc1, o1 = await run_compose(s, ["pull"])
            rc2, o2 = await run_compose(s, ["up", "-d"])
            rc, out = (rc1 or rc2), o1 + "\n" + o2
        else:
            rc, out = await run_compose(s, [action] if action != "up" else ["up", "-d"])
    return JSONResponse({"ok": rc == 0, "output": out[-8000:]}, status_code=200 if rc == 0 else 500)


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
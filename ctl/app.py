import json
import os
import select
import time
import urllib.request
from pathlib import Path

import docker
import psutil
import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .compose import run_compose
from .registry import ROOT, SERVICES, service_by_id, SETTINGS

DLI = docker.DockerClient.from_env()
API = DLI.api

app = FastAPI(title="homelab-ctl", docs_url=None, redoc_url=None)


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
def list_services(request: Request):
    tailnet_base = SETTINGS.get("tailnet_base", "")
    src = request_source(request)
    out = []
    for s in SERVICES:
        st = svc_state(s)
        tailnet_port = s.get("tailnet_port")
        tailnet_url = f"{tailnet_base}:{tailnet_port}/" if tailnet_base and tailnet_port else None
        out.append({
            "id": s["id"], "display_name": s["display_name"], "description": s.get("description"),
            "category": s.get("category"), "icon": s.get("icon", "📦"),
            "port": s.get("port"), "url": s.get("url"),
            "tailnet_url": tailnet_url,
            "state": st["overall"], "containers": st["containers"],
            "healthy": http_health(s),
        })
    return {"services": out, "source": src}


# ---------- destroy (deliberate, double-confirmed in UI) ----------
@app.post("/api/services/{sid}/destroy")
async def destroy(sid: str, request: Request):
    body = await request.json()
    if body.get("confirm") != sid:
        raise HTTPException(400, 'body must be {"confirm":"<service-id>"}')
    s = service_by_id(sid)
    rc, out = await run_compose(s, ["down"])
    return JSONResponse({"ok": rc == 0, "output": out[-4000:]})


@app.post("/api/services/{sid}/{action}")
async def action(sid: str, action: str):
    s = service_by_id(sid)
    if action not in {"up", "stop", "restart", "pull", "update"}:
        raise HTTPException(400, f"unknown action {action!r}")
    if action == "restart":
        rc, out = await run_compose(s, ["restart"])
    elif action == "update":
        rc1, o1 = await run_compose(s, ["pull"])
        rc2, o2 = await run_compose(s, ["up", "-d"])
        rc, out = (rc1 or rc2), o1 + "\n" + o2
    else:
        rc, out = await run_compose(s, [action] if action != "up" else ["up", "-d"])
    return JSONResponse({"ok": rc == 0, "output": out[-8000:]}, status_code=200 if rc == 0 else 500)


@app.get("/api/services/{sid}/logs")
def logs(sid: str, tail: int = 200, follow: bool = True):
    s = service_by_id(sid)
    containers = [c for c in project_containers(s["project"])]
    if not containers:
        raise HTTPException(404, "no containers for project")

    def gen():
        for c in containers:
            yield f"event: meta data: {json.dumps({'container': c.attrs['Name'].lstrip('/')})}\n\n"
        streams = {c: c.logs(stream=True, follow=follow, tail=tail) for c in containers}
        while True:
            progressed = False
            for c, it in list(streams.items()):
                try:
                    line = next(it)
                    name = c.attrs["Name"].lstrip("/")
                    yield f"data: {json.dumps({'c': name, 'line': line.decode(errors='replace').rstrip()})}\n\n"
                    progressed = True
                except StopIteration:
                    del streams[c]
                except Exception:
                    pass
            if not streams:
                break
            if not progressed:
                time.sleep(0.25)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/system")
def system():
    du = psutil.disk_usage(ROOT.anchor or "/")
    return {
        "cpu_percent": psutil.cpu_percent(interval=0.2),
        "mem": psutil.virtual_memory()._asdict(),
        "disk": {"total": du.total, "used": du.used, "percent": du.percent},
        "docker_ok": bool(DLI.ping()),
    }


# ---------- static UI ----------
web_dir = ROOT / "ctl-web"
if web_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")


def main():
    import uvicorn
    port = int(os.environ.get("DASHBOARD_PORT",
               yaml.safe_load((ROOT / "services.yaml").read_text())["settings"]["dashboard_port"]))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
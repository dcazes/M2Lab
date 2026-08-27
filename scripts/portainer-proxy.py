"""
portainer-proxy.py — a tiny, secure pass-through shim in front of Portainer's API.

WHY THIS EXISTS
---------------
Portainer's API does not send CORS headers, so a browser loading Homepage
(localhost:8083) cannot call Portainer (localhost:9090) directly. This proxy:
  1. Adds CORS headers so the browser is allowed to call it cross-origin.
  2. Injects your Portainer API key SERVER-SIDE (read from PORTAINER_API_KEY),
     so the key is never embedded in custom.js or committed to git.

It exposes NO UI and runs NO docker logic of its own — it only forwards
authenticated requests to Portainer. The old :8787 "home dashboard" is fully
retired; this is a transparent shim on :8788.

Homepage's custom.js calls http://localhost:8788/api/... and this forwards to
http://localhost:9090/api/... with the key added.
"""
import os
import requests
from fastapi import FastAPI, Request, Response

PORTAINER = os.environ.get("PORTAINER_URL", "http://localhost:9090")
API_KEY = os.environ.get("PORTAINER_API_KEY", "")

app = FastAPI()


def _with_cors(resp: Response) -> Response:
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
    resp.headers["Access-Control-Allow-Headers"] = "*"
    return resp


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"])
async def proxy(path: str, request: Request):
    # Preflight: answer CORS checks without bothering Portainer.
    if request.method == "OPTIONS":
        return _with_cors(Response(status_code=200))

    url = f"{PORTAINER}{request.url.path}"
    if request.url.query:
        url += "?" + request.url.query

    # Forward caller headers, but drop hop-by-hop + host, and force the key.
    headers = {k: v for k, v in request.headers.items()
               if k.lower() not in ("host", "content-length", "content-type")}
    headers["X-API-Key"] = API_KEY
    headers["Content-Type"] = request.headers.get("content-type", "application/json")

    body = await request.body()
    try:
        r = requests.request(request.method, url, headers=headers, data=body, timeout=300)
    except requests.RequestException as e:
        return _with_cors(Response(content=str(e).encode(), status_code=502))

    resp = Response(content=r.content, status_code=r.status_code)
    for k, v in r.headers.items():
        if k.lower() in ("content-length", "content-encoding", "transfer-encoding", "connection"):
            continue
        resp.headers[k] = v
    return _with_cors(resp)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8788, log_level="info")

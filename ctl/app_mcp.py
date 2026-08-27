"""Isolated, read-focused MCP adapters for applications with stable HTTP APIs."""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import urllib.parse
import urllib.request

from mcp.server.fastmcp import FastMCP
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .registry import ROOT, service_by_id

PORTS = {"firecrawl": 8812, "paperless-ngx": 8815, "immich": 8816, "ollama": 8817}


def _parse_env_file(path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def _json_request(url: str, *, method: str = "GET", headers: dict[str, str] | None = None,
                  body: dict | None = None) -> dict:
    payload = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=payload, method=method,
                                     headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, token: str):
        super().__init__(app)
        self.token = token

    async def dispatch(self, request: Request, call_next):
        supplied = request.headers.get("Authorization", "").removeprefix("Bearer ")
        if not supplied or not secrets.compare_digest(supplied, self.token):
            return JSONResponse({"error": "invalid bearer token"}, status_code=401)
        return await call_next(request)


def build_server(sid: str) -> FastMCP:
    service = service_by_id(sid)
    env = _parse_env_file(ROOT / service["dir"] / ".env")
    mcp = FastMCP(f"m2lab-{sid}")

    if sid == "firecrawl":
        headers = {"Authorization": f"Bearer {env.get('TEST_API_KEY', '')}"}

        @mcp.tool(name="firecrawl_scrape")
        def scrape(url: str) -> str:
            """Scrape one explicitly selected URL into clean content."""
            return json.dumps(_json_request("http://127.0.0.1:3002/v1/scrape", method="POST", headers=headers,
                                            body={"url": url, "formats": ["markdown"]}))

        @mcp.tool(name="firecrawl_search")
        def search(query: str, limit: int = 5) -> str:
            """Search the web and return a bounded result set."""
            return json.dumps(_json_request("http://127.0.0.1:3002/v1/search", method="POST", headers=headers,
                                            body={"query": query, "limit": max(1, min(limit, 10))}))

    elif sid == "paperless-ngx":
        headers = {"Authorization": f"Token {env.get('PAPERLESS_API_TOKEN', '')}"}

        @mcp.tool(name="paperless_search")
        def search(query: str, limit: int = 10) -> str:
            """Search Paperless document metadata without downloading originals."""
            url = "http://127.0.0.1:8010/api/documents/?" + urllib.parse.urlencode({"query": query, "page_size": max(1, min(limit, 25))})
            return json.dumps(_json_request(url, headers=headers))

        @mcp.tool(name="paperless_document")
        def document(document_id: int) -> str:
            """Read metadata for one Paperless document."""
            return json.dumps(_json_request(f"http://127.0.0.1:8010/api/documents/{int(document_id)}/", headers=headers))

    elif sid == "immich":
        headers = {"x-api-key": env.get("IMMICH_API_KEY", "")}

        @mcp.tool(name="immich_search")
        def search(query: str, limit: int = 10) -> str:
            """Search Immich assets using its documented metadata API."""
            body = {"originalFileName": query, "size": max(1, min(limit, 25))}
            return json.dumps(_json_request("http://127.0.0.1:2283/api/search/metadata", method="POST", headers=headers, body=body))

    elif sid == "ollama":
        @mcp.tool(name="ollama_list")
        def list_models() -> str:
            """List locally installed Ollama models."""
            return json.dumps(_json_request("http://127.0.0.1:11434/api/tags"))
    return mcp


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("service", choices=sorted(PORTS))
    args = parser.parse_args()
    root_env = _parse_env_file(ROOT / ".env")
    token = os.environ.get("CTL_MCP_TOKEN") or root_env.get("CTL_MCP_TOKEN")
    if not token:
        print("CTL_MCP_TOKEN is required", file=sys.stderr)
        raise SystemExit(1)
    mcp = build_server(args.service)
    wrapped = mcp.streamable_http_app()
    wrapped.add_middleware(AuthMiddleware, token=token)
    import uvicorn
    uvicorn.run(wrapped, host="127.0.0.1", port=PORTS[args.service], log_level="info")


if __name__ == "__main__":
    main()

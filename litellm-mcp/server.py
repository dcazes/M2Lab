#!/usr/bin/env python3
"""LiteLLM MCP server - read-only OpenAPI wrapper over the LiteLLM proxy.

Fetches LiteLLM's /openapi.json at startup, exposes only GET routes as MCP
tools (read-only profile), serves streamable-HTTP on :8000 behind a static
bearer token.
"""
import os

import httpx
from fastmcp import FastMCP
from fastmcp.server.auth.providers.jwt import StaticTokenVerifier
from fastmcp.server.openapi import MCPType, RouteMap
from starlette.responses import JSONResponse

LITELLM_BASE = os.getenv("LITELLM_BASE_URL", "http://litellm-proxy:4000")
MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "")
MCP_TOKEN = os.getenv("LITELLM_MCP_TOKEN", "")
if not MASTER_KEY or not MCP_TOKEN:
    raise SystemExit("LITELLM_MASTER_KEY and LITELLM_MCP_TOKEN must be set")

_auth = {"Authorization": f"Bearer {MASTER_KEY}"}

# Sync fetch of the spec at startup (from_openapi needs a dict).
with httpx.Client(base_url=LITELLM_BASE, headers=_auth, timeout=30.0) as c:
    resp = c.get("/openapi.json")
    resp.raise_for_status()
    openapi_spec = resp.json()

# Long-lived async client used by FastMCP for tool calls.
client = httpx.AsyncClient(base_url=LITELLM_BASE, headers=_auth, timeout=60.0)

# Read-only profile: GET routes become tools; everything else excluded.
route_maps = [
    RouteMap(methods=["GET"], mcp_type=MCPType.TOOL),
    RouteMap(mcp_type=MCPType.EXCLUDE),
]

verifier = StaticTokenVerifier(
    tokens={MCP_TOKEN: {"client_id": "litellm-mcp", "scopes": ["litellm:read"]}},
    required_scopes=["litellm:read"],
)

mcp = FastMCP.from_openapi(
    openapi_spec=openapi_spec,
    client=client,
    name="litellm-mcp",
    route_maps=route_maps,
    auth=verifier,
)


@mcp.custom_route("/health", methods=["GET"])
async def health(request):  # noqa: ANN001
    return JSONResponse({"status": "ok"})


if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="0.0.0.0", port=8000, path="/mcp")
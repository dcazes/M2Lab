"""Federated MCP registry, safe overrides, health checks, and harness exports."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from copy import deepcopy
from pathlib import Path
from typing import Any

from .catalog import RISK_ORDER, load_catalog
from .registry import ROOT

STATE_PATH = ROOT / ".state" / "mcp-overrides.json"
HARNESS_DIR = ROOT / ".state" / "mcp-harnesses"
VALID_STATES = {
    "unavailable", "installing", "authentication_required", "verifying",
    "live", "degraded", "disabled",
}
VALID_KINDS = {"native", "community", "omnilab-adapter", "unsupported"}
VALID_TRANSPORTS = {"streamable-http", "stdio", "none"}


def _read_json(path: Path, default: Any) -> Any:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value
    except (OSError, json.JSONDecodeError):
        return deepcopy(default)


def load_overrides() -> dict[str, Any]:
    data = _read_json(STATE_PATH, {"servers": {}})
    return data if isinstance(data, dict) and isinstance(data.get("servers"), dict) else {"servers": {}}


def save_overrides(data: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, STATE_PATH)


def validate_manifest(app: dict[str, Any]) -> None:
    manifest = app.get("mcp")
    if not isinstance(manifest, dict):
        raise ValueError(f"catalog app {app['id']} requires an mcp manifest")
    if manifest.get("kind") not in VALID_KINDS:
        raise ValueError(f"catalog app {app['id']} has invalid mcp kind")
    if manifest.get("transport") not in VALID_TRANSPORTS:
        raise ValueError(f"catalog app {app['id']} has invalid mcp transport")
    if manifest["kind"] == "community" and not manifest.get("pin"):
        raise ValueError(f"community MCP {app['id']} must be version pinned")
    tool_ids: set[str] = set()
    for tool in manifest.get("tools", []):
        if not isinstance(tool, dict) or not tool.get("id") or tool.get("risk") not in RISK_ORDER:
            raise ValueError(f"catalog app {app['id']} has invalid MCP tool")
        if tool["id"] in tool_ids:
            raise ValueError(f"catalog app {app['id']} repeats MCP tool {tool['id']}")
        tool_ids.add(tool["id"])


def validate_catalog_manifests(catalog: dict[str, Any] | None = None) -> None:
    catalog = catalog or load_catalog()
    seen: set[str] = set()
    for app in catalog["apps"]:
        validate_manifest(app)
        server_id = app["mcp"].get("server_id", app["id"])
        if server_id in seen:
            raise ValueError(f"duplicate MCP server id {server_id}")
        seen.add(server_id)


def _probe(url: str, token: str | None) -> tuple[str, str | None]:
    if not url:
        return "unavailable", None
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    request = urllib.request.Request(url, method="GET", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=1.5) as response:
            if response.status < 500:
                return "live", None
    except urllib.error.HTTPError as error:
        if error.code in {401, 403}:
            return ("authentication_required" if not token else "degraded"), "MCP authentication was rejected"
        # Streamable HTTP MCP endpoints commonly reject a plain GET with 405
        # or 406 after authentication; that still proves the protected server.
        if error.code in {405, 406}:
            return "live", None
        return "degraded", f"Endpoint returned HTTP {error.code}"
    except (OSError, urllib.error.URLError):
        return "unavailable", "MCP endpoint is not reachable"
    return "degraded", "MCP verification failed"


def _secret_configured(manifest: dict[str, Any]) -> bool:
    env_ref = manifest.get("auth", {}).get("env")
    if not env_ref:
        return manifest.get("auth", {}).get("type", "none") == "none"
    service_dir = manifest.get("auth", {}).get("service_dir")
    if not service_dir:
        return bool(os.environ.get(env_ref))
    path = ROOT / service_dir / ".env"
    if not path.exists():
        return False
    return any(line.split("=", 1)[0].strip() == env_ref and line.split("=", 1)[1].strip()
               for line in path.read_text(encoding="utf-8").splitlines() if "=" in line)


def _secret_value(manifest: dict[str, Any]) -> str | None:
    env_ref = manifest.get("auth", {}).get("env")
    if not env_ref:
        return None
    service_dir = manifest.get("auth", {}).get("service_dir")
    if not service_dir:
        return os.environ.get(env_ref)
    path = ROOT / service_dir / ".env"
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and line.split("=", 1)[0].strip() == env_ref:
            return line.split("=", 1)[1].strip() or None
    return None


def registry_snapshot(service_states: dict[str, str] | None = None, verify: bool = False) -> dict[str, Any]:
    catalog = load_catalog()
    validate_catalog_manifests(catalog)
    overrides = load_overrides()["servers"]
    ctl_override = overrides.get("omnilab", {})
    ctl_auth = bool(os.environ.get("CTL_MCP_TOKEN")) or any(
        line.startswith("CTL_MCP_TOKEN=") and line.split("=", 1)[1].strip()
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines()
    ) if (ROOT / ".env").exists() else bool(os.environ.get("CTL_MCP_TOKEN"))
    ctl_enabled = bool(ctl_override.get("enabled", True))
    if not ctl_enabled:
        ctl_state, ctl_error = "disabled", None
    elif not ctl_auth:
        ctl_state, ctl_error = "authentication_required", "CTL_MCP_TOKEN is required"
    elif verify:
        ctl_token = os.environ.get("CTL_MCP_TOKEN")
        if not ctl_token and (ROOT / ".env").exists():
            ctl_token = next((line.split("=", 1)[1].strip() for line in (ROOT / ".env").read_text().splitlines()
                              if line.startswith("CTL_MCP_TOKEN=")), None)
        ctl_state, ctl_error = _probe("http://127.0.0.1:8790/mcp", ctl_token)
    else:
        ctl_state, ctl_error = "verifying", None
    ctl_tools = [
        {"id": "omnilab.status", "title": "Inspect service status", "label": "Inspect service status", "risk": "read", "effective_risk": "read", "enabled": True, "context": ""},
        {"id": "omnilab.lifecycle", "title": "Manage service lifecycle", "label": "Manage service lifecycle", "risk": "operational", "effective_risk": "operational", "enabled": True, "context": ""},
    ]
    for tool in ctl_tools:
        custom = ctl_override.get("tools", {}).get(tool["id"], {})
        tool["enabled"] = bool(custom.get("enabled", tool["enabled"]))
        tool["label"] = custom.get("label", tool["label"])
        tool["context"] = custom.get("context", "")
        requested_risk = custom.get("risk", tool["risk"])
        tool["effective_risk"] = requested_risk if requested_risk in RISK_ORDER and RISK_ORDER[requested_risk] >= RISK_ORDER[tool["risk"]] else tool["risk"]
    servers: list[dict[str, Any]] = [{
        "id": "omnilab", "app_id": "omnilab", "service_id": None, "name": "OmniLab Control",
        "icon": "◉", "app_state": "running", "kind": "native", "transport": "streamable-http",
        "endpoint": "http://127.0.0.1:8790/mcp", "source": "OmniLab lifecycle and discovery server",
        "maintainer": "OmniLab", "pin": None, "trust": "official",
        "auth": {"type": "bearer", "configured": ctl_auth, "scopes": ["service-read", "service-lifecycle"], "env_ref": "CTL_MCP_TOKEN"},
        "enabled": ctl_enabled, "state": ctl_state, "error": ctl_error,
        "context": ctl_override.get("context", ""), "harnesses": ctl_override.get("harnesses", ["opencode", "open-webui"]),
        "tools": ctl_tools, "last_verified": ctl_override.get("last_verified"),
    }]
    for app in catalog["apps"]:
        manifest = deepcopy(app["mcp"])
        sid = manifest.get("server_id", app["id"])
        override = overrides.get(sid, {})
        installed_state = service_states.get(app.get("service_id", ""), "absent") if service_states is not None else "unknown"
        supported = manifest["kind"] != "unsupported"
        default_enabled = bool(manifest.get("default_enabled", manifest["kind"] in {"native", "omnilab-adapter"}))
        enabled = bool(override.get("enabled", default_enabled)) and supported
        auth_ok = _secret_configured(manifest)
        if not supported:
            state, error = "unavailable", manifest.get("reason", "No reviewed automation interface")
        elif installed_state == "absent":
            state, error = "unavailable", "Install the app before enabling its MCP server"
        elif not enabled:
            state, error = "disabled", None
        elif not auth_ok:
            state, error = "authentication_required", "A dedicated integration credential is required"
        elif verify:
            if manifest["kind"] == "omnilab-adapter":
                root_path = ROOT / ".env"
                probe_token = os.environ.get("CTL_MCP_TOKEN") or (next((line.split("=", 1)[1].strip()
                    for line in root_path.read_text().splitlines() if line.startswith("CTL_MCP_TOKEN=")), None)
                    if root_path.exists() else None)
            else:
                probe_token = _secret_value(manifest)
            state, error = _probe(manifest.get("endpoint", ""), probe_token)
        else:
            state, error = "verifying", None
        tools = []
        tool_overrides = override.get("tools", {})
        for tool in manifest.get("tools", []):
            item = deepcopy(tool)
            custom = tool_overrides.get(tool["id"], {})
            item["enabled"] = bool(custom.get("enabled", True))
            item["label"] = custom.get("label", tool.get("title", tool["id"]))
            item["context"] = custom.get("context", "")
            item["effective_risk"] = custom.get("risk", tool["risk"])
            tools.append(item)
        servers.append({
            "id": sid, "app_id": app["id"], "service_id": app.get("service_id"),
            "name": app["name"], "icon": app["icon"], "app_state": installed_state,
            "kind": manifest["kind"], "transport": manifest["transport"],
            "endpoint": manifest.get("public_endpoint") or manifest.get("endpoint"),
            "source": manifest.get("source"), "maintainer": manifest.get("maintainer"),
            "pin": manifest.get("pin"), "trust": manifest.get("trust", "unreviewed"),
            "auth": {"type": manifest.get("auth", {}).get("type", "none"), "configured": auth_ok,
                     "scopes": manifest.get("auth", {}).get("scopes", []),
                     "env_ref": "CTL_MCP_TOKEN" if manifest["kind"] == "omnilab-adapter" else manifest.get("auth", {}).get("env")},
            "enabled": enabled, "state": state, "error": error,
            "context": override.get("context", ""),
            "harnesses": override.get("harnesses", manifest.get("harnesses", ["opencode", "open-webui"])),
            "tools": tools, "last_verified": override.get("last_verified"),
        })
    summary = {state: sum(server["state"] == state for server in servers)
               for state in ("live", "degraded", "authentication_required", "disabled", "unavailable")}
    return {"servers": servers, "summary": summary}


def update_server(server_id: str, patch: dict[str, Any]) -> None:
    snapshot = registry_snapshot()
    server = next((item for item in snapshot["servers"] if item["id"] == server_id), None)
    if not server:
        raise KeyError(server_id)
    data = load_overrides()
    current = data["servers"].setdefault(server_id, {})
    if "enabled" in patch:
        current["enabled"] = bool(patch["enabled"])
    if "context" in patch:
        current["context"] = str(patch["context"])[:2000]
    if "harnesses" in patch:
        current["harnesses"] = [h for h in patch["harnesses"] if h in {"opencode", "open-webui"}]
    tool_patch = patch.get("tools", {})
    known_tools = {tool["id"]: tool for tool in server["tools"]}
    for tool_id, values in tool_patch.items():
        if tool_id not in known_tools or not isinstance(values, dict):
            continue
        target = current.setdefault("tools", {}).setdefault(tool_id, {})
        if "enabled" in values:
            target["enabled"] = bool(values["enabled"])
        if "label" in values:
            target["label"] = str(values["label"])[:120]
        if "context" in values:
            target["context"] = str(values["context"])[:1000]
        if "risk" in values:
            requested = str(values["risk"])
            minimum = known_tools[tool_id]["risk"]
            if requested not in RISK_ORDER or RISK_ORDER[requested] < RISK_ORDER[minimum]:
                raise ValueError(f"risk for {tool_id} cannot be lower than {minimum}")
            target["risk"] = requested
    save_overrides(data)


def mark_verified(server_id: str) -> None:
    data = load_overrides()
    data["servers"].setdefault(server_id, {})["last_verified"] = int(time.time())
    save_overrides(data)


def harness_preview(snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
    snapshot = snapshot or registry_snapshot()
    active = [s for s in snapshot["servers"] if s["enabled"] and s["state"] not in {"unavailable", "disabled"}]
    # OpenCode 1.x expects named servers directly under `mcp`.
    opencode = {"mcp": {}}
    openwebui = {"servers": []}
    for server in active:
        if not server.get("endpoint"):
            continue
        entry = {"type": "remote", "url": server["endpoint"], "oauth": False}
        env_ref = server.get("auth", {}).get("env_ref")
        if env_ref:
            entry["headers"] = {"Authorization": f"Bearer {{env:{env_ref}}}"}
        if "opencode" in server["harnesses"]:
            entry["enabled"] = True
            opencode["mcp"][server["id"]] = entry
        if "open-webui" in server["harnesses"] and server["transport"] == "streamable-http":
            openwebui["servers"].append({"id": server["id"], "url": server["endpoint"], "type": "mcp",
                                         "auth": {"type": server["auth"]["type"], "env": env_ref}})
    return {"opencode": opencode, "open_webui": openwebui}


def write_harness_exports() -> dict[str, str]:
    HARNESS_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    preview = harness_preview(registry_snapshot(verify=True))
    paths = {}
    for key, payload in preview.items():
        path = HARNESS_DIR / f"{key}.json"
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        path.chmod(0o600)
        paths[key] = str(path)
    return paths

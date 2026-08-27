"""Catalog and progressive capability discovery for M2Lab."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "catalog.yaml"
RISK_ORDER = {"read": 0, "draft": 1, "write": 2, "operational": 3, "destructive": 4, "privileged": 5}
APP_KINDS = {"service", "companion", "infrastructure", "harness"}
AVAILABILITY = {"available", "evaluation", "planned"}
REQUIRED_APP_FIELDS = {
    "id", "name", "tagline", "description", "category", "kind",
    "availability", "icon", "accent", "setup_minutes", "ai_optional",
    "outcomes", "requirements", "capabilities",
}
# Sentinel used in catalog.yaml links that should point at the hosting repo
# itself (e.g. a private service bundled in this repo's tree). Resolved at load
# time from the git remote so the link is correct on any clone/setup.
REPO_LINK_SENTINEL = "{{repo}}"


def load_catalog() -> dict[str, Any]:
    raw = yaml.safe_load(CATALOG_PATH.read_text())
    if not isinstance(raw, dict) or raw.get("schema_version") != 1:
        raise ValueError("catalog.yaml must declare schema_version: 1")
    apps = raw.get("apps")
    if not isinstance(apps, list):
        raise ValueError("catalog.yaml apps must be a list")
    ids = [app.get("id") for app in apps]
    if any(not isinstance(app_id, str) or not app_id for app_id in ids):
        raise ValueError("every catalog app needs a non-empty id")
    if len(ids) != len(set(ids)):
        raise ValueError("catalog app ids must be unique")
    manifests = raw.get("mcp_servers", {})
    if not isinstance(manifests, dict):
        raise ValueError("catalog.yaml mcp_servers must be a mapping")
    unknown_manifests = set(manifests) - set(ids)
    if unknown_manifests:
        raise ValueError(f"MCP manifests reference unknown apps: {sorted(unknown_manifests)}")
    for app in apps:
        app["mcp"] = manifests.get(app["id"], {
            "kind": "unsupported", "transport": "none",
            "reason": "No reviewed MCP implementation is registered",
        })
    app_ids = set(ids)
    for app in apps:
        missing = REQUIRED_APP_FIELDS - set(app)
        if missing:
            raise ValueError(f"catalog app {app['id']} missing: {', '.join(sorted(missing))}")
        if app["kind"] not in APP_KINDS:
            raise ValueError(f"catalog app {app['id']} has unknown kind")
        if app["availability"] not in AVAILABILITY:
            raise ValueError(f"catalog app {app['id']} has unknown availability")
        for capability in app["capabilities"]:
            if capability.get("risk") not in RISK_ORDER:
                raise ValueError(f"catalog capability {capability.get('id')} has unknown risk")
            if not isinstance(capability.get("tools"), list):
                raise ValueError(f"catalog capability {capability.get('id')} tools must be a list")
    for profile in raw.get("profiles", []):
        unknown = set(profile.get("apps", [])) - app_ids
        if unknown:
            raise ValueError(f"catalog profile {profile.get('id')} references unknown apps: {sorted(unknown)}")
    for workflow in raw.get("workflows", []):
        unknown = set(workflow.get("apps", [])) - app_ids
        if unknown:
            raise ValueError(f"catalog workflow {workflow.get('id')} references unknown apps: {sorted(unknown)}")
    repo_url = _repo_http_url()
    for app in apps:
        _resolve_repo_links(app, repo_url)
    return raw


def _repo_remote() -> str | None:
    """Return the repo's origin remote URL, or None when unavailable."""
    try:
        result = subprocess.run(
            ["git", "-C", str(ROOT), "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=5,
        )
        return (result.stdout or "").strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def _repo_http_url() -> str | None:
    """Normalize the git remote into an https:// homepage URL."""
    remote = _repo_remote()
    if not remote:
        return None
    url = remote.removesuffix(".git")
    if url.startswith("git@"):
        url = url.replace(":", "/", 1)  # git@github.com:owner/repo -> git@github.com/owner/repo
        url = "https://" + url.split("@", 1)[1]
    elif url.startswith("ssh://git@"):
        url = "https://" + url.split("@", 1)[1]
    return url


def _resolve_repo_links(app: dict[str, Any], repo_url: str | None) -> None:
    """Point {{repo}} sentinel links at the hosting repository (any setup)."""
    links = app.get("links")
    if not isinstance(links, dict) or not repo_url:
        return
    for key in ("homepage", "source"):
        if links.get(key) == REPO_LINK_SENTINEL:
            links[key] = repo_url


def discover_capabilities(query: str, catalog: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Rank matching capabilities without loading every tool schema.

    This deliberately starts with inspectable lexical matching. A future
    embedding router can preserve this response contract if real usage proves
    lexical discovery insufficient.
    """
    catalog = catalog or load_catalog()
    tokens = set(re.findall(r"[a-z0-9]+", query.lower()))
    matches: list[tuple[int, dict[str, Any]]] = []
    for app in catalog["apps"]:
        app_text = " ".join(
            str(app.get(key, "")) for key in ("id", "name", "tagline", "description", "category")
        ).lower()
        for capability in app.get("capabilities", []):
            haystack = f"{app_text} {capability.get('id', '')} {capability.get('title', '')}".lower()
            score = sum(1 for token in tokens if token in haystack)
            if not tokens or score:
                matches.append((score, {"app_id": app["id"], "app_name": app["name"], **capability}))
    matches.sort(key=lambda item: (-item[0], RISK_ORDER.get(item[1].get("risk", "privileged"), 99), item[1]["app_id"]))
    return [match for _, match in matches[:12]]


def discover_workflows(query: str, catalog: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Return a small workflow shortlist using the same inspectable router."""
    catalog = catalog or load_catalog()
    tokens = set(re.findall(r"[a-z0-9]+", query.lower()))
    apps = {app["id"]: app["name"] for app in catalog["apps"]}
    matches: list[tuple[int, dict[str, Any]]] = []
    for workflow in catalog.get("workflows", []):
        haystack = f"{workflow.get('id', '')} {workflow.get('name', '')} {workflow.get('description', '')}".lower()
        score = sum(1 for token in tokens if token in haystack)
        if not tokens or score:
            matches.append((score, {**workflow, "app_names": [apps[app_id] for app_id in workflow["apps"]]}))
    matches.sort(key=lambda item: (-item[0], item[1]["id"]))
    return [match for _, match in matches[:5]]


def policy_decision(risk: str) -> dict[str, Any]:
    if risk == "read":
        return {"decision": "allow", "approval": "none"}
    if risk == "draft":
        return {"decision": "allow", "approval": "label-as-draft"}
    if risk in {"write", "operational"}:
        return {"decision": "require_approval", "approval": "explicit"}
    if risk == "destructive":
        return {"decision": "require_approval", "approval": "typed-confirmation"}
    return {"decision": "deny", "approval": "never-autonomous"}

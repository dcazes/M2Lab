"""Small, secret-free identity inventory for the SSO rollout.

This module deliberately contains no client secrets and does not configure an
application by pretending that every product has the same OAuth interface.
It is the dashboard's truthful source for rollout state and safe preflight
checks.  Provider creation and secrets remain in Authentik/host-only env
files.
"""
from __future__ import annotations

from datetime import datetime, timezone
from urllib.error import URLError
from urllib.request import Request, urlopen

from .registry import SETTINGS, service_by_id


NATIVE = "native_sso"
GATE = "access_gate_only"
MACHINE = "machine_only"
PENDING = "configuration_pending"

# Callback paths are deliberately explicit.  A value of None means the app's
# documented admin/API configuration must be completed before we claim native
# SSO; it must never be guessed from an OAuth convention.
APPS: tuple[dict, ...] = (
    {"id": "open-webui", "mode": NATIVE, "provider": "open-webui", "callback": "/oauth/oidc/callback", "groups": True},
    {"id": "immich", "mode": NATIVE, "provider": "immich", "callback": None, "groups": True},
    {"id": "paperless-ngx", "mode": NATIVE, "provider": "paperless", "callback": None, "groups": True},
    {"id": "mealie", "mode": NATIVE, "provider": "mealie", "callback": None, "groups": True},
    {"id": "adventurelog", "mode": NATIVE, "provider": "adventurelog", "callback": None, "groups": True},
    {"id": "nextcloud", "mode": NATIVE, "provider": "nextcloud", "callback": None, "groups": True},
    {"id": "actual-budget", "mode": NATIVE, "provider": "actual-budget", "callback": None, "groups": True},
    {"id": "beszel", "mode": NATIVE, "provider": "beszel", "callback": None, "groups": True},
    {"id": "puppygraph", "mode": NATIVE, "provider": "puppygraph", "callback": None, "groups": True},
    {"id": "vaultwarden", "mode": NATIVE, "provider": "vaultwarden", "callback": None, "groups": True, "master_unlock": True},
    {"id": "portainer", "mode": PENDING, "provider": "portainer", "callback": None, "groups": True},
    {"id": "surfsense", "mode": GATE, "provider": "surfsense-gate", "callback": None, "local_login_required": True},
    {"id": "litellm", "mode": GATE, "provider": "litellm-gate", "callback": None, "owner_only": True},
    {"id": "firecrawl", "mode": GATE, "provider": "firecrawl-gate", "callback": None, "owner_only": True},
    {"id": "freellmapi", "mode": GATE, "provider": "freellmapi-gate", "callback": None, "owner_only": True},
    {"id": "ollama", "mode": MACHINE, "provider": None, "callback": None},
)


def external_url(service_id: str) -> str | None:
    service = service_by_id(service_id)
    port = service.get("tailnet_port")
    return f"{SETTINGS['tailnet_base']}:{port}/" if port else None


def app_inventory(states: dict[str, str] | None = None) -> list[dict]:
    states = states or {}
    rows = []
    for raw in APPS:
        item = dict(raw)
        item["external_url"] = external_url(item["id"])
        item["app_state"] = states.get(item["id"], "unknown")
        item["owner_group"] = "omnilab-owners"
        item["member_group"] = "omnilab-members"
        item["verification"] = "not_verified"
        item["last_verified_at"] = None
        item["failure"] = None
        rows.append(item)
    return rows


def verify_app(app_id: str, states: dict[str, str]) -> dict:
    item = next((row for row in app_inventory(states) if row["id"] == app_id), None)
    if not item:
        raise KeyError(app_id)
    if item["mode"] == MACHINE:
        item.update(verification="not_applicable", last_verified_at=datetime.now(timezone.utc).isoformat())
        return item
    if item["app_state"] != "running":
        item.update(verification="app_not_running", failure="Start the application before identity verification.")
        return item
    if item["mode"] == PENDING:
        item.update(verification="preflight_required", failure="Confirm the installed edition supports OAuth before enabling it.")
        return item
    try:
        # The local health endpoint is the safe preflight.  OAuth callbacks are
        # not followed because that would create a browser session.
        service = service_by_id(app_id)
        health = service.get("health", {})
        if health.get("mode") == "http":
            req = Request(health["url"], method="GET")
            with urlopen(req, timeout=3) as response:
                if response.status != health.get("expect", 200):
                    raise URLError(f"health returned {response.status}")
        item.update(verification="reachable", last_verified_at=datetime.now(timezone.utc).isoformat())
    except Exception:
        item.update(verification="unreachable", failure="The local application health check did not pass.")
    return item


def status(states: dict[str, str]) -> dict:
    rows = app_inventory(states)
    return {
        "enforced": False,
        "provider": "authentik",
        "groups": ["omnilab-owners", "omnilab-members"],
        "apps": {mode: sum(1 for app in rows if app["mode"] == mode) for mode in (NATIVE, GATE, MACHINE, PENDING)},
        "note": "Identity enforcement is enabled only after Caddy and Authentik pass the staged cutover check.",
    }

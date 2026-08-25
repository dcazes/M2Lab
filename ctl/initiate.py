"""Safe environment preparation for the OmniLab initiation flow."""

from __future__ import annotations

import secrets
from typing import Callable

CORE_SERVICES = ("vaultwarden", "litellm", "firecrawl")
FOUNDATION_SERVICES = ("nextcloud", "surfsense")
AUTOMATED_SERVICES = set(CORE_SERVICES + FOUNDATION_SERVICES)


def _unset(value: str | None, placeholders: set[str]) -> bool:
    return value is None or not value.strip() or value.strip().lower() in placeholders


def prepare_environment(
    service_id: str,
    current: dict[str, str],
    example: dict[str, str],
    *,
    replace_placeholders: bool = True,
    token_factory: Callable[[int], str] = secrets.token_hex,
) -> tuple[dict[str, str], list[str]]:
    """Return a prepared env mapping and the keys OmniLab changed.

    Existing non-placeholder values are always preserved. Placeholder rotation
    can be disabled for an already-created stack so setup never invalidates a
    database initialized with an older development password.
    """
    if service_id not in AUTOMATED_SERVICES:
        raise ValueError(f"{service_id!r} is not part of automated initiation")

    values = {**example, **current}
    changed: list[str] = []

    def ensure(key: str, length: int = 32, placeholders: set[str] | None = None) -> str:
        placeholder_set = placeholders or {"change_me", "changeme", "your_secret_key_here"}
        value = values.get(key)
        needs_value = not value or (replace_placeholders and _unset(value, placeholder_set))
        if needs_value:
            values[key] = token_factory(length)
            changed.append(key)
        return values[key]

    if service_id == "vaultwarden":
        ensure("ADMIN_TOKEN", placeholders={"your_argon2_hash", "change_me", "changeme"})
    elif service_id == "litellm":
        ensure("LITELLM_MASTER_KEY")
        ensure("LITELLM_MCP_KEY")
        postgres_password = ensure("POSTGRES_PASSWORD", 24)
        values.setdefault("FREE_LLMAPI_API_KEY", "")
        database_url = values.get("DATABASE_URL", "")
        if not database_url or (replace_placeholders and "change_me" in database_url):
            values["DATABASE_URL"] = f"postgresql://litellm:{postgres_password}@litellm-db:5432/litellm"
            changed.append("DATABASE_URL")
    elif service_id == "firecrawl":
        ensure("TEST_API_KEY")
        ensure("POSTGRES_PASSWORD", 24, {"postgres", "change_me", "changeme"})
    elif service_id == "nextcloud":
        ensure("NEXTCLOUD_DBPASSWORD", 24)
    elif service_id == "surfsense":
        ensure("SECRET_KEY")

    return values, changed

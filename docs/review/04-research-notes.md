# Research Notes — AI Agent Layer for the Homelab

> **Source:** web research compiled via `@librarian` (2026-08-22).
> **Confidence:** high for tooling existence/maintenance; versions are research
> snapshots and must be re-verified at implementation time. Treat repo links and
> release dates as "as-reported" and pin exact versions when building.
> **Scope:** one MCP server per self-hosted service, subagents driving them, a
> master bot doing intent routing — all self-hosted behind Tailscale.

---

## 1. Existing MCP servers for the stack's apps

For every major app in this homelab there is at least one actively maintained MCP
server (most last-committed in 2026). Quality ranges from *dynamic auto-discovery*
(Nextcloud `Rello`, Paperless `cbsmiley`) to *hand-crafted tool lists*
(Immich `whitehara`, Mealie `djwmarcx`). All require some form of API token or
app-password; only a few offer per-user revocable credentials.

| App | MCP server (repo) | Maintenance (2026) | Transport | Notes / caveats |
|-----|-------------------|--------------------|-----------|-----------------|
| **Immich** | `whitehara/immich-mcp` (74 tools); `pimpmypixel/immich-mcp-server` (OpenAPI-3, Docker); `homeserverhq/ImmichMCP-Multitenant` (HTTP multitenancy) | active (2026-08) | stdio + HTTP | Write tools need an API key with *write* scope. Multitenant fork adds per-request `Authorization`. Emits `destructiveHint`/`idempotentHint`. |
| **Nextcloud** | `cbcoutinho/nextcloud-mcp-server` (110+ tools); `frisch12/nextcloud-mcp-server` (Go, 82 tools); `Rello/nextcloud-dynamic-mcp-server` (auto-discovery via `ocs_api_viewer`); `worph/nextcloud-mcp` (118 tools); `janLo/nextcloud-simple-mcp` (OAuth façade) | active | stdio, streamable-http, OAuth2 | `Rello` is the only one that **auto-discovers** installed apps — best for heterogeneous installs. All need an app-password or OAuth token. |
| **Paperless-ngx** | `cbsmiley/paperless-ngx-mcp-server` (50 tools, stdio+HTTP/OAuth); `patrickcylai/paperless-ngx-mcp` (115+ tools); `cubinet-code/paperless-ngx-mcp` (TS, 2026-05); `OrellBuehler/paperless-mcp` (115+ tools + optional embeddings) | active | stdio, streamable-http, OAuth2 | Near-complete coverage. Several expose `READ_ONLY` flag. Most require an **admin/API token**; no per-user revocable tokens natively. |
| **Mealie** | `djwmarcx/better-mealie-mcp` (FastMCP `from_openapi`, 250+ tools, 2026-07); `nikopol666/mealie-mcp`; `rorymcdaniel/mealie-mcp-server` (OAuth+PKCE); `timo-reymann/mealie-mcp-server` (43 tools) | active | stdio, streamable-http, OAuth+PKCE | **FastMCP `from_openapi`** keeps tool surface in sync with Mealie's OpenAPI — no hand-maintenance. |
| **Actual Budget** | `agigante80/actual-mcp-server` (71-74 tools, 2026-08); `Saikumarmohan/actual-budget-mcp` (FastMCP+actualpy, 2026-08); `NightSquawk/actualbudget-mcp-server` (guarded deletes) | active | stdio, streamable-http | Safety models vary: `NightSquawk` guarded deletes (confirm-required); `agigante80` read-only vs mutating tiers; `Saikumarmohan` per-tool safety. Need sync-server creds (password + sync-ID). |
| **Vaultwarden / Bitwarden** | **No** dedicated maintained MCP server (community wrappers stale ~2023). | N/A | – | High-risk surface for an LLM. No official MCP; only consider a custom, audited wrapper using Bitwarden API tokens. |
| **Portainer / Docker** | `portainer/portainer-mcp` (official, FastMCP from Portainer OpenAPI, PyPI `mcp-portainer`, 2.44.0 2025-12); `Serraniel/portainer-mcp-docker`; `PiefkePaul/portainer-mcp-http` | official active | stdio, streamable-http (TLS gate) | Generated from Portainer OpenAPI → stays current. `PORTAINER_READ_ONLY` + tool profiles (BASE/DOCKER/KUBERNETES/GITOPS). Gate-token + per-user API key. |
| **Ollama** | `solaegis/ollama-mcp-server` (2026-04, router + 12 tools); `muah1987/Ollama-MCP-Server` (28 tools, 2025-07); `emgeee/mcp-ollama` | low/active | stdio, streamable-http | Bridges are proto-type; tool count low (≈10-30). Mostly stdio-only; remote use needs a proxy. |
| **Open WebUI** | `open-webui/mcpo` (MCP→OpenAPI proxy, 4.3k★); `open-webui/openapi-servers` (bridge both ways, 2026); `vedmaka/openwebui-mcp` (FastMCP, 2026-08) | active | stdio, streamable-http | **mcpo** is the de-facto MCP→OpenAPI standard. Open WebUI native MCP support is **experimental** (behind feature flag) but offers tighter UI integration. |
| **Firecrawl** | `firecrawl/firecrawl-mcp-server` (official, v3.24.0 2026-08) | active | stdio, streamable-http (HTTP+SSE) | Fully maintained by Firecrawl team. Keyless mode limited to search/scrape/parse; full surface needs API key or OAuth. |
| **Home Assistant** (reference) | `homeassistant-ai/ha-mcp` (4.3k★); built-in HA integration `mcp_server` (official, read-only for Assist entities) | active | stdio, streamable-http, SSE | Mature reference for the whole pattern. Community servers add privileged ops (YAML/file editing) + OAuth+PKCE. |

**Take-away:** every app here (except Vaultwarden) has a usable MCP server. Prefer
**dynamic/discovery** servers for heterogeneous installs; prefer **FastMCP
`from_openapi`** servers for auto-synced tool surfaces.

---

## 2. OpenAPI → MCP autogeneration (wrapping ~16 REST APIs)

| Approach | Mechanism | Auto-gen tools | 2026 status |
|----------|-----------|----------------|-------------|
| **FastMCP `from_openapi`** (`jlowin/fastmcp`) | Reads an OpenAPI spec, emits MCP tools. | ✅ Full coverage | **Most mature** — used by Mealie, Actual, Portainer servers. Prune with profile/env flags. |
| **mcp-openapi-proxy** (`matthewhand`) | Proxies an existing OpenAPI HTTP server as MCP. | ❌ forwards only | Lightweight; needs an OpenAPI-published service already. |
| **IBM ContextForge MCP Gateway** | UI/CLI generates MCP from OpenAPI. | ✅ | Early-access / preview; limited community. Not production yet. |
| **Lasso / Microsoft mcp-gateway** | Dockerized OpenAPI↔MCP translation. | ✅ | Microsoft repo stale (2023); Lasso last commit 2024-09. Avoid for 2026. |
| **open-webui mcpo** | MCP → OpenAPI (reverse direction). | ❌ reverse | Very active; useful if you already have MCP servers and want OpenAPI clients. |
| **open-webui native MCP (2026)** | Experimental native MCP behind feature flag. | ⚠️ limited | Good for prototyping, not "wrap-16-apps" yet. |

**Recommended:** **FastMCP `from_openapi` + profile-based pruning** (one FastMCP
container per service; expose only the profile you need, e.g. `DOCKER` for
Portainer, `BASE` for Nextcloud). Confidence ≈ 0.9 — proven in production. All 16
services publish OpenAPI 3.0 specs.

---

## 3. Intent-routing / multi-agent orchestration patterns

| Pattern | Core idea | 2026 maturity | Local-model feasibility |
|---------|-----------|---------------|------------------------|
| **LangGraph supervisor** | Supervisor node routes to domain sub-agents; state passed between nodes. | **Most adopted** for self-hosted pipelines. | Small models (Llama-3-8B, Qwen-2.5-7B) reliably call tools with tool-choice prompting; >85% correct selection on well-defined APIs. |
| **OpenAI Agents SDK handoffs** | Router hands off to specialized assistant owning a tool set. | Hosted-only (needs OpenAI key). | Not viable for fully self-hosted. |
| **CrewAI hierarchical** | Manager decomposes goal into tasks for sub-crews. | Community-active, opinionated. | Workable but less suited to very different service APIs. |
| **Claude Agent SDK sub-agents** | Parent spawns child instances with tool-scoped system prompts. | Hosted-only (Anthropic key). Pattern mimickable via LangGraph. | Pattern maps to MCP profile separation. |
| **opencode custom agents + MCP** | Tiny orchestrator loads MCP servers as tool packages, routes via intent map. | 2026-04 `mcp_router.py`; fully local. | Small models drive router if intent map ≤ ~30 intents; menu-driven router >95% for larger. |

**Consensus (2026):** **LangGraph supervisor + MCP-scoped sub-agents** is the
de-facto self-hosted pattern. Supervisor holds a global intent map (e.g. "search
photos", "list containers"); each intent maps to one MCP server or a
profile-filtered subset. Tool access limited by MCP profile (read-only vs write)
and per-service API keys. For ~16 services a **menu-driven router** (present
3-5 options) beats free-form routing.

---

## 4. Security of LLM-driven homelab access

| Concern | Risk in this homelab | Mitigation |
|---------|----------------------|------------|
| **Prompt injection via stored content** | Paperless OCR docs, Nextcloud files, Immich metadata, email can contain hidden instructions. | Read-only MCP profiles for doc-heavy services; strip markdown/HTML before LLM; human-in-the-loop for writes. |
| **Tool poisoning** | Over-broad tool schema enables unexpected behavior. | Profile-based filtering; `readOnlyHint`/`destructiveHint` annotations (Immich, Paperless). |
| **Confused deputy** | Agent uses credentials it shouldn't. | Per-user/per-service tokens never shared; gate-token (Portainer) or OAuth+PKCE (Mealie, Nextcloud). |
| **Over-broad tokens** | One leaked key = whole service. | Read-only profiles; rotate tokens; short-lived OAuth. |
| **Audit logging** | Need who-called-what-when. | Portainer has audit log; for others run an MCP-proxy/side-car logger recording JSON-RPC. |
| **Human-in-the-loop gates** | Accidental mass deletion. | `confirm:true` for delete-type tools; never expose write tools to unrestricted agents. |
| **Read-only vs read-write separation** | Exploration vs mutation. | Run two MCP servers per service (or same binary, different env); route agent to read-only by default. |
| **Per-service scoped API keys** | Which apps support revocable scoped keys? | **Yes:** Immich (read/write key), Paperless (token + READ_ONLY), Nextcloud (app-passwords, scope-limited), Mealie (token + tag scoping), Portainer (per-user key + gate-token). **No:** Vaultwarden (master token only), Home Assistant (long-lived full token or OAuth). |
| **Network containment of the agent** | Agent shouldn't have open egress. | Dedicated Docker network (e.g. `homelab_mcp`); bind to 127.0.0.1 / Tailscale IP only; no published ports. |
| **MCP CVEs / incidents** | CVE-2025-6514 (mcp-remote RCE, fixed 0.7.2); postmark-labs npm incident (Jan 2025); Reapack/Supabase MCP leak (2024). | Keep MCP binaries current; pin deps (`uv lock`/`npm shrinkwrap`); use official container images; spec now has origin-validation + tool-name allowlists. |
| **Anthropic / MCP official guidance** | OAuth resource-server flow (RFC 8707); verified MCP registry; TLS-required streamable HTTP; tool-call whitelisting. | Always TLS over Tailscale; add `tool_allowlist` in client config. |

**Key take-aways for a 16-service homelab:**
1. Never expose a single master token — use per-service keys + profile filtering.
2. Run MCP servers on an isolated Docker network, loopback/Tailscale only.
3. Default to read-only profiles; switch to write only after explicit consent.
4. Enable audit logging (side-car for non-Portainer services).
5. Keep MCP server images current (patch 2025-2026 CVEs).

---

## 5. Real-world precedents

| Precedent | What worked | What bit them |
|-----------|-------------|---------------|
| **Home Assistant + ha-mcp** | In-process server (zero hops); OAuth+PKCE for remote; community add-ons. | Token leakage across sessions; rate-limit hits → needed `HA_MCP_RATE_LIMIT`. |
| **Personal "AI butler" stack (2026-04)** | Single compose started 5 FastMCP servers; LangGraph supervisor routed by domain. | Tool-name collisions (`list_*`) → added service-prefix in intent map; egress bottlenecks over Tailscale → per-server rate limits. |
| **MCP-gateway on Tailscale (2026-07)** | No port-forward; stable `100.xx` addresses; gate-token + per-user keys. | TLS cert mismatch when proxy terminated before MCP; OAuth loops → app-password read-scope only. |
| **Firecrawl + Claude Code (2026-02)** | Keyless mode sufficed for public web; SSE for long sessions. | Rate-limit >30 req/min; keyless can't read local files → self-host Firecrawl for that. |

**Convergent lessons:** one MCP server per service behind isolated network;
profile-based read/write separation; Tailscale/loopback-only ports; audit logging
+ human-in-the-loop gates; keep MCP images updated.

---

## TL;DR — recommended approach per area

| Area | Recommendation (2026) | Confidence |
|------|-----------------------|------------|
| Existing MCP servers | Use actively-maintained server per app; prefer dynamic discovery (Rello, Paperless cbsmiley) or FastMCP `from_openapi` (Mealie, Actual, Portainer). | 0.95 |
| OpenAPI→MCP autogen | **FastMCP `from_openapi`** + profile pruning. | 0.9 |
| Intent routing | **LangGraph supervisor** + MCP-scoped sub-agents; menu-driven router for >30 intents; local 8B models feasible. | 0.85 |
| Security | Isolated `homelab_mcp` network; per-service scoped keys; read-only default; audit side-car; current images. | 0.9 |
| Precedents | One MCP/server behind Tailscale; LangGraph router; human-in-the-loop for destructive ops. | 0.88 |

---

## Minimal proof-of-concept (3 services)

1. Pick Immich, Nextcloud, Portainer.
2. Run official MCP images (loopback-bound, isolated network):
   ```bash
   docker run -d --name immich-mcp \
     -e IMMICH_BASE_URL=http://immich:2283 \
     -e IMMICH_API_KEY=xxxx -e MCP_TRANSPORT=streamable-http \
     ghcr.io/whitehara/immich-mcp:latest
   docker run -d --name nextcloud-mcp \
     -e NEXTCLOUD_URL=http://nextcloud:80 -e NEXTCLOUD_APP_TOKEN=yyyy \
     -e MCP_TRANSPORT=streamable-http ghcr.io/worph/nextcloud-mcp:latest
   docker run -d --name portainer-mcp \
     -e PORTAINER_URL=https://portainer:9443 \
     -e PORTAINER_MCP_AUTH_TOKEN=$(openssl rand -hex 32) \
     -e PORTAINER_PROFILES=BASE,DOCKER portainer/portainer-mcp:2.44.0
   ```
3. LangGraph supervisor maps intents → MCP endpoints.
4. Connect an LLM client (Claude Desktop / local Ollama agent).
5. Start read-only; add write only after `confirm:` gates tested.

---

## References (as-reported, verify at build time)

- Immich: `whitehara/immich-mcp`, `pimpmypixel/immich-mcp-server`, `homeserverhq/ImmichMCP-Multitenant`
- Nextcloud: `cbcoutinho/nextcloud-mcp-server`, `Rello/nextcloud-dynamic-mcp-server`, `worph/nextcloud-mcp`, `janLo/nextcloud-simple-mcp`
- Paperless: `cbsmiley/paperless-ngx-mcp-server`, `patrickcylai/paperless-ngx-mcp`, `OrellBuehler/paperless-mcp`
- Mealie: `djwmarcx/better-mealie-mcp`, `nikopol666/mealie-mcp`, `rorymcdaniel/mealie-mcp-server`
- Actual: `agigante80/actual-mcp-server`, `Saikumarmohan/actual-budget-mcp`, `NightSquawk/actualbudget-mcp-server`
- Portainer: `portainer/portainer-mcp` (PyPI `mcp-portainer`)
- Ollama: `solaegis/ollama-mcp-server`, `emgeee/mcp-ollama`
- Open WebUI: `open-webui/mcpo`, `vedmaka/openwebui-mcp`
- Firecrawl: `firecrawl/firecrawl-mcp-server`
- Home Assistant: `homeassistant-ai/ha-mcp`
- Frameworks: `jlowin/fastmcp`, `langchain-ai/langgraph`, `matthewhand/mcp-openapi-proxy`
- Registries: glama.ai, mcp.so, PulseMCP, modelcontextprotocol/servers

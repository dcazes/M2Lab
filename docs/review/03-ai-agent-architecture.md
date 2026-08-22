# AI Agent Layer — Architecture & Build Plan

> **Goal (yours):** one MCP server per service, subagents driving those MCPs, and
> a master bot doing intent routing — all self-hosted behind Tailscale.
> **Grounded in:** `04-research-notes.md` (web research, 2026-08-22) and
> `01-stack-index.md` / `02-critique.md` (actual stack state).
> **Principle:** safe-by-default. Read-only first, isolated network, per-service
> scoped keys, audit logging, human-in-the-loop for anything destructive.

---

## 1. Design principles

1. **One MCP server per service**, each in its own container on a dedicated
   `homelab_mcp` Docker network. No published ports — reachable only from the
   router container and over Tailscale (loopback/Tailscale IP only).
2. **Read-only by default.** Every service gets a read-only MCP profile; write
   access is a separate profile/endpoint enabled only after explicit user
   consent (`confirm: true` gates).
3. **Per-service scoped API keys** — never a shared master token. Prefer apps
   that issue revocable, scope-limited keys (Immich, Nextcloud app-passwords,
   Portainer per-user key, Paperless token+READ_ONLY, Mealie token+tag scoping).
4. **Agent containment:** the MCP fleet has egress limited to the tailnet; the
   router model runs locally (Ollama) or on a controlled host.
5. **Audit everything:** an MCP side-car proxy logs every JSON-RPC
   request/response (Portainer already audits; others need the side-car).
6. **docker.sock services are off-limits for write routing** (Portainer,
   surfsense, beszel-agent, homepage) — see §5.

---

## 2. Topology

```
                         ┌─────────────────────────────────────┐
                         │  Tailscale tailnet (100.x)           │
                         │        only ingress                  │
                         └───────────────┬─────────────────────┘
                                         │ (loopback / ts IP)
                         ┌───────────────▼─────────────────────┐
                         │  Intent Router (LangGraph supervisor)│
                         │  - global intent map (~30 intents)   │
                         │  - local 8B model (Ollama) or hosted │
                         │  - menu-driven fallback >30 intents   │
                         └───┬──────┬──────┬──────┬─────────────┘
              routes by intent│      │      │      │
         ┌───────────────────┘      │      │      └───────────────────┐
         ▼                          ▼      ▼                          ▼
  ┌─────────────┐           ┌─────────────┐                   ┌─────────────┐
  │ immich-mcp  │           │ nextcloud-  │   ... 16 servers  │ portainer-  │
  │ (read-only) │           │ mcp (RO)    │                   │ mcp (RO!)   │
  └──────┬──────┘           └──────┬──────┘                   └──────┬──────┘
         │  homelab_mcp network     │                                 │
         └──────────┬───────────────┴─────────────────────────────────┘
                    ▼
            ┌──────────────┐
            │ audit side-  │  logs every tool call → host log / SIEM
            │ car proxy    │
            └──────────────┘
   Each MCP server reaches its app over frontend/backend-net by service name.
```

---

## 3. MCP server mapping (per service)

| Service | Recommended MCP server | Transport | Read-only profile? | Scoped key available? |
|---------|------------------------|-----------|--------------------|------------------------|
| immich | `whitehara/immich-mcp` | streamable-http | yes (`destructiveHint`) | yes (read/write API key) |
| nextcloud | `Rello/nextcloud-dynamic-mcp-server` (auto-discovery) | streamable-http / OAuth2 | via app-password scope | **yes** (app-passwords) |
| paperless-ngx | `cbsmiley/paperless-ngx-mcp-server` | streamable-http / OAuth2 | **yes** (`READ_ONLY`) | token + READ_ONLY flag |
| mealie | `djwmarcx/better-mealie-mcp` (FastMCP `from_openapi`) | streamable-http / OAuth+PKCE | yes (`MEALIE_READ_ONLY`) | token + tag scoping |
| actual-budget | `agigante80/actual-mcp-server` | streamable-http | yes (read-only tier) | sync-server creds |
| portainer | `portainer/portainer-mcp` (official) | streamable-http (TLS) | **yes** (`PORTAINER_READ_ONLY`) | per-user key + gate-token |
| ollama | `solaegis/ollama-mcp-server` | streamable-http | n/a (local inference) | n/a |
| open-webui | `vedmaka/openwebui-mcp` or native mcpo | streamable-http | via app config | session token |
| firecrawl | `firecrawl/firecrawl-mcp-server` (official) | streamable-http | keyless = read-only subset | API key / OAuth |
| vaultwarden | **custom audited wrapper only** | streamable-http | n/a (high risk) | **no** scoped key — master token only |
| surfsense | **none mature** → FastMCP `from_openapi` against its API | streamable-http | depends on API | API key |
| puppygraph | **none** → FastMCP `from_openapi` (graph query API) | streamable-http | query-only by nature | basic-auth user/pass |
| homepage | **none needed** (read-only dashboard) | — | — | — |
| beszel | **none mature** → FastMCP `from_openapi` (monitoring API) | streamable-http | read-only metrics | API token |
| adventurelog | **none mature** → FastMCP `from_openapi` | streamable-http | yes (depends on API) | API token |

**Autogeneration strategy:** for services without a mature MCP server
(surfsense, puppygraph, beszel, adventurelog), use **FastMCP `from_openapi`**
against each app's published OpenAPI 3.0 spec — one container per service, prune
with profile/env flags. Confidence ≈ 0.9 (used by Mealie/Actual/Portainer
servers already).

---

## 4. Intent router design

- **Pattern:** LangGraph supervisor. A supervisor node holds a global intent map
  (e.g. "search photos" → immich-mcp, "list containers" → portainer-mcp, "find
  recipe" → mealie-mcp). Each intent maps to **one** MCP server (or a
  profile-filtered subset).
- **Local-model feasibility:** 8B models (Llama-3-8B, Qwen-2.5-7B) reliably
  select the correct intent with tool-choice prompting (>85% on well-defined
  APIs). For ~16 services / >30 intents, use a **menu-driven router** (present
  3-5 options) → >95% success.
- **Subagents:** each domain subagent is configured with exactly one MCP server
  (or one read-only + one write profile) and a scoped key. The router delegates;
  subagents never hold cross-service credentials.
- **Avoid:** OpenAI Agents SDK / Claude Agent SDK sub-agents are hosted-only
  (need vendor keys) — not viable for a fully self-hosted stack. Mimic their
  pattern (system-prompt-scoped tools) with LangGraph + local model.

---

## 5. Security controls mapped to THIS stack

| Risk (from §02) | Control in the agent layer |
|-----------------|----------------------------|
| docker.sock in portainer/surfsense/beszel-agent/homepage (C3, H3) | Portainer MCP = **read-only profile only**; surfsense/beszel MCP = read-only; never route write intents to these. Homepage needs no MCP. |
| Prompt injection via Paperless/Nextcloud/Immich/SurfSense stored content | Read-only MCP profiles for doc-heavy services; strip HTML/markdown before LLM; human-in-the-loop before any write tool. |
| Over-broad / master tokens (Vaultwarden) | Vaultwarden: **custom audited wrapper or exclude from write routing**; never a master token in the agent. |
| Unpinned images / no healthchecks (H1, H2) | Pin every MCP server image to a digest; add healthchecks; keep images current (CVE-2025-6514 class issues). |
| Agent egress / confused deputy | Dedicated `homelab_mcp` network, loopback/Tailscale-only, no published ports, egress limited to tailnet. |
| No audit logging (M-ish) | MCP side-car proxy logging all JSON-RPC; correlate with service logs. |
| Tool poisoning | `tool_allowlist` in client config; profile-based pruning of tool sets. |

---

## 6. Phased build plan

**Phase 0 — Harden the base (do this first, from §02).**
Fix C1–C4 and H1–H2 before exposing anything to an agent. An unhardened
open-webui/ollama + an agent with tool access is a breakout waiting to happen.

**Phase 1 — PoC (3 services, read-only).**
Immich + Nextcloud + Portainer MCP servers on `homelab_mcp`, read-only profiles,
scoped keys. LangGraph supervisor with ~10 intents. Validate routing + audit log.

**Phase 2 — Expand read-only fleet.**
Add the remaining services via mature servers or FastMCP `from_openapi`. Keep
write off. Add menu-driven routing as intent count grows.

**Phase 3 — Write profiles + human-in-the-loop.**
Introduce write MCP profiles for safe services (Mealie, Paperless, Immich
non-destructive). Gate every destructive tool with `confirm: true`. Vaultwarden
stays read-only/excluded.

**Phase 4 — Hardening & ops.**
MCP side-car audit log, image pinning CI check, healthchecks, backup of MCP
configs, and a kill-switch (network policy to drop `homelab_mcp` egress).

---

## 7. Open decisions for you

1. **Router model:** local 8B (privacy, slower, menu-driven) vs a hosted model
   for the router only (better routing, needs egress/key). Recommendation: local
   Ollama for privacy + menu fallback.
2. **Vaultwarden:** exclude from write routing, or build a custom audited wrapper?
   (No scoped keys exist — high risk either way.)
3. **SurfSense/PuppyGraph/Beszel/AdventureLog:** accept FastMCP `from_openapi`
   autogen (maintenance-light, spec-driven) vs hand-picked tools?
4. **Where does the router run:** same host (Ollama GPU) or a separate tailnet
   node? Affects egress policy.
5. **Audit storage:** ship MCP logs to Beszel/another collector, or local files
   only?

---

## 8. References
See `04-research-notes.md` §References for all repo links and the minimal
3-service PoC compose snippet.

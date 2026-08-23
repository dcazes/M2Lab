# Subagent Fleet Plan — one agent per homelab app

> **Goal (yours):** a top-level agent you talk to, which delegates to one
> subagent per app (vaultwarden excluded). Each subagent carries its own
> skills and drives its app through an MCP server or a deterministic API.
> **Grounded in:** `03-ai-agent-architecture.md` (design), `04-research-notes.md`
> (MCP-server research), `01-stack-index.md` (inventory), the live OpenAPI probe
> (2026-08-23), and `lib-2` (opencode config schema, verified against
> opencode.ai docs + `opencode-ai/opencode`).
>
> **Principle:** safe-by-default. Read-only first, per-service scoped keys,
> human-in-the-loop for anything destructive, agent layer is swappable — the
> **MCP fleet is the durable asset**.

---

## 0. TL;DR / recommendation

Build the **MCP fleet once as containers** on the homelab (per `03` topology),
then consume it from **opencode-native subagent profiles** you define in
`.opencode/agents/*.md`. The top-level agent is a thin `mode: primary` router
that owns **no MCP tools** and delegates via `task()`. Each subagent owns exactly
one app's MCP server (scoped by `permission`) plus its own skills.

- **Why opencode-native first (not a separate LangGraph service):** you're
  already in opencode; subagent profiles + skills + MCP are first-class and
  match your vocabulary exactly. Zero new infra.
- **Why containers for the MCP fleet (not stdio on your laptop):** the same
  fleet is later reusable by an always-on router (Option C), and it stays
  reachable over Tailscale without your laptop being on.

---

## 1. Implementation options

| Option | Shape | Pros | Cons | When |
|---|---|---|---|---|
| **A — opencode-native fleet** | 15 `.opencode/agents/*.md` subagents + skills; MCP servers as homelab containers reached via SSE over Tailscale; top-level = primary router | Zero new infra, matches how you work, skills built-in, deterministic tool calls | Only runs where you run opencode; no always-on automation | **Start here** |
| **B — self-hosted always-on router** | LangGraph supervisor container + MCP fleet on `homelab_mcp` net, exposed via Tailscale (open-webui as chat front) | Always-on, private, automatable | Heavy build; local 8B models weak at tool-use; maintenance | Later, if you want unattended agents |
| **C — hybrid (recommended end-state)** | Build MCP fleet once (A), then add a LangGraph router that reuses the *same* fleet | Best of both; fleet is the durable asset, clients swappable | Two consumers to wire | Evolve A → C after A is proven |

**Recommendation:** Option A now, designed so the MCP fleet is transport-standard
(streamable-HTTP/SSE) and reusable by a future Option-C router.

---

## 2. Architecture (Option A)

```
 You (chat) ──▶ homelab-orchestrator  [mode: primary, NO mcp tools]
                    │  task("immich", …) / task("paperless", …) / …
                    ▼
        ┌───────────────────────────────────────────────┐
        │ 15 subagents  (.opencode/agents/<app>.md)       │
        │ each: mode: subagent, 1 MCP server (permission-│
        │        scoped), own skills, read-only default   │
        └───┬──────┬──────┬──────┬──────┬─────────────────┘
            │      │      │      │      │
            ▼      ▼      ▼      ▼      ▼
   immich-mcp  paperless-mcp  …  (homelab containers, homelab_mcp net)
            │      │                      │
            └──────┴── over Tailscale SSE ─┘──▶ your apps (loopback ports)
```

**Key trick (from `lib-2`):** opencode starts *all* `mcpServers` at launch and
parses their schemas once, but each agent only *sees* the tools its `permission`
block allows. So:
- Define all 15 MCP servers globally in `opencode.json`.
- The **primary router grants none** of them → its context stays lean.
- **Each subagent grants only its own server's tools** → its context stays lean.
This is what makes 15 servers tractable despite context-bloat warnings.

---

## 3. opencode mechanics (verified, `lib-2`)

**Agent profile** — `.opencode/agents/<name>.md`:
```markdown
---
model: openai/qwen2.5:7b        # routed through litellm :4000
mode: subagent
description: "Immich photos: search, albums, people. Read-only by default."
temperature: 0.1
permission:
  edit: deny
  bash: deny
  webfetch: deny
  mcp_immich_*: allow          # only this app's tools
---
You are the Immich subagent. Use mcp_immich_* tools. Never delete without
confirming. Immich runs on 127.0.0.1:2283 (tailnet 100.x). Data dir:
immich-app/library (gitignored).
```

**Skills** — `.opencode/skills/<app>-<task>/SKILL.md` (name+description required):
```markdown
---
name: immich-bulk-tag
description: Tag people/albums in bulk across Immich
---
## Steps …  ## When to use …
```
Per-agent skill gating via `permission.skill` (`"*": "allow"`, `"internal-*": "deny"`).

**MCP servers** — `opencode.json` → `mcpServers` (stdio or sse):
```json
{
  "mcpServers": {
    "immich": { "type": "sse",
      "url": "https://100.x.x.x:8461/mcp",
      "headers": { "Authorization": "Bearer ${IMMICH_MCP_TOKEN}" } },
    "paperless": { "type": "sse",
      "url": "https://100.x.x.x:8462/mcp",
      "headers": { "Authorization": "Bearer ${PAPERLESS_MCP_TOKEN}" } }
  }
}
```
Env interpolation (`${VAR}`) works. **No built-in web/serve mode** in opencode —
external Tailscale Serve only (your dashboard pattern).

**Delegation:** `task("immich", "find photos of the dog")` or `@immich …` from
the primary agent. Headless: `opencode -p "task('immich','…')" -q`.

---

## 4. The durable asset: MCP fleet topology

Per `03` §2: one container per service on a dedicated `homelab_mcp` Docker
network, **no published ports**, reachable only over Tailscale (loopback/ts IP).
- Prefer servers with **HTTP transport** (immich, paperless, mealie, actual,
  portainer, open-webui, firecrawl).
- Stdio-only servers (some Nextcloud/Ollama) → wrap with a tiny **SSE bridge**
  (`supergateway` / `mcp-remote`) in the same container.
- Autogen targets (surfsense, puppygraph, beszel, adventurelog, litellm) →
  **FastMCP `from_openapi`** container; beszel + litellm + mealie + actual +
  immich + open-webui already expose live OpenAPI specs (probe 2026-08-23).

---

## 5. Per-app customization matrix (15 apps + 1 ops meta)

> Auth = how to mint the **scoped** credential. Guardrails = default posture.
> "docker.sock" rows are **read-only only** (never route writes).

| # | App | MCP server (transport) | Scoped credential | Skills (SKILL.md) | Guardrails | Context / quirks |
|---|-----|------------------------|-------------------|-------------------|------------|------------------|
| 1 | **immich** | `whitehara/immich-mcp` (HTTP, 74 tools) | Settings→API Keys (dedicated key; gate destructive via permission) | `immich-search`, `immich-bulk-tag` | read-only default; `destructiveHint` tools → `ask` | :2283; library gitignored; live OpenAPI ✓ |
| 2 | **nextcloud** | `Rello/nextcloud-dynamic-mcp-server` (HTTP, auto-discovery) | Security→**App passwords** (scope-limited) | `nextcloud-files`, `nextcloud-shares` | read-only default; strip HTML before LLM (injection via files) | :8020; OCS/WebDAV, no OpenAPI; doc-heavy |
| 3 | **paperless-ngx** | `cbsmiley/paperless-ngx-mcp-server` (HTTP, 50 tools) | Admin→API tokens; server `READ_ONLY=true` | `paperless-ingest`, `paperless-search` | READ_ONLY profile default; OCR docs = injection risk | :8010; /docs→auth; postgres:17 sidecar |
| 4 | **mealie** | `djwmarcx/better-mealie-mcp` (FastMCP from_openapi, 250 tools) | Settings→API tokens + tag scoping; `MEALIE_READ_ONLY` | `mealie-recipe`, `mealie-plan` | MEALIE_READ_ONLY default | :9000; live OpenAPI ✓; sqlite |
| 5 | **actual-budget** | `agigante80/actual-mcp-server` (HTTP, 71 tools) or `NightSquawk` (guarded deletes) | sync-server password + budget **sync-ID** | `actual-report` | read-only tier default; deletes → `confirm` | :5006; live OpenAPI ✓; file-based |
| 6 | **portainer** | `portainer/portainer-mcp` (official, HTTP) | Account→API key (per-user) + gate-token; `PORTAINER_READ_ONLY`, `PROFILES=BASE,DOCKER` | `portainer-stack`, `portainer-logs` | **READ_ONLY ONLY** (docker.sock) | :9090; no OpenAPI; never write-route |
| 7 | **ollama** | `solaegis/ollama-mcp-server` (HTTP, 12 tools) | none (local) | `ollama-pull`, `ollama-model` | local inference; pull = only mutation | :11434; no OpenAPI; shared by litellm/webui/surfsense |
| 8 | **open-webui** | `vedmaka/openwebui-mcp` (FastMCP, HTTP) | user session token | `openwebui-chat`, `openwebui-manage` | read-only via app config | :8084; live OpenAPI ✓; **no hardening today** |
| 9 | **firecrawl** | `firecrawl/firecrawl-mcp-server` (official, HTTP) | API key / OAuth; **keyless = read-only subset** | `firecrawl-scrape`, `firecrawl-crawl` | keyless read-only default; rate-limit aware | :3002; no OpenAPI; rabbitmq+redis sidecars |
| 10 | **surfsense** | FastMCP `from_openapi` (HTTP) | API key from settings | `surfsense-search`, `surfsense-admin` | **read-only only** (opensandbox docker.sock) | :3929; /docs up (FastAPI); pgvector stack |
| 11 | **puppygraph** | FastMCP `from_openapi` (Gremlin/Cypher) | basic-auth user/pass | `puppygraph-query` | query-only by nature (read) | :8082; no OpenAPI; graph engine |
| 12 | **beszel** | FastMCP `from_openapi` (HTTP) | API token from hub | `beszel-monitor`, `beszel-alert` | read-only metrics; agent docker.sock → no write | :8090; **live OpenAPI ✓**; file-based |
| 13 | **adventurelog** | FastMCP `from_openapi` (Django REST) | API token | `adventurelog-entry`, `adventurelog-trip` | depends on API | :8015; schema at `/api/schema/`; postgis sidecar |
| 14 | **homepage** | **none** (dashboard) → file-tools agent | none | `homepage-tile` | file edit only; read-only default | :8083; edits `homepage/config/services.yaml` |
| 15 | **litellm** | FastMCP `from_openapi` (HTTP) | admin key / master key (sensitive) | `litellm-keys`, `litellm-models` | read-only default; key creation → `ask` | :4000; **live OpenAPI ✓**; postgres sidecar (just added) |
| 16 | **homelab-ops** *(meta)* | FastMCP `from_openapi` over **ctl API** :8787 | `CTL_TOKEN` (already built) | `homelab-status`, `homelab-action` | write actions gated; `destroy` needs confirm body | the control plane; up/stop/restart/logs/status for all 16 |

**Vaultwarden:** excluded per your instruction (no scoped key; master-token-only
high-risk surface). If ever needed, a custom audited wrapper only.

---

## 6. Skills inventory (concrete)

Each app gets 1–2 skills capturing *how to do common tasks safely* — the
procedural knowledge that makes the subagent "smart" without re-deriving it each
call. Examples above; author them as `.opencode/skills/<name>/SKILL.md`. The
`homelab-ops` skills wrap the ctl FastAPI you already built (Phase 0 of the
dashboard work): `GET /api/services`, `POST /api/services/{id}/{action}`,
`POST /api/services/{id}/destroy` (body `{"confirm":"<id>"}`).

---

## 7. Credential & secret handling

- All scoped keys in **root `.env`** (gitignored) or per-service `.env`;
  referenced by MCP `headers`/`env` via `${VAR}` interpolation.
- Mint **dedicated, revocable** keys per app — never a master token in an agent.
- Rotate on a schedule; short-lived where OAuth is supported (Mealie, Nextcloud).
- `litellm` and `portainer` keys are the most sensitive — read-only profiles +
  `ask` gates.

---

## 8. Phased build plan

**Phase 0 — harden base (from `03` §6):** fix the open-webui/ollama/portainer
hardening gaps (H1–H2) before exposing tool access. An unhardened service + an
agent with tools is a breakout risk.

**Phase 1 — PoC fleet (read-only, 3–4 apps):** stand up MCP containers for
immich + paperless + mealie + beszel (mature servers / live specs). Verify:
`opencode mcp list` shows tools; from local opencode, `task("immich","count
photos")`.

**Phase 2 — opencode profiles + skills:** write `.opencode/agents/*.md` for the
PoC apps + the `homelab-orchestrator` primary; add their skills. Test routing:
primary → subagent → MCP. Confirm primary context stays lean (no mcp tools).

**Phase 3 — full fleet:** extend to all 15 + ops meta. Add **write profiles**
with human-in-the-loop (`ask`/`confirm`) for safe apps (Mealie, Paperless,
Immich non-destructive). Keep docker.sock apps read-only.

**Phase 4 — ops/hardening (optional, Option C):** MCP side-car audit log, image
digest-pinning CI check, healthchecks, kill-switch (drop `homelab_mcp` egress),
and an always-on LangGraph router reusing the same fleet.

---

## 9. Open decisions for you

1. **Router model:** local Ollama via litellm (privacy, weaker tool-use) vs a
   hosted model through litellm/FreeLLMAPI for the orchestrator only.
   *Recommendation:* route all agents through litellm (`model: openai/<x>`);
   local 7B for read-only, a stronger free model for complex orchestration.
2. **Where MCP containers live:** same host as apps (reuse `homelab_mcp` net) vs
   a separate tailnet node. *Recommendation:* same host, Tailscale-reachable.
3. **Always-on later?** Plan for Option C now (transport-standard fleet) or skip
   until you feel the need.
4. **Audit storage:** ship MCP logs to Beszel/another collector, or local files.
5. **Write access scope:** which apps get write subagents in Phase 3 (start with
   Mealie + Paperless + Immich non-destructive).

---

## 10. References

- `03-ai-agent-architecture.md` — MCP-per-service design, security controls, phased plan
- `04-research-notes.md` — MCP-server research per app, autogen, orchestration patterns
- `01-stack-index.md` — actual stack inventory (ports, networks, hardening)
- Live OpenAPI probe (2026-08-23): immich, litellm, mealie, actual-budget, beszel,
  open-webui expose specs; surfsense `/docs` up; puppygraph/adventurelog/nextcloud/
  portainer/ollama/firecrawl need mapped servers or autogen.
- `lib-2` (opencode schema): agents `.opencode/agents/*.md`, skills
  `.opencode/skills/<name>/SKILL.md`, `mcpServers` (stdio/sse), `permission`
  scoping, `task()` delegation, no web/serve mode.

## 11. Pilot outcome — litellm (2026-08-23)

Native LiteLLM OpenAPI->MCP gateway adopted; the custom FastMCP sidecar
(`litellm-mcp/`) was built, verified, then deleted in favor of first-party
support (litellm >= Oct 2025).

Final wiring:
- `litellm/litellm_config.yaml`: `mcp_servers.litellm_admin` with curated
  `allowed_tools` (27 read-only ops: models, keys, budgets, teams, users,
  spend reports, health, tags). Served at `/litellm_admin/mcp`.
- `litellm/openapi.snapshot.json`: tracked snapshot of the proxy's own spec,
  bind-mounted read-only. Self-fetch over HTTP at startup fails (nothing
  listens on :4000 during boot) — refresh the snapshot after image upgrades.
- `general_settings.user_url_allowed_hosts: [localhost, 127.0.0.1]` — SSRF
  allowlist required for self-directed tool execution.
- Access: scoped virtual key (`object_permission.mcp_servers:
  ["litellm_admin"]`, model-restricted), stored as `LITELLM_MCP_KEY` in
  gitignored `litellm/.env`. Master key never leaves the server config.
- opencode: `.opencode/agents/litellm.md` (deny bash/edit/webfetch) +
  `opencode.json` mcpServers -> `https://home.taile2cc7a.ts.net:8445/litellm_admin/mcp`.

Verified: unauth 401; VK tools/list = exactly the allowlisted 27; VK tool call
returns live model data. Sidecar container/image/dir and services.yaml entry
removed; `homelab_mcp` network kept for future per-service MCP sidecars.

Rollout to remaining apps follows §7 phases; prefer native OpenAPI->MCP where
the app exposes a spec (immich, mealie, actual-budget, beszel, open-webui),
custom/mapped servers otherwise.

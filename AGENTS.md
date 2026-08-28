# AGENTS.md

M2Lab — a Docker Compose homelab (18 registered services: infrastructure in
`core/`, applications in `apps/`) with a FastAPI/React control plane and a
governed MCP capability layer for AI agent harnesses. Verification means
catalog unit tests, a production UI build, valid compose configs, and CI
security scans.

## Architecture at a glance

```text
services.yaml          ← source of truth for all services (registry.py reads it)
catalog.yaml           ← app catalog, profiles, workflows, MCP manifests
ctl/registry.py        ← compose verbs + `ids`/`status`; Makefile targets come from here
ctl/compose.py         ← async `docker compose` wrapper used by the dashboard API
ctl/app.py             ← FastAPI dashboard (:8787), serves committed dashboard/dist
ctl/mcp_server.py      ← homelab-ctl MCP (:8790): lifecycle + discovery tools
ctl/mcp_registry.py    ← federated MCP registry, health checks, harness exports
ctl/app_mcp.py         ← read-focused MCP adapters (4 implemented, see below)
ctl/catalog.py         ← progressive capability discovery (task → capability matching)
ctl/initiate.py        ← prepare_environment() for automated first-run services
ctl/identity.py        ← secret-free SSO rollout inventory for the dashboard
ctl/setup_jobs.py      ← durable/resumable onboarding jobs (SQLite in .state/)
dashboard/             ← React/Vite frontend, built to committed dashboard/dist
opencode.json          ← agent harness config (MCP server wiring)
.opencode/agents/      ← agent profiles (default primary, m2lab orchestrator, litellm read-only)
.opencode/skills/      ← agent skills (currently: litellm-model-catalog)
```

## Control plane

- `services.yaml` is the single source of truth: service ids, dirs, ports,
  health checks, backup definitions. `id` and `dir` differ on purpose
  (`immich` → `apps/immich-app/`, `freellmapi` → `apps/FreeLLMAPI/`,
  `sso-ingress` → `core/ingress/`). Infrastructure lives in `core/`
  (authentik, ingress, litellm, ollama, open-webui, vaultwarden); user apps
  live in `apps/`.
- The Makefile is a thin wrapper over `ctl/registry.py`. Generic verbs work
  for any registered id with no Makefile edit:
  `make up|stop|restart|logs|pull|update SERVICE=<id>`. Without `SERVICE=`
  there is no target (the generic verbs are only defined when it is set);
  bare targets like `make vaultwarden` are aliases for `up`.
- Make targets are generated from `services.yaml` at parse time
  (`ctl/registry.py ids`) — broken YAML there breaks every make target.
- Some services define overlay compose files (`compose_files:`, e.g.
  `docker-compose.gpu.yml` for surfsense/ollama). Always manage services via
  `make ... SERVICE=<id>`, `ctl/registry.py`, or the MCP tools rather than raw
  `docker compose` inside a service dir, or you'll silently miss overlays.
- Backups: `./scripts/backup.sh [service-id|all]` (thin wrapper around
  `scripts/backup.py`, needs `.venv/`), driven by each service's `backup:`
  block in services.yaml (postgres dumps by container name, named volumes,
  binds).

### Dashboard API (`ctl/app.py` on 127.0.0.1:8787)

- Serves the **committed** `dashboard/dist` bundle and raises RuntimeError at
  import if it is missing. After dashboard changes run
  `cd dashboard && npm run build` and commit `dist/` — CI fails on a stale
  bundle. Dev preview: `make dashboard-dev` (Node 20+; `dashboard-install` =
  `npm ci`).
- Mutations require an approval token: `POST /api/approvals` with body
  `{service_id, action, confirm: "{action}:{service_id}"}` returns a
  single-use token (120s TTL) sent via the `X-M2Lab-Approval` header; SSE
  endpoints take it as `?approval=`. `destroy` additionally requires body
  `{"confirm":"<service-id>"}`.
- `always_on` services (authentik, sso-ingress) cannot be stopped or
  destroyed via the API. The dashboard refuses to `up` an "absent" service
  until the SSO foundation setup job is `ready` (the MCP `svc_up` has no
  such gate).

## Catalog and progressive capability discovery

`catalog.yaml` declares the user-facing app catalog: 17 apps across research,
productivity, media, AI, and creative categories, plus infrastructure that is
not advertised as an agent destination. Each app has capabilities with risk
tiers (read → draft → write → operational → destructive → privileged).

Six outcome profiles group apps by user goal: research, money, travel,
wellness, creative, local-ai. Four cross-app workflows are designed but staged
(trip-research, receipt-to-budget, photo-receipt-to-budget, memory-to-trip).

`ctl/catalog.py` provides lexical task→capability matching without injecting
every tool schema into an agent context. `ctl/mcp_server.py` exposes it via
`m2lab_discover_app_capabilities` / `m2lab_discover_app_workflows` /
`m2lab_evaluate_capability_risk`. Note: capability discovery only returns
matches whose MCP server is currently `live` — a declared capability is not
proof a server is reachable.

## MCP layer

**homelab-ctl MCP** (`ctl/mcp_server.py`, streamable HTTP at 0.0.0.0:8790/mcp):
- Lifecycle tools: `svc_status`, `svc_up`, `svc_stop`, `svc_restart`,
  `svc_pull`, `svc_update`, `svc_logs`, `status_all`
- Discovery tools: `discover_app_capabilities`, `discover_app_workflows`,
  `evaluate_capability_risk` (surfaced to the harness as `m2lab_*` via the
  `m2lab` server name in opencode.json)
- Security: bearer-token auth (`CTL_MCP_TOKEN` from root `.env`, fail-closed),
  dirty-repo gate blocks mutating verbs when the working tree is uncommitted,
  per-service async locks serialize concurrent operations, ufw scoped to the
  Docker bridge range (172.16.0.0/12).

**App MCP adapters** (`ctl/app_mcp.py`):
- Implemented for firecrawl, paperless-ngx, immich, ollama (ports
  8812/8815/8816/8817), one systemd user unit each
  (`deploy/homelab-app-mcp@<sid>.service`), auth via per-service scoped keys
  from gitignored `.env` files.
- `catalog.yaml → mcp_servers:` declares manifests for more servers
  (surfsense, actual-budget, adventurelog, nextcloud, litellm) — declarations
  are reviewed config, not proof of a live server. Runtime state (live,
  degraded, authentication_required, disabled, unavailable) comes from health
  checks in `ctl/mcp_registry.py`.

**Vaultwarden is intentionally excluded from all MCP and agent access.**

## Agent system

Agent profiles live in `.opencode/agents/`:

| Agent | Mode | Purpose |
|-------|------|---------|
| `default` | primary | General-purpose coding agent for this project. Full file/shell/web access + both MCP servers. |
| `m2lab` | subagent | Progressive-discovery orchestrator. No file/shell/web access; discovers capabilities via MCP, evaluates risk, delegates to app subagents. |
| `litellm` | subagent | Read-only LiteLLM model catalog. Drives the litellm MCP server exclusively. |

Skills live in `.opencode/skills/<name>/SKILL.md`. Currently:
- `litellm-model-catalog` — summarize models, routing, keys, budgets, spend

The subagent fleet plan (`docs/review/06-subagent-fleet-plan.md`) describes
one app-specific subagent per service (Vaultwarden excluded), added
incrementally as MCP servers come online.

## Python venv

`.venv/` at the repo root is required by `scripts/backup.sh`, `install.sh`,
and the systemd units:

```bash
python3 -m venv .venv && .venv/bin/pip install -r ctl/requirements.txt
```

## First-run setup (foundation-first onboarding)

The dashboard's Onboarding tab drives a resumable "foundation" job
(`POST /api/setup/targets/foundation/start`): preflight (docker, shared
networks, tailscale) → generate infra secrets → start vaultwarden → start
authentik → validate Caddy → start sso-ingress → publish the tailnet route
(port 8462) → user handoffs (Vaultwarden master password, then the Authentik
owner/MFA). Application setup jobs (`/api/setup/targets/{sid}/start`) topo-sort
catalog dependencies (infra before apps) and are refused until the foundation
is `ready`. Jobs survive restarts in `.state/setup-jobs.sqlite3` (stdlib
sqlite; resumable via `POST /api/setup/jobs/{id}/resume`).

`ctl/initiate.py` backs per-service env prep: `AUTOMATED_SERVICES` =
vaultwarden, freellmapi, litellm, ollama, firecrawl, nextcloud, surfsense,
open-webui. `prepare_environment()` generates credentials, writes them
directly to mode-0600 `.env` files, and never returns secrets to the browser.
Generic services use `/api/install/{sid}/prepare`; automated ones use
`/api/initiate/{sid}/prepare`.

## Adding or changing a service

Follow `docs/ADDING_APPS.md`; start stacks from `docs/compose-template.yml`,
register in `services.yaml`. Rules baked in:

- Ports bind to `127.0.0.1` only. Tailscale Serve is the only public door:
  `sudo tailscale serve --bg --https=<tailnet_port> http://127.0.0.1:<port>`.
- Reuse the shared external networks `frontend-net` / `backend-net` (Docker
  names `homelab_frontend` / `homelab_backend`, created by Ansible). Never
  define new networks — subnet exhaustion.
- Databases/caches: backend-net only, no published ports, and never add
  `user:` / `cap_drop:` / `read_only:` to stock postgres/redis/postgis/
  mariadb images — their entrypoints need privileged boot (this broke
  nextcloud-db/puppygraph before).
- Secrets only as `${VAR}` resolved from gitignored `<service>/.env`; ship an
  `.env.example`. Gitleaks runs in CI.
- Pick free loopback + tailnet ports (allocation list in ADDING_APPS.md).
- `ignore_containers:` keeps a service's sidecars (migrations/cron/db) out of
  status aggregation.
- A new MCP adapter = manifest in `catalog.yaml → mcp_servers:` + a
  read-focused implementation in `ctl/app_mcp.py` (or a native server).

## Security model

- Dashboard and app ports bind to loopback; Tailscale is the supported
  remote door.
- Secrets live in gitignored `.env` files: root `.env` (`CTL_MCP_TOKEN`,
  `OMNILAB_INGRESS_TOKEN`, `OMNILAB_REQUIRE_IDENTITY`) plus one per service.
  Settings endpoints return `configured: true/false` only — stored values and
  regenerated secrets are never sent to the browser.
- Lifecycle approvals are short-lived (120s), single-use, and bound to one
  service and action.
- Audit records (`/api/audit`, `.state/audit.jsonl`) contain event metadata,
  never secret values or Compose output. `.state/` (audit, setup jobs, MCP
  overrides/exports) is gitignored runtime state.
- Vaultwarden has no agent or MCP exposure.
- Docker-socket services are treated as root-equivalent and remain read-only
  or outside agent routing.
- The MCP server's dirty-repo gate blocks mutating compose verbs when the
  working tree has uncommitted changes.

## Verification

CI (`.github/workflows/ci.yml`) gates pushes/PRs to main: Gitleaks, yamllint
over the whole repo, Trivy config+fs scans (HIGH/CRITICAL), ansible-lint on
`ansible/`, compose config validation, dashboard build with a stale-`dist`
check, and catalog/policy tests on Python 3.10 and 3.12. Local equivalents:

```bash
.venv/bin/python -m unittest discover -s tests -v   # 38 tests, no services needed
cd dashboard && npm run build                        # then commit dashboard/dist
yamllint .
gitleaks detect --no-banner
ansible-lint ansible/                                # only when touching ansible/
cd <service-dir> && docker compose [-f overlay.yml] config -q
python3 ctl/registry.py status                       # after up: all containers running
```

CI's compose-validation job tolerates `.env` interpolation failures (no
`.env` files exist in CI); only genuine config errors fail there.

## Host bootstrap

`docs/SETUP.md` is the full rebuild runbook. Fresh hosts use `./install.sh`
(idempotent; preview with `./install.sh --dry-run`) — it prepares Docker, the
shared networks, the Python venv, root `.env` tokens, and three systemd user
units (`homelab-ctl`, `homelab-ctl-mcp`, `homelab-app-mcp@`). `./start.sh`
restarts those units and waits for the dashboard. `ansible/bootstrap.yml`
(roles: base, docker, firewall, tailscale) provisions idempotently — dry-run
first: `ansible-playbook bootstrap.yml --check --diff --ask-become-pass`.

## Repo conventions

- Data dirs (bind mounts like `*/data`, `nextcloud/html`,
  `apps/immich-app/library`) are gitignored — configs are tracked, runtime
  data never is.
- Historical change records live in `docs/documentation/` (`PHASE_*.md`) —
  local-only, gitignored, never pushed.
- `docs/review/` holds the living review: stack index, security critique,
  AI-agent architecture, research notes, product plan, subagent fleet plan.
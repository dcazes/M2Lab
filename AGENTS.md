# AGENTS.md

OmniLab — a Docker Compose homelab (~16 self-hosted services, one top-level
dir each) with a FastAPI/React control plane and a governed MCP capability
layer for AI agent harnesses. Verification means catalog unit tests, a
production UI build, valid compose configs, and CI security scans.

## Architecture at a glance

```text
services.yaml          ← source of truth for all services
catalog.yaml           ← app catalog, profiles, workflows, MCP manifests
ctl/                   ← Python control plane (registry, MCP server, catalog, dashboard)
ctl-web-next/          ← React/Vite dashboard (served by ctl.app on :8787)
ctl/mcp_server.py      ← homelab-ctl MCP: lifecycle + discovery tools
ctl/mcp_registry.py    ← federated MCP registry, health checks, harness exports
ctl/app_mcp.py         ← read-focused MCP adapters for firecrawl, paperless, immich, ollama
ctl/catalog.py         ← progressive capability discovery (task → capability matching)
ctl/initiate.py        ← safe env preparation for automated first-run setup
opencode.json          ← agent harness config (MCP server wiring)
.opencode/agents/      ← agent profiles (default primary, omnilab orchestrator, litellm read-only)
.opencode/skills/      ← agent skills (currently: litellm-model-catalog)
```

## Control plane

- `services.yaml` is the single source of truth: service ids, dirs, ports,
  health checks, backup definitions, dashboard settings. `id` and `dir` can
  differ (`immich` → `immich-app/`, `freellmapi` → `FreeLLMAPI/`).
- The Makefile is a thin wrapper over `ctl/registry.py`. Generic verbs work
  for any registered id with no Makefile edit:
  `make up|stop|restart|logs|pull|update SERVICE=<id>`.
  Bare targets like `make vaultwarden` are just aliases for `up`.
- Make targets are generated from `services.yaml` at parse time
  (`ctl/registry.py ids`) — broken YAML there breaks every make target.
- Some services define overlay compose files (`compose_files:`, e.g.
  `docker-compose.gpu.yml` for surfsense/ollama). Use `make ... SERVICE=<id>`
  / `registry.py` rather than raw `docker compose` inside a service dir, or
  you'll silently miss overlays.
- Dashboard: `.venv/bin/python -m ctl.app` → FastAPI on 127.0.0.1:8787
  serving `ctl-web-next/dist/`; deployed as systemd user unit
  `deploy/homelab-ctl.service`. Mutations require short-lived approval
  tokens; destroy also requires body `{"confirm":"<service-id>"}`.
- Backups: `./scripts/backup.sh [service-id|all]`, driven by each service's
  `backup:` block in services.yaml (postgres dumps by container name, named
  volumes, binds).

## Catalog and progressive capability discovery

`catalog.yaml` declares the user-facing app catalog: 16+ apps across
research, productivity, media, AI, and creative categories. Each app has
capabilities with risk tiers (read → draft → write → operational →
destructive → privileged).

Six outcome profiles group apps by user goal: research, money, travel,
wellness, creative, local-ai. Four cross-app workflows are designed but
staged (trip-research, receipt-to-budget, photo-receipt-to-budget,
memory-to-trip).

`ctl/catalog.py` provides lexical task→capability matching without injecting
every tool schema into an agent context. `ctl/mcp_server.py` exposes this as
`omnilab_discover_app_capabilities` and `omnilab_discover_app_workflows` MCP
tools.

## MCP layer

The MCP fleet is the durable agent integration asset. Two layers exist today:

**homelab-ctl MCP** (`ctl/mcp_server.py`, port 8790):
- Lifecycle tools: `svc_status`, `svc_up`, `svc_stop`, `svc_restart`,
  `svc_pull`, `svc_update`, `svc_logs`, `status_all`
- Discovery tools: `discover_app_capabilities`, `discover_app_workflows`,
  `evaluate_capability_risk`
- Security: bearer-token auth (CTL_MCP_TOKEN), dirty-repo gate blocks
  mutating verbs when the working tree is dirty, per-service async locks
  serialize concurrent operations

**App MCP adapters** (`ctl/app_mcp.py`):
- Read-focused adapters for firecrawl, paperless-ngx, immich, ollama
- Each runs as a systemd user unit (`deploy/homelab-app-mcp@<sid>.service`)
- Auth via per-service scoped API keys stored in gitignored `.env` files

**Federated registry** (`ctl/mcp_registry.py`):
- Combines catalog MCP manifests with runtime health checks
- Produces harness-specific exports (opencode.json, open-webui config)
- State tracking: live, degraded, authentication_required, disabled, unavailable

**Vaultwarden is intentionally excluded from all MCP and agent access.**

## Agent system

Agent profiles live in `.opencode/agents/`:

| Agent | Mode | Purpose |
|-------|------|---------|
| `default` | primary | General-purpose coding agent for this project. Full file/shell/web access + both MCP servers. |
| `omnilab` | subagent | Progressive-discovery orchestrator. Owns no credentials; discovers capabilities via MCP, evaluates risk, delegates to app subagents. |
| `litellm` | subagent | Read-only LiteLLM model catalog. Drives the litellm MCP server exclusively. |

Skills live in `.opencode/skills/<name>/SKILL.md`. Currently:
- `litellm-model-catalog` — summarize models, routing, keys, budgets, spend

The subagent fleet plan (`docs/review/06-subagent-fleet-plan.md`) describes
15 app-specific subagents (one per service except Vaultwarden). They will be
added incrementally as their MCP servers come online.

## Python venv

`.venv/` at the repo root is required by `scripts/backup.sh` and both
systemd units:

```bash
python3 -m venv .venv && .venv/bin/pip install -r ctl/requirements.txt
```

## Adding or changing a service

Follow `docs/ADDING_APPS.md`; start stacks from `docs/compose-template.yml`,
register in `services.yaml`. Rules baked into the template:

- Ports bind to `127.0.0.1` only. Tailscale Serve is the only public door:
  `sudo tailscale serve --bg --https=<tailnet_port> http://127.0.0.1:<port>`.
- Reuse the shared external networks `frontend-net` / `backend-net` (actual
  Docker networks `homelab_frontend` / `homelab_backend`, created by
  Ansible). Never define new networks — subnet exhaustion.
- Databases/caches: backend-net only, no published ports, and never add
  `user:` / `cap_drop:` / `read_only:` to stock postgres/redis/postgis/
  mariadb images — their entrypoints need privileged boot (this broke
  nextcloud-db/puppygraph before).
- Secrets only as `${VAR}` resolved from gitignored `<service>/.env`; ship
  an `.env.example`. Gitleaks runs in CI.
- Pick free loopback + tailnet ports (allocation list at the bottom of
  ADDING_APPS.md).
- `ignore_containers:` in a service's entry keeps sidecars
  (migrations/cron/db) out of status aggregation.
- To add an MCP adapter for a new service, register its manifest in
  `catalog.yaml` → `mcp_servers:` and implement a read-focused adapter in
  `ctl/app_mcp.py` if the app doesn't have a native MCP server.

## Initiation and first-run setup

`ctl/initiate.py` defines automated services: vaultwarden, freellmapi,
litellm, ollama, firecrawl, nextcloud, surfsense, open-webui. The
`prepare_environment()` function generates secure credentials, writes them
directly to mode-0600 `.env` files, and never returns secrets to the browser.

The dashboard's Settings view uses `/api/install/{sid}/prepare` (generic) and
`/api/initiate/{sid}/prepare` (automated services) to drive installation.
Vaultwarden is always first — the user creates its master account directly
in the app.

## Security model

- Dashboard and app ports bind to loopback; Tailscale is the supported
  remote door.
- `.env` files are gitignored, agent containers cannot read them, and
  browser setup responses never contain stored secret values.
- Lifecycle approvals are short-lived (120s) and bound to one service and
  action.
- Audit records (`/api/audit`, `.state/audit.jsonl`) contain event metadata,
  never secret values or Compose output.
- Recent service logs are bounded and remain inside the localhost/tailnet
  dashboard boundary.
- Vaultwarden has no agent or MCP exposure.
- Docker-socket services are treated as root-equivalent and remain read-only
  or outside agent routing.
- The MCP server's dirty-repo gate blocks mutating compose verbs when the
  working tree has uncommitted changes.

## Verification

CI (`.github/workflows/ci.yml`) gates pushes/PRs to main: Gitleaks, yamllint
over the whole repo, Trivy config+fs scans (HIGH/CRITICAL), ansible-lint on
`ansible/`. Local equivalents before pushing:

```bash
.venv/bin/python -m unittest discover -s tests -v
cd ctl-web-next && npm run build
yamllint .
gitleaks detect --no-banner
ansible-lint ansible/            # when touching ansible/
cd <service-dir> && docker compose [-f overlay.yml] config -q
python3 ctl/registry.py status   # after up: all containers running
```

## Host bootstrap

`docs/SETUP.md` is the full rebuild runbook. `ansible/bootstrap.yml` (roles:
base, docker, firewall, tailscale) provisions a fresh Debian/Ubuntu host
idempotently — dry-run first:
`ansible-playbook bootstrap.yml --check --diff --ask-become-pass`.

## Repo conventions

- Data dirs (bind mounts like `*/data`, `nextcloud/html`,
  `immich-app/library`) are gitignored — configs are tracked, runtime data
  never is.
- Historical change records live in `docs/documentation/` (`PHASE_*.md`) —
  local-only, gitignored, never pushed.
- `docs/review/` holds the living review: stack index, security critique,
  AI-agent architecture, research notes, product plan, subagent fleet plan.

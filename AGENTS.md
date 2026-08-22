# AGENTS.md

Ops repo for a Docker Compose homelab (~16 self-hosted services, one top-level dir each). No application code, no test suite — verification means valid compose config plus the CI security scans.

## Control plane

- `services.yaml` is the single source of truth: service ids, dirs, ports, health checks, backup definitions, dashboard settings. `id` and `dir` can differ (`immich` → `immich-app/`, `freellmapi` → `FreeLLMAPI/`).
- The Makefile is a thin wrapper over `ctl/registry.py`. Generic verbs work for any registered id with no Makefile edit: `make up|stop|restart|logs|pull|update SERVICE=<id>`. Bare targets like `make vaultwarden` are just aliases for `up`.
- Make targets are generated from `services.yaml` at parse time (`ctl/registry.py ids`) — broken YAML there breaks every make target.
- Some services define overlay compose files (`compose_files:`, e.g. `docker-compose.gpu.yml` for surfsense/ollama). Use `make ... SERVICE=<id>` / `registry.py` rather than raw `docker compose` inside a service dir, or you'll silently miss overlays.
- Dashboard: `.venv/bin/python -m ctl.app` → FastAPI on 127.0.0.1:8787 serving `ctl-web/`; deployed as systemd user unit `deploy/homelab-ctl.service`. `POST /api/services/{id}/destroy` runs `compose down` and requires body `{"confirm":"<service-id>"}`.
- Backups: `./scripts/backup.sh [service-id|all]`, driven by each service's `backup:` block in services.yaml (postgres dumps by container name, named volumes, binds).

## Python venv

`.venv/` at the repo root is required by `scripts/backup.sh` and both systemd units:

```bash
python3 -m venv .venv && .venv/bin/pip install -r ctl/requirements.txt
```

## Adding or changing a service

Follow `docs/ADDING_APPS.md`; start stacks from `docs/compose-template.yml`, register in `services.yaml`. Rules baked into the template:

- Ports bind to `127.0.0.1` only. Tailscale Serve is the only public door: `sudo tailscale serve --bg --https=<tailnet_port> http://127.0.0.1:<port>`; Homepage rides root :443.
- Reuse the shared external networks `frontend-net` / `backend-net` (actual Docker networks `homelab_frontend` / `homelab_backend`, created by Ansible). Never define new networks — subnet exhaustion.
- Databases/caches: backend-net only, no published ports, and never add `user:` / `cap_drop:` / `read_only:` to stock postgres/redis/postgis/mariadb images — their entrypoints need privileged boot (this broke nextcloud-db/puppygraph before).
- Secrets only as `${VAR}` resolved from gitignored `<service>/.env`; ship an `.env.example`. Gitleaks runs in CI.
- Pick free loopback + tailnet ports (allocation list at the bottom of ADDING_APPS.md).
- Add a tile in `homepage/config/services.yaml` if it should appear on the landing page.
- `ignore_containers:` in a service's entry keeps sidecars (migrations/cron/db) out of status aggregation.

## Verification (no test suite)

CI (`.github/workflows/ci.yml`) gates pushes/PRs to main: Gitleaks, yamllint over the whole repo, Trivy config+fs scans (HIGH/CRITICAL), ansible-lint on `ansible/`. Local equivalents before pushing:

```bash
yamllint .
gitleaks detect --no-banner
ansible-lint ansible/            # when touching ansible/
cd <service-dir> && docker compose [-f overlay.yml] config -q   # validate compose
python3 ctl/registry.py status   # after up: all containers running
```

## Host bootstrap

`docs/SETUP.md` is the full rebuild runbook. `ansible/bootstrap.yml` (roles: base, docker, firewall, tailscale) provisions a fresh Debian/Ubuntu host idempotently — dry-run first: `ansible-playbook bootstrap.yml --check --diff --ask-become-pass`.

## Repo notes

- `PHASE_*.md` and `HOMEPAGE_IMPROVEMENTS.md` are historical change records, not open work.
- Data dirs (bind mounts like `*/data`, `nextcloud/html`, `immich-app/library`) are gitignored — configs are tracked, runtime data never is.

## Stack review & AI-agent layer

`docs/review/` holds the living review of this stack: `01-stack-index.md` (what runs/how), `02-critique.md` (setup/networking/security findings with severity), `03-ai-agent-architecture.md` (MCP-per-service + subagent + intent-router design), `04-research-notes.md` (grounded web research). Start there before proposing changes to networking, security, or the agent layer.
- Data dirs (bind mounts like `*/data`, `nextcloud/html`, `immich-app/library`) are gitignored — configs are tracked, runtime data never is.

## Stack review & AI-agent layer

`docs/review/` holds the living review of this stack: `01-stack-index.md` (what runs/how), `02-critique.md` (setup/networking/security findings with severity), `03-ai-agent-architecture.md` (MCP-per-service + subagent + intent-router design), `04-research-notes.md` (grounded web research). Start there before proposing changes to networking, security, or the agent layer.

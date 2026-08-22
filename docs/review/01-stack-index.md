# Stack Index — What Runs and How

> **Source:** local inventory via `@explorer` (2026-08-22), reconciled with
> `services.yaml`. Companion docs: `02-critique.md`, `03-ai-agent-architecture.md`,
> `04-research-notes.md`.
> **Convention:** inventory records *that* a credential exists and *where*
> (path), never the value.

---

## 1. How the stack runs (control plane)

- **Single source of truth:** `services.yaml` — 16 services, each with `id`,
  `dir`, `port` (loopback), `tailnet_port` (Tailscale Serve), health check, and
  optional `backup:` / `compose_files:` (overlay) blocks.
- **Lifecycle:** `ctl/registry.py` is the engine behind the Makefile. Generic
  verbs (`make up|stop|restart|logs|pull|update SERVICE=<id>`) run
  `docker compose [-f overlay.yml] ...` inside each service dir. Overlays
  (e.g. `docker-compose.gpu.yml` for surfsense/ollama) are applied automatically.
- **Dashboard:** `ctl/app.py` — FastAPI on `127.0.0.1:8787` serving `ctl-web/`,
  deployed as systemd user unit `deploy/homelab-ctl.service`. Endpoints:
  `/api/services` (state+health), `/api/services/{id}/{action}` (up/stop/...),
  `/api/services/{id}/destroy` (requires body `{"confirm":"<id>"}`),
  `/api/system` (host stats). **No authentication** beyond the destroy
  double-confirm and loopback binding.
- **Portainer shim:** `portainer-proxy/proxy.py` on `127.0.0.1:8788` injects the
  Portainer API key and adds CORS; Homepage's `custom.js` calls it.
- **Exposure model:** every published port binds `127.0.0.1`; the only public
  door is **Tailscale Serve**:
  `sudo tailscale serve --bg --https=<tailnet_port> http://127.0.0.1:<port>`
  Homepage rides root `:443`.
- **Networks:** shared external `frontend-net` (`homelab_frontend`) and
  `backend-net` (`homelab_backend`, internal/no-egress), created by Ansible.
  Databases/caches live on backend-net only.
- **Backups:** `scripts/backup.sh [service-id|all]` → `scripts/backup.py`;
  driven by per-service `backup:` blocks (postgres dumps by container, named
  volumes, binds). Stored under `backups/` with date suffix.
- **CI:** `.github/workflows/ci.yml` gates pushes/PRs to main with Gitleaks,
  yamllint, Trivy config+fs (HIGH/CRITICAL), and ansible-lint on `ansible/`.

---

## 2. Service inventory

| # | id | Image / tag | Loopback port | Networks | Hardening | Healthcheck | Notable |
|---|----|-------------|---------------|----------|-----------|-------------|---------|
| 1 | surfsense | `modsetter/surfsense-backend:latest`, pgvector, redis:8, searxng, opensandbox, caddy | 3929 | **default bridge (no shared nets)** | `no-new-privileges` only; no `user`/`cap_drop`/`read_only` | yes (multi) | **docker.sock mount** in opensandbox-server; GPU overlay; `ZERO_ADMIN_PASSWORD` env |
| 2 | immich | `immich-server:${IMMICH_VERSION}`, immich-ml, valkey@sha256, postgres@sha256 | 2283 | frontend+backend | `no-new-privileges`, `user 1000`, `cap_drop ALL`, `read_only` (server) | yes | digest-pinned db/redis; no docker.sock |
| 3 | litellm | `berriai/litellm:main-latest` | 4000 | frontend only | `no-new-privileges`, `cap_drop ALL` | yes (`/health/liveliness`) | LLM gateway/router; fronts FreeLLMAPI (host:3001) + Ollama (host:11434), fallback free-auto→local; service `.env.example` present |
| 4 | vaultwarden | `vaultwarden/server:latest` | 8081 | frontend+backend | `no-new-privileges`, `user 1000`, `cap_drop ALL`, `read_only`, tmpfs | yes (http) | **hardcoded `DOMAIN`** in compose; `:latest` |
| 5 | puppygraph | `puppygraph:latest` | 8082/8182/7687 | frontend only | `no-new-privileges`, `user 1000`, `cap_drop ALL` | **none** | no `read_only`; no service `.env.example` |
| 6 | homepage | `gethomepage/homepage:latest` | 8083 | frontend+backend | `no-new-privileges`, `user 1000`, `cap_drop ALL`, `read_only`, tmpfs | **none** | **docker.sock :ro** (Portainer-proxy dep) |
| 7 | mealie | `mealie:latest` | 9000 | frontend+backend | `no-new-privileges`, `user 1000`, `cap_drop ALL` | yes (http) | — |
| 8 | actual-budget | `actualbudget/actual-server:latest` | 5006 | frontend+backend | `no-new-privileges`, `user 1000`, `cap_drop ALL` | **none** | — |
| 9 | beszel | `beszel:latest` + `beszel-agent:latest` | 8090 | frontend+backend (agent: `network_mode: host`) | `no-new-privileges`, `user 1000`, `cap_drop ALL`, `read_only` (hub) | **none** | **beszel-agent: docker.sock :ro + host network**; agent has no restart policy |
| 10 | paperless-ngx | `paperless-ngx:latest`, postgres:17, redis:7, gotenberg, tika | 8010 | frontend+backend | `no-new-privileges`, `cap_drop ALL`, `user 1000`, `read_only` (paperless) | **none on app** | digest-pinned valkey |
| 11 | adventurelog | `adventurelog:latest`, `postgis:16-3.5` | 8015 | frontend+backend | `no-new-privileges`, `cap_drop ALL` | **none** | **no `user:` on postgis** (entrypoint needs privileged boot) |
| 12 | nextcloud | `nextcloud:apache`, postgres:17, redis:7, cron | 8020 | frontend+backend | `no-new-privileges`, `cap_drop ALL`, `user 1000` (app) | **none** | `user 1000` on app may conflict with db/redis entrypoints |
| 13 | portainer | `portainer-ce:latest` | 9090 | frontend only | `no-new-privileges` only | yes (http) | **docker.sock mount**; **no `cap_drop`**; `:latest` |
| 14 | ollama | `ollama/ollama:latest` | 11434 | **default bridge (no shared nets)** | **none** | **none** | GPU overlay; `OLLAMA_HOST=0.0.0.0` inside; no hardening |
| 15 | open-webui | `open-webui:main` (**unpinned**) | 8084 | **default bridge (no shared nets)** | **none** | **none** | **no hardening at all**; `:main` tag; `OPENAI_API_KEY=not-needed` literal |
| 16 | firecrawl | `firecrawl:latest`, playwright, redis, rabbitmq, nuq-postgres | 3002 | **custom `backend` net (violates rule)** | `no-new-privileges`+`cap_drop` on api/playwright only | rabbitmq only | **defines new network**; redis bound `0.0.0.0`; `:latest` |

**Legend:** "shared nets" = `frontend-net`/`backend-net`. "Hardening" columns
show which of `no-new-privileges` / `user` / `cap_drop` / `read_only` are present.

---

## 3. Networking model (as-built)

- **Loopback-first:** all 16 published ports bind `127.0.0.1`; Tailscale Serve is
  the only ingress.
- **Shared networks:** most services join `frontend-net`+`backend-net`. Exceptions:
  - **surfsense, ollama, open-webui** → default bridge only (cannot reach
    backend-net databases by service name; rely on `host.docker.internal`).
  - **firecrawl** → defines its own `backend` network (AGENTS.md violation).
  - **beszel-agent** → `network_mode: host` (bypasses shared nets entirely).
- **Internal 0.0.0.0 binds:** ollama (`OLLAMA_HOST=0.0.0.0` inside container),
  firecrawl redis (`--bind 0.0.0.0`) — these listen on all container interfaces
  even though the published port is loopback.
- **docker.sock exposure (highest-risk surface):**
  - `portainer` (full Docker API)
  - `surfsense` opensandbox-server
  - `homepage` (read-only)
  - `beszel-agent` (read-only, but on host network)

---

## 4. Secrets & config model

- **No hardcoded secrets found** in compose files — all credentials are
  `${VAR:-default}` env references resolved from per-service `.env` (gitignored).
- **Root `.env.example`** ships `change_me` placeholders for all major vars.
- **Missing per-service `.env.example`:** puppygraph, adventurelog,
  nextcloud, open-webui, ollama, firecrawl (only root template exists).
- **Hardcoded non-secret config:** vaultwarden `DOMAIN` literal in compose.
- **CI secret scan:** Gitleaks runs in CI; no local pre-commit hook configured.

---

## 5. Backups, CI, bootstrap

- **Backups:** `scripts/backup.sh` → `backup.py`; no encryption flag, no offsite
  target, retention handled inside `backup.py` (not audited here).
- **CI gates:** Gitleaks → yamllint → Trivy config+fs (HIGH/CRITICAL) →
  ansible-lint. Solid for a no-test-suite repo.
- **Ansible bootstrap:** roles `base` (apt, ufw, tz — **no fail2ban, no SSH
  hardening**), `docker` (engine + shared nets), `firewall` (ufw deny-incoming,
  allow SSH + tailscale0; notes Docker bypasses UFW), `tailscale` (**authkey
  empty** → manual `tailscale up`).

---

## 6. What's missing (see `02-critique.md`)

- 3 services with **zero container hardening** (open-webui, ollama, and partial
  portainer).
- 4 services **not on shared networks** (surfsense, ollama, open-webui, firecrawl).
- **docker.sock** mounted in 4 places; portainer has no `cap_drop`.
- **Unpinned/`:latest`** images across most services; open-webui on `:main`.
- **Missing healthchecks** on 8 services (breaks dashboard health + update gate).
- **No per-service `.env.example`** for 7 services.
- **No backup encryption/offsite**, **no fail2ban/SSH hardening**, **no Tailscale
  authkey**, **no local Gitleaks hook**.
- **AI services missing Homepage tiles** (ollama, open-webui, firecrawl).

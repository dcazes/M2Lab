# PHASE_8: Adding Seven New Services

## Overview
Added seven self-hosted applications to the homelab control plane:
- **Homepage** - Service dashboard (now serves as landing page at :443)
- **Mealie** - Recipe manager
- **Actual Budget** - Local-first budgeting app  
- **Beszel** - Lightweight server monitoring (hub + agent)
- **Paperless-ngx** - Document management with OCR
- **AdventureLog** - Travel tracker & trip planner
- **Nextcloud** - File sync & cloud suite

All services integrate with the existing Makefile CLI, FastAPI dashboard, and Tailscale remote access.

## Key Changes

### 1. Backup System Refactor
- Converted `backup.sh` to declarative model
- Each service in `services.yaml` now includes a `backup:` section specifying:
  - `dumps`: PostgreSQL/SQLite database containers to pg_dump
  - `volumes`: Named Docker volumes to tar
  - `binds`: Host bind mounts to tar
- `scripts/backup.py` generic executor reads YAML and performs backups
- Shell wrapper unchanged: `./scripts/backup.sh [service-id|all]`
- Verified identical output to previous hardcoded version

### 2. Registry Expansion
- Added 7 service entries to `services.yaml` with:
  - Unique IDs and human-readable display names
  - Category/icons for dashboard grouping
  - Compose directory and project name
  - Local port and tailnet port mapping
  - Health check endpoint and method
  - Backup specification (per refactor above)
  - Ignore containers list where applicable (e.g., agent/sidecar containers)

### 3. Makefile Updates
- Added explicit start targets for each new service:
  `homepage`, `mealie`, `actual-budget`, `beszel`, `paperless-ngx`, `adventurelog`, `nextcloud`
- Help text now dynamically lists all services from registry
- Stop/logs/pull pattern rules work automatically via `SERVICE=` variable
- Global targets (`start-all`, `stop-all`, `status`, `update`) include new services

### 4. Service Configurations

#### Homepage
- Image: `ghcr.io/gethomepage/homepage:latest`
- Port: 8083 → maps to tailscale :443 (landing page)
- Config: `./config/` bind mount (tracked in git)
- Displays cards for all 12 services grouped by category
- Includes quick-search and system resource widgets

#### Mealie
- Image: `ghcr.io/mealie-recipes/mealie:latest`
- Port: 9000 → tailnet 8455
- Volume: `./data` (SQLite by default)
- First login: create admin user

#### Actual Budget
- Image: `actualbudget/actual-server:latest`
- Port: 5006 → tailnet 8452
- Volume: `./server-files` (SQLite files)
- First login: create account via web UI

#### Beszel
- Hub: `henrygd/beszel:latest`, port 8090 → tailnet 8450
- Agent: `henrygd/beszel-agent:latest`, `network_mode: host`
- Volumes: `./beszel_data`, `./beszel_socket`, `/var/run/docker.sock:ro`
- First-run steps:
  1. Visit http://localhost:8090, create admin account
  2. Settings → Tokens → create universal token → note token
  3. Add System → Host/IP: `/beszel_socket/beszel.sock` → note KEY
  4. Update `beszel/.env`: `BESZEL_TOKEN=<token>`, `BESZEL_KEY=<key>`
  5. `make stop-beszel SERVICE=beszel && make beszel`
- Health: hub HTTP 200 (agent restarts until configured)

#### Paperless-ngx
- Stack: paperless-ngx + postgres:17 + redis:7 + gotenberg/gotenberg:8 + apache/tika:latest-full
- Port: 8010 → tailnet 8451
- Volumes:
  - `./data` (Postgres via `PGDATA`)
  - `./media` (documents)
  - `./consume` (import folder)
  - `./export` (exports)
- Secrets:
  - `PAPERLESS_SECRETKEY` (generated via openssl)
  - `PAPERLESS_DBPASSWORD` (Postgres password)
- First login: create superuser account
- Note: Set `PAPERLESS_URL` and `PAPERLESS_CSRF_TRUSTED_ORIGINS` in .env for tailnet access

#### AdventureLog
- Image: `ghcr.io/seanmorley15/adventurelog:latest` (standard deployment)
- Depends on: `postgis/postgis:16-3.5`
- Port: 8015 → tailnet 8454
- Volumes:
  - `./media` (uploaded media)
  - `./pgdata` (PostGIS data)
- First login: `admin` / `admin` → change immediately via web UI

#### Nextcloud
- Stack: `nextcloud:apache` + postgres:17 + redis:7 + cron sidecar
- Port: 8020 → tailnet 8453
- Volumes:
  - `./html` (Nextcloud code)
  - `./data` (user data)
- First-run: Web wizard creates admin account
- Post-install steps (via `docker exec`):
  ```bash
  docker exec nextcloud-occ \
    php occ config:system:set trusted_domains \
    --value="localhost:8020" --value="home.taile2cc7a.ts.net"
  docker exec nextcloud-occ \
    php occ config:system:set overwriteprotocol --value=https
  ```
- Health: `/status.php` returns 200 (JSON includes `"installed":true` post-setup)

### 5. Tailscale Integration
All services expose via Tailscale MagicDNS:
- `https://home.taile2cc7a.ts.net:443` → Homepage (landing page)
- `:8449` → Control dashboard (FastAPI)
- `:8450` → Beszel hub
- `:8451` → Paperless-ngx
- `:8452` → Actual Budget
- `:8453` → Nextcloud
- `:8454` → AdventureLog
- `:8455` → Mealie

Existing mappings unchanged:
- `:8443` → Immich (2283)
- `:8444` → SurfSense (3929)
- `:8445` → FreeLLMAPI (3001)
- `:8446` → Vaultwarden (8081)
- `:8448` → PuppyGraph (8082)

### 6. Repository Prep
- `.gitignore` updated to exclude new service data dirs:
  - Paperless: `data/`, `media/`, `consume/`, `export/`
  - Nextcloud: `html/`, `data/`
  - Mealie: `data/`
  - Beszel: `beszel_data/`, `beszel_agent_data/`, `beszel_socket/`
  - AdventureLog: `media/`, `pgdata/`
  - Actual Budget: `server-files/`
- All services include `.env.example` templates (secrets omitted)
- Compose files and configs tracked for reproducibility

## Manual Steps Remaining
1. **Beszel**: Complete agent setup via UI as described above
2. **Nextcloud**: Run first-run wizard via HTTPS tailnet URL, then execute occ commands for trusted domains and overwrite https
3. Verify all services healthy in dashboard
4. Consider adding homepage widgets for any missing services

## Verification
All 12 services reachable locally:
- Homepage: http://localhost:8083 → 200
- Mealie: http://localhost:9000 → 200  
- Actual Budget: http://localhost:5006 → 200
- Beszel hub: http://localhost:8090 → 200
- Paperless-ngx: http://localhost:8010 → 302 (login redirect)
- AdventureLog: http://localhost:8015 → 200
- Nextcloud: http://localhost:8020/status.php → 200

Services may require initial setup via web UI before full functionality.

## Next Logical Step
When ready for production cutover:
1. Stop original stacks in `~/Desktop/Programs/`
2. Final `rsync` if preserving user data (optional)
3. Archive original directories
4. Cutover to `~/Desktop/Programs/HomeServer/` as source of truth
5. Update systemd service paths if relocating
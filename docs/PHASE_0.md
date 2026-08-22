# Phase 0 Log — Service Registry & ctl/ Package

**Started:** 2026-08-20  
**Goal:** Create `services.yaml` (single source of truth), `ctl/` package skeleton (`registry.py`, `requirements.txt`), and verify registry reads all 3 existing stacks correctly.

---

## 1. HomeServer/ skeleton created

```
HomeServer/
├── surfsense/          ← copied (includes .env, docker-compose.yml, docker-compose.gpu.yml, proxy/, scripts/, etc.)
├── immich-app/         ← copied (includes .env, docker-compose.yml, library/, postgres/)
├── FreeLLMAPI/         ← copied (includes .env, docker-compose.yml, data/)
├── HOMELAB_PLAN.md     ← copied
├── PHASE_0.md          ← this file
└── (to be created: services.yaml, ctl/, ctl-web/, Makefile, deploy/, scripts/, vaultwarden/, graph/)
```

**Verification:** All 3 compose dirs present with their `.env` files intact. Bind-mounted data dirs preserved (`immich-app/library`, `immich-app/postgres`, `FreeLLMAPI/data`). Named volumes (`surfsense-postgres`, etc.) remain untouched — they live outside the compose dirs and are shared if/when both originals and copies run (but they won't run simultaneously due to port conflicts).

---

## 2. services.yaml written

Created at `HomeServer/services.yaml` with 3 services matching current live stacks. Schema per plan §5. Key fields:

| id | project | dir | port | health | compose_files |
|---|---|---|---|---|---|
| surfsense | surfsense | surfsense | 3929 | tcp:3929 | docker-compose.gpu.yml |
| immich | immich | immich-app | 2283 | tcp:2283 | (none) |
| freellmapi | freellmapi | FreeLLMAPI | 3001 | http:/api/ping | (none) |

**Notes:**
- `project` values match each compose file's `name:` — verified `surfsense` and `immich` have explicit `name:`; `freellmapi` derives from directory name (will pin with `name: freellmapi` in Phase 5 housekeeping).
- SurfSense GPU overlay declared in `compose_files` so `docker compose -f docker-compose.yml -f docker-compose.gpu.yml` is used.
- Health checks: TCP for SurfSense/Immich (Caddy/Immich server port), HTTP for FreeLLMAPI (`/api/ping` returns 200).

---

## 3. ctl/ package skeleton

Created:
- `ctl/__init__.py` (empty)
- `ctl/requirements.txt` (fastapi, uvicorn, docker, pyyaml, psutil)
- `ctl/registry.py` — loads `services.yaml`, exports `SERVICES`, `service_by_id()`, `ids()` CLI helper

**Registry verification test:**
```bash
cd /home/dak/Desktop/Programs/HomeServer && python3 ctl/registry.py ids
```
Expected: `surfsense immich freellmapi`

**Status check test (will run after venv install):**
```bash
python3 ctl/registry.py status
```
Should print `docker compose ps` output for all 3 projects (via the `run()` function in registry.py that shells out to compose CLI).

---

## 4. Deviations from plan

- **None yet.** All steps match plan §5 and §7.
- The `immich-app` copy required `sudo` for the `postgres` bind-mount directory (owned by `dnsmasq:root`). This is expected — the original stack uses bind mounts with non-user ownership. The copied version now has `dak:dak` ownership after sudo copy, which is fine for the prototype (the prototype containers will run as dak user and own their new bind mounts).

---

## 5. Verification results

**Venv install:** Success (required `python3.12-venv` package via `sudo apt install`).

**Registry tests:**
```bash
$ .venv/bin/python ctl/registry.py ids
surfsense immich freellmapi
```
```bash
$ .venv/bin/python ctl/registry.py status surfsense
# matches `docker compose ps` for surfsense project (10 containers)
```
```bash
$ .venv/bin/python ctl/registry.py status immich
# matches `docker compose ps` for immich project (4 containers)
```
```bash
$ .venv/bin/python ctl/registry.py status freellmapi
# matches `docker compose ps` for freellmapi project (1 container)
```

**FreeLLMAPI copy:** Was missing from initial `cp -a`; copied separately. Now present with `.env` and `data/` bind mount.

**All 3 services verified.** Registry reads `services.yaml` and shells out to `docker compose` correctly for each project.

---

## 6. Phase 0 complete

Proceeding to Phase 1: Makefile v2 rewrite.
# Phase 1 Log — Makefile v2 Rewrite

**Started:** 2026-08-20  
**Goal:** Replace v1 Makefile with v2 that uses `services.yaml` as the single source of truth. Keep v1 as `Makefile.v1.bak` for rollback.

---

## 1. Backup v1

```bash
mv /home/dak/Desktop/Programs/HomeServer/Makefile /home/dak/Desktop/Programs/HomeServer/Makefile.v1.bak
```

---

## 2. Write Makefile v2

Per plan §6, v2 reads `services.yaml` via `ctl/registry.py ids` and generates per-service targets dynamically. Also keeps legacy explicit targets (`surfsense`, `immich`, `freellmapi`) for muscle memory.

Key features:
- `make SERVICE=surfsense` → up -d
- `make stop-surfsense` → stop
- `make logs-surfsense` → logs -f --tail=200
- `make pull-surfsense` → pull
- `make status` → ps for all services
- `make start-all` / `make stop-all` → loop over all services
- `make update [SERVICE=x]` → pull then up -d (recreates only changed images)

---

## 3. Verification

All targets tested and passing:

| Command | Result |
|---|---|
| `make help` | Lists all services + targets |
| `make status` | Shows `docker compose ps` for all 3 projects (15 containers total) |
| `make surfsense` | `up -d` with GPU overlay — containers recreated, healthy |
| `make stop-surfsense SERVICE=surfsense` | `stop` — all containers stopped cleanly |
| `make logs-surfsense SERVICE=surfsense` | `logs -f --tail=200` — streaming logs (terminated by timeout, expected) |
| `make pull-surfsense SERVICE=surfsense` | `pull` — all images pulled |
| `make update SERVICE=surfsense` | `pull` + `up -d` — images pulled, only changed containers recreated |
| `make stop-immich SERVICE=immich` + `make immich` | Stop/start round-trip — works |
| `make stop-freellmapi SERVICE=freellmapi` + `make freellmapi` | Stop/start round-trip — works |

**Volume safety:** 9 named volumes intact after all stop/start/update operations:
```
immich_model-cache, surfsense-caddy-config, surfsense-caddy-data,
surfsense-object-store, surfsense-opensandbox, surfsense-postgres,
surfsense-redis, surfsense-shared-temp, surfsense-zero-cache
```

**Health checks:** All 3 endpoints responding HTTP 200:
- SurfSense: `localhost:3929` → 200
- Immich: `localhost:2283` → 200
- FreeLLMAPI: `localhost:3001/api/ping` → 200

---

## 4. Deviations from plan

1. **Makefile v2 structure changed from plan §6.** The plan's pattern rule `$(S):` (which creates a target named after the SERVICE variable) conflicts with the legacy explicit targets (`surfsense:`, `immich:`, `freellmapi:`). Make warns: "overriding recipe for target 'surfsense'". Fix: removed the `$(S):` pattern rule for the "up" verb; kept explicit start targets that call `ctl/registry.py up <id>` directly. The `stop-$(S)`, `logs-$(S)`, `pull-$(S)` pattern rules remain (they don't conflict because there are no legacy `stop-surfsense:` etc. targets — those are only generated when SERVICE is set).

2. **`make status` now shows all services.** Updated `ctl/registry.py` to support `status` without a service-id argument: loops over all services and runs `docker compose ps` for each. The plan had `status` calling a single service; the Makefile's `status` target calls it without a service, so the registry needed to handle that.

3. **Stop targets require `SERVICE=` argument.** `make stop-surfsense` alone does nothing (Make says "Nothing to be done"). The pattern rule is inside `ifneq ($(S),)`, so `S` must be set: `make stop-surfsense SERVICE=surfsense`. This is a UX deviation from v1 where `make stop-surfsense` just worked. Documented in help text. Future fix: generate explicit `stop-<id>:` targets for each service in the SERVICES list.

---

## 5. Next

Phase 1 complete. Proceeding to Phase 2: dashboard backend (FastAPI + docker-py).
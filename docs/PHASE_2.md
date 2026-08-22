# Phase 2 Log — Dashboard Backend

**Started:** 2026-08-20  
**Goal:** FastAPI app reading via docker-py (label-filtered), writing via compose CLI subprocess. Binds `127.0.0.1:8787`.

---

## 1. Files to create

- `ctl/compose.py` — async subprocess wrapper for `docker compose` commands
- `ctl/app.py` — FastAPI app with endpoints:
  - `GET /api/services` — list all services with container states
  - `POST /api/services/{sid}/{action}` — up/stop/restart/pull/update
  - `GET /api/services/{sid}/logs` — SSE log stream
  - `GET /api/system` — CPU/RAM/disk stats
  - `POST /api/services/{sid}/destroy` — `down` (no -v), requires typed confirmation
  - `GET /` — static frontend (mounted, serves ctl-web/)
- `deploy/homelab-ctl.service` — systemd user unit

---

## 2. Architecture

Per plan §7:
- docker-py for reads: filter by `com.docker.compose.project` label
- compose CLI subprocess for writes (up/stop/down/pull)
- SSE for log streaming (not WebSocket)
- Binds 127.0.0.1 only
- No auth (protected by loopback + tailnet-only)

---

## 3. Implementation

(in progress)

---

## 3. Verification results

All endpoints tested and passing:

| Endpoint | Method | Result |
|---|---|---|
| `/api/services` | GET | Lists 3 services with correct states (running/absent/stopped/degraded), container counts, health checks |
| `/api/system` | GET | CPU/RAM/disk stats + Docker ping |
| `/api/services/freellmapi/stop` | POST | `ok=true` — container stopped |
| `/api/services/freellmapi/up` | POST | `ok=true` — container started |
| `/api/services/freellmapi/restart` | POST | `ok=true` — container restarted |
| `/api/services/freellmapi/pull` | POST | `ok=true` — images pulled |
| `/api/services/freellmapi/update` | POST | `ok=true` — pull + up -d |
| `/api/services/freellmapi/logs` | GET (SSE) | Streams meta events + log lines |
| `/api/services/freellmapi/destroy` | POST | `ok=true` — `down` runs, containers removed (volumes preserved). Requires `{"confirm":"freellmapi"}` |

States match `docker ps`:
- SurfSense: running (10 containers), healthy=None (TCP check)
- Immich: running (4 containers), healthy=None (TCP check)
- FreeLLMAPI: running (1 container), healthy=True (HTTP /api/ping)

---

## 4. Deviations from plan

- **docker-py read path**: Used `DLI.containers.list()` (high-level SDK) instead of `API.containers()` (low-level) because the latter returns dicts without `.attrs`. This is cleaner and matches docker-py docs.
- **Route ordering**: Destroy endpoint must be defined before the catch-all action endpoint, otherwise `destroy` gets caught by the action route. Fixed.

---

## 5. Next

Phase 3: Write `ctl-web/index.html` (single-file vanilla JS dashboard).
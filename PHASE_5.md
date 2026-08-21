# Phase 5 Log — New Application Stacks

**Started:** 2026-08-20  
**Goal:** Add Vaultwarden + PuppyGraph stacks. Both appear in dashboard automatically via `services.yaml`.

---

## 1. Plan changes

- **Neo4j dropped.** SurfSense uses PostgreSQL (pgvector), not Neo4j. Neo4j Browser can't connect to it.
- **PuppyGraph added.** Apache 2.0, open source, self-hostable. Connects to SurfSense's PostgreSQL at `host.docker.internal:5432` via JDBC (configured in Web UI). Provides beautiful graph visualization UI with Cypher/Gremlin query support.
- **Graphistry ruled out.** Server is enterprise-only (not open source). pygraphistry is just a client library.

---

## 2. Vaultwarden

### `vaultwarden/docker-compose.yml`
- Image: `vaultwarden/server:latest` (v1.37.1)
- Port: `127.0.0.1:8081:80`
- Data: `./data:/data` (bind mount)
- ADMIN_TOKEN: Argon2id hash (OWASP preset), generated via `argon2-cffi` Python library (docker `/vaultwarden hash` command had a container bug with /dev/random)
- `.env` with `$$` escaping for Argon2 `$` characters in compose interpolation

### Tailscale
- `https://dak-rog-strix-g10dk-g10dk.taile2cc7a.ts.net:8446/` → `127.0.0.1:8081`
- Required for Bitwarden clients (WebCrypto needs HTTPS)

---

## 3. PuppyGraph

### `puppygraph/docker-compose.yml`
- Image: `puppygraph/puppygraph:latest`
- Ports: `127.0.0.1:8082:8081` (Web UI), `127.0.0.1:8182:8182` (Gremlin), `127.0.0.1:7687:7687` (Bolt)
- Data: `./data:/data`
- Credentials: `puppygraph` / `puppygraph123` (change in production)
- Connect to SurfSense DB: configure in Web UI → Create Catalog → PostgreSQL → JDBC `jdbc:postgresql://host.docker.internal:5432/surfsense`, user `surfsense`, password `surfsense`

### Tailscale
- `https://dak-rog-strix-g10dk-g10dk.taile2cc7a.ts.net:8448/` → `127.0.0.1:8082`

---

## 4. Verification

| Service | Container | Port | Health | Dashboard | Tailnet |
|---|---|---|---|---|---|
| Vaultwarden | `vaultwarden` | 8081 | ✅ `/alive` → 200 | ✅ running, healthy=True | ✅ :8446 |
| PuppyGraph | `puppygraph` | 8082 | ✅ `/` → 200 | ✅ running, healthy=True | ✅ :8448 |

Dashboard shows all 5 services:
```
surfsense:   state=running healthy=N/A     port=3929
immich:      state=running healthy=N/A     port=2283
freellmapi:  state=running healthy=True    port=3001
vaultwarden: state=running healthy=True    port=8081
puppygraph:  state=running healthy=True    port=8082
```

Makefile updated with explicit targets for `vaultwarden` and `puppygraph`.

---

## 5. Deviations from plan

1. **Neo4j replaced with PuppyGraph.** Plan §10 specified Neo4j for a separate knowledge graph. User clarified the goal is to visualize SurfSense's PostgreSQL data. PuppyGraph connects to existing PG without modifications.
2. **Vaultwarden ADMIN_TOKEN generation.** Docker container's `/vaultwarden hash` command panics on `/dev/random` access. Used `argon2-cffi` Python library in the venv instead.
3. **PuppyGraph port mapping.** Mapped 8082→8081 (not 8081) to avoid conflict with Vaultwarden's 8081.
4. **PuppyGraph health check.** `/health` returns 404; using `/` (returns 200 HTML) instead.

---

## 6. Next

Phase 6: Backups (`scripts/backup.sh`).
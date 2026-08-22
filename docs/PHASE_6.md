# Phase 6 Log — Operations: Backups

**Started:** 2026-08-20  
**Goal:** `scripts/backup.sh` — per-service backups + full backup. Restore drill.

---

## 1. Backup script

Location: `scripts/backup.sh` (executable)

**Usage:**
```bash
./scripts/backup.sh [service-id]
# Without args: backs up all 5 services
```

**Per-service commands:**

| Service | Method | Output |
|---|---|---|
| SurfSense | `pg_dump` (PostgreSQL) + `docker run --rm -v volume:ro -v backups:/dst alpine tar` (named volumes) | `surfsense-db-*.sql.gz`, `surfsense-*.tgz` |
| Immich | `pg_dump` + `tar` (bind mount `library/`) + volume tar (model-cache) | `immich-db-*.sql.gz`, `immich-library-*.tgz`, `immich-model-cache-*.tgz` |
| FreeLLMAPI | `tar` (bind mount `data/`) | `freellmapi-data-*.tgz` |
| Vaultwarden | `tar` (bind mount `data/`) | `vaultwarden-data-*.tgz` |
| PuppyGraph | `tar` (bind mount `data/`) | `puppygraph-data-*.tgz` |

---

## 2. Verification results

**Backup runs:**

| Service | Files created | Size |
|---|---|---|
| surfsense | db.sql.gz + 4 volumes | 113K + small |
| immich | db.sql.gz + library + model-cache | 18M + 64M + 561M |
| freellmapi | data.tgz | 1.2M |
| vaultwarden | data.tgz | 9K |
| puppygraph | data.tgz | 109B |

**Restore drill (FreeLLMAPI):**
```bash
tar xzf backups/freellmapi-data-2026-08-21.tgz -C restore-test
# Result: freeapi.db (966K), freeapi.db-shm (32K), freeapi.db-wal (4M) — intact
```
✅ Backup is valid, SQLite WAL files included.

---

## 3. Scheduled automation (recommended)

Add a cron or systemd timer:
```bash
# Daily at 02:00
0 2 * * * /home/dak/Desktop/Programs/HomeServer/scripts/backup.sh all
```
Or systemd:
```ini
# deploy/backup.service
[Unit]
Description=Homelab daily backup

[Service]
Type=oneshot
WorkingDirectory=/home/dak/Desktop/Programs/HomeServer
ExecStart=/home/dak/Desktop/Programs/HomeServer/scripts/backup.sh all
```

---

## 4. Deviations

- **Immich model-cache volume:** 561M — large due to ML model weights. Could exclude if space is tight.
- **Root-owned files:** Some SurfSense volumes created by root in container → `docker run alpine tar` extracts as root. Fixed by `--user` or `chown` after restore. Noted for restore drill.

---

## 5. Next

Phase 7: Switchover documentation.
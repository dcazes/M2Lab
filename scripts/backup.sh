#!/usr/bin/env bash
# backup.sh — homelab data backup
# Usage: ./scripts/backup.sh [service-id]
# Without args: backs up all services. With arg: backs up one.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUPS="$ROOT/backups"
DATE="$(date +%F)"
mkdir -p "$BACKUPS"

backup_surfsense() {
    echo "[surfsense] Dumping PostgreSQL..."
    docker exec surfsense-db-1 pg_dump -U surfsense surfsense 2>/dev/null | gzip > "$BACKUPS/surfsense-db-$DATE.sql.gz"
    echo "[surfsense] Backing up named volumes..."
    for vol in surfsense-caddy-config surfsense-caddy-data surfsense-object-store surfsense-opensandbox; do
        docker run --rm -v "${vol}:/src:ro" -v "$BACKUPS:/dst" alpine \
            tar czf "/dst/${vol}-${DATE}.tgz" -C /src . 2>/dev/null
        echo "  → ${vol}-${DATE}.tgz"
    done
    echo "[surfsense] Done."
}

backup_immich() {
    echo "[immich] Dumping PostgreSQL..."
    docker exec immich_postgres pg_dump -U postgres immich 2>/dev/null | gzip > "$BACKUPS/immich-db-$DATE.sql.gz"
    echo "[immich] Backing up library (bind mount)..."
    if [ -d "$ROOT/immich-app/library" ]; then
        tar czf "$BACKUPS/immich-library-$DATE.tgz" -C "$ROOT/immich-app" library 2>/dev/null
        echo "  → immich-library-$DATE.tgz"
    fi
    echo "[immich] Backing up model-cache volume..."
    docker run --rm -v "immich_model-cache:/src:ro" -v "$BACKUPS:/dst" alpine \
        tar czf "/dst/immich-model-cache-${DATE}.tgz" -C /src . 2>/dev/null
    echo "  → immich-model-cache-${DATE}.tgz"
    echo "[immich] Done."
}

backup_freellmapi() {
    echo "[freellmapi] Backing up SQLite database..."
    if [ -d "$ROOT/FreeLLMAPI/data" ]; then
        tar czf "$BACKUPS/freellmapi-data-$DATE.tgz" -C "$ROOT/FreeLLMAPI" data 2>/dev/null
        echo "  → freellmapi-data-$DATE.tgz"
    fi
    echo "[freellmapi] Done."
}

backup_vaultwarden() {
    echo "[vaultwarden] Backing up data directory..."
    if [ -d "$ROOT/vaultwarden/data" ]; then
        tar czf "$BACKUPS/vaultwarden-data-$DATE.tgz" -C "$ROOT/vaultwarden" data 2>/dev/null
        echo "  → vaultwarden-data-$DATE.tgz"
    fi
    echo "[vaultwarden] Done."
}

backup_puppygraph() {
    echo "[puppygraph] Backing up data directory..."
    if [ -d "$ROOT/puppygraph/data" ]; then
        tar czf "$BACKUPS/puppygraph-data-$DATE.tgz" -C "$ROOT/puppygraph" data 2>/dev/null
        echo "  → puppygraph-data-$DATE.tgz"
    fi
    echo "[puppygraph] Done."
}

case "${1:-all}" in
    surfsense)   backup_surfsense ;;
    immich)      backup_immich ;;
    freellmapi)  backup_freellmapi ;;
    vaultwarden) backup_vaultwarden ;;
    puppygraph)  backup_puppygraph ;;
    all)
        backup_surfsense
        backup_immich
        backup_freellmapi
        backup_vaultwarden
        backup_puppygraph
        ;;
    *)
        echo "Unknown service: $1" >&2
        echo "Usage: $0 [surfsense|immich|freellmapi|vaultwarden|puppygraph|all]" >&2
        exit 1
        ;;
esac

echo ""
echo "Backups completed in $BACKUPS/"
ls -lh "$BACKUPS/"*"-$DATE"* 2>/dev/null || echo "(no files)"
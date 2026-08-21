#!/usr/bin/env bash
# backup.sh — homelab data backup (declarative)
# Usage: ./scripts/backup.sh [service-id]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUPS="$ROOT/backups"
DATE="$(date +%F)"
PYTHON="$ROOT/.venv/bin/python3"

# Ensure dependencies
if [ ! -f "$PYTHON" ]; then
    echo "Error: Virtual environment not found at $ROOT/.venv" >&2
    exit 1
fi

"$PYTHON" "$ROOT/scripts/backup.py" "$@"

echo ""
echo "Backups completed in $BACKUPS/"
ls -lh "$BACKUPS/"*"-$DATE"* 2>/dev/null || echo "(no files)"

#!/usr/bin/env bash
set -Eeuo pipefail

readonly OMNILAB_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
FOREGROUND=false
OPEN_BROWSER=true

usage() {
  cat <<'EOF'
Usage: ./start.sh [--foreground] [--no-open]

Start the installed M2Lab dashboard. Application stacks are managed from
the dashboard and are not started automatically.
EOF
}

for argument in "$@"; do
  case "$argument" in
    --foreground) FOREGROUND=true ;;
    --no-open) OPEN_BROWSER=false ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Error: unknown option %s\n' "$argument" >&2; exit 1 ;;
  esac
done

[[ -x "$OMNILAB_ROOT/.venv/bin/python" ]] || { printf 'M2Lab is not installed. Run ./install.sh first.\n' >&2; exit 1; }
[[ -f "$OMNILAB_ROOT/dashboard/dist/index.html" ]] || { printf 'Dashboard bundle missing. Run ./install.sh again.\n' >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker is not installed. Run ./install.sh first.\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf 'Docker is installed, but this login cannot access it. Sign out and back in, then retry.\n' >&2
  exit 1
fi

if "$FOREGROUND"; then
  cd "$OMNILAB_ROOT"
  exec "$OMNILAB_ROOT/.venv/bin/python" -m ctl.app
fi

unit_path="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/homelab-ctl.service"
[[ -f "$unit_path" ]] || { printf 'M2Lab systemd service is missing. Run ./install.sh again.\n' >&2; exit 1; }

systemctl --user daemon-reload
systemctl --user enable homelab-ctl.service homelab-ctl-mcp.service >/dev/null
systemctl --user restart homelab-ctl.service homelab-ctl-mcp.service

dashboard_url="http://127.0.0.1:8787"
ready=false
for _attempt in {1..30}; do
  if curl --silent --fail --output /dev/null "$dashboard_url"; then
    ready=true
    break
  fi
  sleep 1
done

if ! "$ready"; then
  printf 'M2Lab did not become ready. View logs with:\n  journalctl --user -u homelab-ctl -n 100\n' >&2
  exit 1
fi

printf 'M2Lab is ready: %s\n' "$dashboard_url"
printf '  → Open the Onboarding tab for first-time setup and app initialization.\n'
if "$OPEN_BROWSER" && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$dashboard_url" >/dev/null 2>&1 || true
fi

#!/usr/bin/env bash
set -Eeuo pipefail

readonly OMNILAB_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly MIN_PYTHON_MAJOR=3
readonly MIN_PYTHON_MINOR=10

ASSUME_YES=false
DRY_RUN=false
WITH_UPGRADE=false
NO_START=false
WITH_FIREWALL=false

info() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
success() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Prepare a Debian or Ubuntu host and install the M2Lab control plane.

Options:
  --yes             Accept the installation summary without prompting
  --dry-run         Show the planned commands without changing the host
  --with-upgrade    Apply safe operating-system package upgrades
  --with-firewall   Configure UFW (deny incoming; allow OpenSSH and MCP bridges)
  --no-start        Install everything but do not start the dashboard
  -h, --help        Show this help

Tailscale and application stacks are intentionally not installed. Add apps
from the dashboard after the control plane is ready.
EOF
}

run() {
  if "$DRY_RUN"; then
    printf '  + '
    printf '%q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

# docker_sudo: run docker, preferring the user's docker-group membership but
# falling back to sudo when the group is not yet active in this session (e.g.
# right after a fresh Docker install, before a re-login). This lets the
# installer finish without forcing the user to log out and back in.
docker_sudo() {
  if id -nG | tr ' ' '\n' | grep -qx docker; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

for argument in "$@"; do
  case "$argument" in
    --yes) ASSUME_YES=true ;;
    --dry-run) DRY_RUN=true ;;
    --with-upgrade) WITH_UPGRADE=true ;;
    --with-firewall) WITH_FIREWALL=true ;;
    --no-start) NO_START=true ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $argument (run ./install.sh --help)" ;;
  esac
done

[[ $EUID -ne 0 ]] || die "Run this installer as your normal user, not with sudo. It will request sudo only when needed."
[[ "$OMNILAB_ROOT" != *[[:space:]]* ]] || die "The repository path cannot contain whitespace. Move the checkout and try again."
[[ "$OMNILAB_ROOT" != *"|"* ]] || die "The repository path cannot contain a pipe character. Move the checkout and try again."
[[ -f "$OMNILAB_ROOT/services.yaml" && -f "$OMNILAB_ROOT/ansible/bootstrap.yml" ]] || die "Run install.sh from a complete M2Lab checkout."

[[ -r /etc/os-release ]] || die "Cannot identify this operating system. M2Lab supports Debian 12 and Ubuntu 22.04+."
# shellcheck disable=SC1091
source /etc/os-release
docker_distro=""
docker_release=""
case "${ID:-}" in
  debian)
    (( ${VERSION_ID%%.*} >= 12 )) || die "Debian 12 or newer is required."
    docker_distro="debian"
    docker_release="${VERSION_CODENAME:-}"
    ;;
  ubuntu)
    ubuntu_major="${VERSION_ID%%.*}"
    (( ubuntu_major >= 22 )) || die "Ubuntu 22.04 or newer is required."
    docker_distro="ubuntu"
    docker_release="${VERSION_CODENAME:-}"
    ;;
  *)
    if [[ " ${ID_LIKE:-} " == *" ubuntu "* && -n "${UBUNTU_CODENAME:-}" ]]; then
      docker_distro="ubuntu"
      docker_release="$UBUNTU_CODENAME"
      warn "Using Ubuntu compatibility mode for ${PRETTY_NAME:-$ID}."
    elif [[ " ${ID_LIKE:-} " == *" debian "* && -n "${DEBIAN_CODENAME:-}" ]]; then
      docker_distro="debian"
      docker_release="$DEBIAN_CODENAME"
      warn "Using Debian compatibility mode for ${PRETTY_NAME:-$ID}."
    else
      die "Unsupported operating system '${PRETTY_NAME:-unknown}'. M2Lab supports Debian 12, Ubuntu 22.04+, and compatible derivatives."
    fi
    ;;
esac

case "$(uname -m)" in
  x86_64|aarch64|arm64) ;;
  *) die "Unsupported CPU architecture '$(uname -m)'. M2Lab supports x86-64 and ARM64 hosts." ;;
esac
[[ -n "$docker_release" ]] || die "Cannot determine the operating-system codename required for Docker packages."

command -v sudo >/dev/null 2>&1 || die "sudo is required for host preparation."
command -v apt-get >/dev/null 2>&1 || die "apt-get is required on supported hosts."

install_user="$(id -un)"
timezone="$(timedatectl show --property=Timezone --value 2>/dev/null || true)"
timezone="${timezone:-UTC}"

printf '\nM2Lab host installation\n'
printf '  User:       %s\n' "$install_user"
printf '  Repository: %s\n' "$OMNILAB_ROOT"
printf '  Platform:   %s\n' "${PRETTY_NAME:-$ID}"
printf '  Access:     http://127.0.0.1:8787 (local only)\n'
printf '  Services:   selected later in the dashboard\n'
printf '  Tailscale:  not installed\n'
printf '  Firewall:   %s\n' "$WITH_FIREWALL"
printf '  OS upgrade: %s\n\n' "$WITH_UPGRADE"

if ! "$ASSUME_YES" && ! "$DRY_RUN"; then
  read -r -p "Continue? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || { info "Installation cancelled."; exit 0; }
fi

info "Installing host prerequisites"
if "$DRY_RUN"; then
  run sudo apt-get update
  run sudo apt-get install -y ansible ca-certificates curl git gnupg python3 python3-pip python3-venv ufw
else
  sudo -v
  run sudo apt-get update
  run sudo apt-get install -y ansible ca-certificates curl git gnupg python3 python3-pip python3-venv ufw
fi

if ! "$DRY_RUN"; then
  python_version="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  python_major="${python_version%%.*}"
  python_minor="${python_version#*.}"
  (( python_major > MIN_PYTHON_MAJOR || (python_major == MIN_PYTHON_MAJOR && python_minor >= MIN_PYTHON_MINOR) )) || \
    die "Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ is required; found $python_version."
fi

info "Preparing Docker and shared networks"
ansible_args=(
  ansible-playbook
  -i "$OMNILAB_ROOT/ansible/inventory.ini"
  "$OMNILAB_ROOT/ansible/bootstrap.yml"
  --extra-vars
  "homelab_user=$install_user docker_user=$install_user repo_path=$OMNILAB_ROOT timezone=$timezone manage_repository=false enable_tailscale=false enable_firewall=$WITH_FIREWALL perform_system_upgrade=$WITH_UPGRADE docker_distro_slug_override=$docker_distro docker_release_override=$docker_release"
)
run "${ansible_args[@]}"

# Enroll the installing user in the docker group so the dashboard (and the
# user) can talk to the Docker socket. A fresh Docker install leaves the group
# change pending until the next login, which would otherwise break the
# onboarding wizard's socket access. We detect whether the membership is live
# in this session and, if not, fall back to `sudo docker` for the rest of the
# run so setup can complete without a logout.
if ! "$DRY_RUN"; then
  info "Enrolling $install_user in the docker group"
  if ! id -nG | tr ' ' '\n' | grep -qx docker; then
    run sudo usermod -aG docker "$USER"
  fi
  if id -nG | tr ' ' '\n' | grep -qx docker; then
    success "Docker group membership is active in this session"
  else
    warn "Docker group membership is not yet active in this session."
    warn "Run 'newgrp docker' (or log out and back in) before using 'docker' directly."
    warn "This installer will use 'sudo docker' so the rest of setup can finish now."
  fi
  info "Verifying Docker access"
  if ! docker_sudo info >/dev/null 2>&1; then
    die "Docker is installed but the daemon is not reachable. Start Docker (e.g. 'sudo systemctl start docker') and re-run ./install.sh."
  fi
fi

info "Preparing the Python environment"
if [[ ! -x "$OMNILAB_ROOT/.venv/bin/python" ]]; then
  run python3 -m venv "$OMNILAB_ROOT/.venv"
fi
run "$OMNILAB_ROOT/.venv/bin/pip" install --disable-pip-version-check --quiet -r "$OMNILAB_ROOT/ctl/requirements.txt"

if [[ ! -f "$OMNILAB_ROOT/dashboard/dist/index.html" ]]; then
  die "The production dashboard bundle is missing. Re-download the repository or run 'npm ci && npm run build' in dashboard."
fi
success "Production dashboard bundle is present; Node.js is not required on this host"

info "Preparing local control-plane credentials"
if "$DRY_RUN"; then
  printf '  + ensure CTL_MCP_TOKEN exists in %q without displaying it\n' "$OMNILAB_ROOT/.env"
else
  umask 077
  touch "$OMNILAB_ROOT/.env"
  chmod 600 "$OMNILAB_ROOT/.env"
  if ! grep -q '^CTL_MCP_TOKEN=.' "$OMNILAB_ROOT/.env"; then
    token="$($OMNILAB_ROOT/.venv/bin/python -c 'import secrets; print(secrets.token_hex(32))')"
    printf '\nCTL_MCP_TOKEN=%s\n' "$token" >> "$OMNILAB_ROOT/.env"
    unset token
  fi
fi

info "Installing systemd user services"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
if "$DRY_RUN"; then
  printf '  + render deploy/*.service into %q for %q\n' "$unit_dir" "$OMNILAB_ROOT"
else
  mkdir -p "$unit_dir"
  escaped_root="${OMNILAB_ROOT//&/\\&}"
  for unit in homelab-ctl.service homelab-ctl-mcp.service homelab-app-mcp@.service; do
    sed "s|@OMNILAB_ROOT@|$escaped_root|g" "$OMNILAB_ROOT/deploy/$unit" > "$unit_dir/$unit"
    chmod 644 "$unit_dir/$unit"
  done
fi

run sudo loginctl enable-linger "$install_user"
run systemctl --user daemon-reload
run systemctl --user enable homelab-ctl.service homelab-ctl-mcp.service

if ! "$NO_START"; then
  info "Starting M2Lab"
  run systemctl --user restart homelab-ctl.service homelab-ctl-mcp.service
fi

if "$DRY_RUN"; then
  success "Dry run complete; no changes were made"
  exit 0
fi

printf '\n'
success "M2Lab is installed"
printf '  Dashboard:   http://127.0.0.1:8787\n'
printf '  Start later: %s/start.sh\n' "$OMNILAB_ROOT"
printf '  Logs:        journalctl --user -u homelab-ctl -f\n'

if ! docker_sudo info >/dev/null 2>&1; then
  warn "Your current login does not yet have Docker access. Run 'newgrp docker' (or log out and back in), then run ./start.sh."
fi

printf '\nNext step: Open the dashboard in your browser to complete first-time setup:\n'
printf '  → http://127.0.0.1:8787 (Click the "Onboarding" tab)\n\n'

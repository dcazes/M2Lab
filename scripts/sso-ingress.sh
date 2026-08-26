#!/usr/bin/env bash
# Safely stage one existing Tailscale Serve listener through Caddy.
# Usage: scripts/sso-ingress.sh status|apply|rollback <service-id>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 status|apply|rollback <service-id>" >&2
  exit 2
fi

action=$1
service=$2
case "$service" in
  dashboard) tailnet_port=8460; target_port=19460; direct_port=8787 ;;
  authentik) tailnet_port=8462; target_port=19062; direct_port=9001 ;;
  open-webui) tailnet_port=8456; target_port=19456; direct_port=8084 ;;
  immich) tailnet_port=8443; target_port=19443; direct_port=2283 ;;
  paperless-ngx) tailnet_port=8451; target_port=19451; direct_port=8010 ;;
  mealie) tailnet_port=8455; target_port=19455; direct_port=9000 ;;
  adventurelog) tailnet_port=8454; target_port=19454; direct_port=8015 ;;
  nextcloud) tailnet_port=8453; target_port=19453; direct_port=8020 ;;
  actual-budget) tailnet_port=8452; target_port=19452; direct_port=5006 ;;
  beszel) tailnet_port=8450; target_port=19450; direct_port=8090 ;;
  puppygraph) tailnet_port=8448; target_port=19448; direct_port=8082 ;;
  vaultwarden) tailnet_port=8446; target_port=19446; direct_port=8081 ;;
  portainer) tailnet_port=9090; target_port=19090; direct_port=9090 ;;
  surfsense) tailnet_port=8444; target_port=19444; direct_port=3929 ;;
  litellm) tailnet_port=8445; target_port=19445; direct_port=4000 ;;
  firecrawl) tailnet_port=8458; target_port=19458; direct_port=3002 ;;
  freellmapi) tailnet_port=8459; target_port=19459; direct_port=3001 ;;
  *) echo "Unsupported SSO ingress service: $service" >&2; exit 2 ;;
esac

case "$action" in
  status)
    tailscale serve status
    ;;
  apply)
    echo "Routing tailnet :$tailnet_port to Caddy at 127.0.0.1:$target_port."
    echo "Keep this terminal open and test in a second tailnet browser before continuing."
    sudo tailscale serve --bg --https="$tailnet_port" "http://127.0.0.1:$target_port"
    ;;
  rollback)
    echo "Restoring tailnet :$tailnet_port directly to 127.0.0.1:$direct_port."
    sudo tailscale serve --bg --https="$tailnet_port" "http://127.0.0.1:$direct_port"
    ;;
  *) echo "Unknown action: $action" >&2; exit 2 ;;
esac

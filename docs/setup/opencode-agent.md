# OpenCode Agent Setup

Self-hosted autonomous coding agent designed to monitor, document, and edit this homelab stack safely.

## Prerequisites
- Node.js/Python (run natively via systemd service on host)
- Port 4096 access
- Systemd integration on host

## Architecture
The OpenCode Agent runs natively as a systemd service (`opencode-agent.service`) for fast file system access and system operation. It is integrated into the M2Lab control plane dashboard as a registered service.

## Configuration

### 1. No `.env` required for basic usage
Runs natively via environment variables configured in systemd unit or host environment.

### 2. Native Systemd Service
The agent is managed by systemd. To start/restart/stop:
```bash
# Manage on host
systemctl --user start opencode-agent.service
systemctl --user restart opencode-agent.service
systemctl --user stop opencode-agent.service
```

## Service Access
- **Local:** http://localhost:4096
- **Tailscale:** https://home.taile2cc7a.ts.net:8461

## Backup
```bash
./scripts/backup.sh opencode-agent
```
Backs up: `opencode-agent_opencode-data` volume.

## AI Routing Integration
OpenCode Agent uses **LiteLLM** for all model operations, allowing it to leverage free model groups (via FreeLLMAPI), paid APIs, and local fallback models (such as Llama 3) seamlessly.

## Notes
- Has full write permissions to the repository to apply updates, bug fixes, and documentation edits.
- Standard logs are kept under systemd journal.
- Dashboard card keeps status checked and tracked.
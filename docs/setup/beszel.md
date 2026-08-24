# Beszel Setup

Server monitoring (hub + agent) for infrastructure observability.

## Prerequisites
- SQLite database (file-based, included)
- Agent containers on target hosts (optional)

## Configuration

### 1. Copy environment template
```bash
cp beszel/.env.example beszel/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `BESZEL_HUB_PORT` | Hub port (default: 8090) | No |
| `BESZEL_HUB_KEY` | Agent registration key (openssl rand -hex 32) | Yes* |

*Required if using agents

### 3. Add agents (optional)
On each target host:
```bash
docker run -d --name beszel-agent \
  -e KEY=your_hub_key \
  -e HUB_URL=http://your-hub:8090 \
  --restart unless-stopped \
  henrygd/beszel-agent
```

## Service Access
- **Local:** http://localhost:8090
- **Tailscale:** https://home.taile2cc7a.ts.net:8450

## Backup
```bash
./scripts/backup.sh beszel
```
Backs up: `beszel_data` bind mount.

## Dependencies
- None (standalone)

## Notes
- Data stored in `beszel/beszel_data/` and `beszel/beszel_agent_data/` (gitignored)
- Uses frontend-net only
- `beszel-agent` container ignored in status checks
- Lightweight alternative to Prometheus/Grafana
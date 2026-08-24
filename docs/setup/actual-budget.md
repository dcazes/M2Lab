# Actual Budget Setup

Local-first budgeting application with multi-device sync.

## Prerequisites
- Node.js runtime (included in container)
- File-based storage (no separate database)

## Configuration

### 1. Copy environment template
```bash
cp actual-budget/.env.example actual-budget/.env
```

### 2. Optional variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 5006) | No |
| `NODE_ENV` | Environment (production) | No |

No database credentials needed — uses local file storage in `server-files/`.

## Service Access
- **Local:** http://localhost:5006
- **Tailscale:** https://home.taile2cc7a.ts.net:8452

## Backup
```bash
./scripts/backup.sh actual-budget
```
Backs up: `server-files/` bind mount.

## Notes
- Data stored in `actual-budget/server-files/` (gitignored)
- Uses frontend-net only
- First run creates user via web UI
- Sync across devices via self-hosted instance
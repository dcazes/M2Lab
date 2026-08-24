# PuppyGraph Setup

Graph visualizer for SurfSense PostgreSQL — explores knowledge graph relationships.

## Prerequisites
- SurfSense PostgreSQL database (must be running)
- Shared network access to SurfSense DB

## Configuration

### 1. Copy environment template
```bash
cp puppygraph/.env.example puppygraph/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `SURFSENSE_DB_HOST` | SurfSense PostgreSQL host | Yes |
| `SURFSENSE_DB_PORT` | SurfSense PostgreSQL port (5432) | Yes |
| `SURFSENSE_DB_NAME` | SurfSense database name | Yes |
| `SURFSENSE_DB_USER` | SurfSense database user | Yes |
| `SURFSENSE_DB_PASSWORD` | SurfSense database password | Yes |

### 3. Connect to SurfSense DB
PuppyGraph reads directly from SurfSense's PostgreSQL. Ensure both services share `backend-net` network.

## Service Access
- **Local:** http://localhost:8082
- **Tailscale:** https://home.taile2cc7a.ts.net:8448

## Backup
```bash
./scripts/backup.sh puppygraph
```
Backs up: data bind mount.

## Dependencies
- `surfsense-db` (PostgreSQL) — must be healthy first

## Notes
- Data stored in `puppygraph/data/` (gitignored)
- Read-only access to SurfSense database recommended
- No separate database — visualizes existing SurfSense data
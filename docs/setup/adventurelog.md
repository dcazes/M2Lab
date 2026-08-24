# AdventureLog Setup

Travel tracker & trip planner with maps, photos, and offline support.

## Prerequisites
- PostgreSQL database (included)
- Redis for caching

## Configuration

### 1. Copy environment template
```bash
cp adventurelog/.env.example adventurelog/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `POSTGRES_PASSWORD` | Database password | Yes |
| `REDIS_PASSWORD` | Redis password | Yes |
| `SECRET_KEY_BASE` | Phoenix secret (mix phx.gen.secret) | Yes |
| `MAPBOX_TOKEN` | Mapbox access token for maps | No |

## Service Access
- **Local:** http://localhost:8015
- **Tailscale:** https://home.taile2cc7a.ts.net:8454

## Backup
```bash
./scripts/backup.sh adventurelog
```
Backs up: PostgreSQL dump, media bind mount.

## Dependencies
- `adventurelog-db` (PostgreSQL)
- `redis` (shared or dedicated)

## Notes
- Media stored in `adventurelog/media/` (gitignored)
- PostgreSQL in `adventurelog/pgdata/` (gitignored)
- Uses both frontend-net and backend-net
- `db` container ignored in status checks
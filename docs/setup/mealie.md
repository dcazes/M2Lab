# Mealie Setup

Recipe manager with meal planning, shopping lists, and recipe import.

## Prerequisites
- PostgreSQL database (included)
- Redis for caching/background tasks

## Configuration

### 1. Copy environment template
```bash
cp mealie/.env.example mealie/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `POSTGRES_PASSWORD` | Database password | Yes |
| `REDIS_PASSWORD` | Redis password | Yes |
| `SECRET_KEY` | Django secret (openssl rand -hex 32) | Yes |
| `ALLOWED_HOSTS` | Comma-separated hosts | Yes |

### 3. Default admin
First run creates admin via web UI at `/auth/login`.

## Service Access
- **Local:** http://localhost:9000
- **Tailscale:** https://home.taile2cc7a.ts.net:8455

## Backup
```bash
./scripts/backup.sh mealie
```
Backs up: data bind mount.

## Dependencies
- `mealie-db` (PostgreSQL)
- `mealie-redis` (Redis)

## Notes
- Data stored in `mealie/data/` (gitignored)
- Uses both frontend-net and backend-net
- Recipe import from URLs, files, and other formats supported
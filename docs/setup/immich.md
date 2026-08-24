# Immich Setup

Self-hosted photo and video library with AI-powered search and organization.

## Prerequisites
- Significant storage for media library
- PostgreSQL database (included)
- Redis for caching
- GPU optional for ML features (face detection, smart search)

## Configuration

### 1. Copy environment template
```bash
cp immich-app/.env.example immich-app/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `DB_PASSWORD` | PostgreSQL password | Yes |
| `REDIS_PASSWORD` | Redis password | Yes |
| `JWT_SECRET` | 32+ char secret for auth tokens | Yes |
| `UPLOAD_LOCATION` | Library path (default: ./library) | Yes |
| `MACHINE_LEARNING_ENABLED` | Enable AI features (true/false) | No |

### 3. GPU Support (optional)
```bash
# Uses docker-compose.gpu.yml overlay if available
make up SERVICE=immich
```

## Service Access
- **Local:** http://localhost:2283
- **Tailscale:** https://home.taile2cc7a.ts.net:8443

## Backup
```bash
./scripts/backup.sh immich
```
Backs up: PostgreSQL dump, model cache volume, library bind mount.

## Dependencies
- `immich_postgres` (PostgreSQL)
- `immich_redis` (Redis)
- `immich_machine_learning` (AI features - optional)

## Notes
- Library stored in `immich-app/library/` (gitignored)
- PostgreSQL data in `immich-app/postgres/` (gitignored)
- First run creates admin user via web UI
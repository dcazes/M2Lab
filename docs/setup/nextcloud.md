# Nextcloud Setup

Files & sync platform with collaboration, calendar, contacts, and apps.

## Prerequisites
- PostgreSQL database (included)
- Redis for caching/locking
- Significant storage for user files

## Configuration

### 1. Copy environment template
```bash
cp nextcloud/.env.example nextcloud/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `POSTGRES_PASSWORD` | Database password | Yes |
| `REDIS_PASSWORD` | Redis password | Yes |
| `NEXTCLOUD_ADMIN_USER` | Initial admin username | Yes |
| `NEXTCLOUD_ADMIN_PASSWORD` | Initial admin password | Yes |
| `NEXTCLOUD_TRUSTED_DOMAINS` | Comma-separated domains | Yes |

### 3. Trusted domains
Must include your Tailscale domain:
```
NEXTCLOUD_TRUSTED_DOMAINS=localhost,home.taile2cc7a.ts.net
```

## Service Access
- **Local:** http://localhost:8020
- **Tailscale:** https://home.taile2cc7a.ts.net:8453

## Backup
```bash
./scripts/backup.sh nextcloud
```
Backs up: PostgreSQL dump, html/data bind mounts.

## Dependencies
- `nextcloud-db` (PostgreSQL)
- `nextcloud-redis` (Redis)

## Notes
- Data in `nextcloud/data/`, `html/` (gitignored)
- PostgreSQL in `nextcloud/pgdata/` (gitignored)
- Uses both frontend-net and backend-net
- `cron` and `redis` containers ignored in status checks
- Enable HTTPS via Tailscale for production
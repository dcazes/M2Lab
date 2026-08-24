# Paperless-ngx Setup

Document archive with OCR, full-text search, and automatic tagging.

## Prerequisites
- PostgreSQL database (included)
- Redis for task queue
- Tika/Gotenberg for document processing
- Significant storage for documents

## Configuration

### 1. Copy environment template
```bash
cp paperless-ngx/.env.example paperless-ngx/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `POSTGRES_PASSWORD` | Database password | Yes |
| `REDIS_PASSWORD` | Redis password | Yes |
| `PAPERLESS_SECRET_KEY` | Django secret (openssl rand -hex 32) | Yes |
| `PAPERLESS_CONSUMPTION_DIR` | Watch folder (default: /consume) | No |
| `PAPERLESS_OCR_LANGUAGES` | OCR languages (e.g., eng, deu) | No |

### 3. Consumption folder
Drop PDFs/images in `paperless-ngx/consume/` for auto-import.

## Service Access
- **Local:** http://localhost:8010
- **Tailscale:** https://home.taile2cc7a.ts.net:8451

## Backup
```bash
./scripts/backup.sh paperless-ngx
```
Backs up: PostgreSQL dump, data/media/export bind mounts.

## Dependencies
- `paperless-db` (PostgreSQL)
- `paperless-redis` (Redis)
- `paperless-tika` (Document extraction)
- `paperless-gotenberg` (Office → PDF conversion)

## Notes
- Data in `paperless-ngx/data/`, `media/`, `export/`, `consume/` (gitignored)
- PostgreSQL in `paperless-ngx/pgdata/` (gitignored)
- Uses both frontend-net and backend-net
- OCR runs automatically on import
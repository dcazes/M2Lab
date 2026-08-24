# Firecrawl Setup

Web scraping and crawling API that turns entire websites into clean markdown or structured data for LLMs.

## Prerequisites
- Redis for queue management
- PostgreSQL database (included)
- RabbitMQ for message queue
- Playwright service for JavaScript rendering

## Configuration

### 1. Copy environment template
```bash
cp firecrawl/.env.example firecrawl/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | API port (default: 3002) | No |
| `REDIS_URL` | Redis connection string | Yes |
| `POSTGRES_URL` | PostgreSQL connection string | Yes |
| `USE_DB_CRAWL` | Store crawls in DB (true/false) | No |

## Service Access
- **Local:** http://localhost:3002
- **Tailscale:** https://home.taile2cc7a.ts.net:8458

## Backup
```bash
./scripts/backup.sh firecrawl
```
Backs up: data bind mount.

## Dependencies
- `firecrawl-redis` (Redis)
- `firecrawl-rabbitmq` (RabbitMQ)
- `firecrawl-playwright-service` (Browser rendering)
- `firecrawl-nuq-postgres` (PostgreSQL)

## Notes
- Data stored in `firecrawl/data/` (gitignored)
- Uses both frontend-net and backend-net
- Provides API endpoints for scraping web pages into LLM-ready markdown or JSON
- Integrated into SurfSense / research workflows
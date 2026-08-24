# SurfSense Setup

AI research / knowledge base with web crawling, document processing, and graph visualization.

## Prerequisites
- GPU recommended for ML workloads
- PostgreSQL database (included in compose)
- Redis for caching
- SEARXNG for web search

## Configuration

### 1. Copy environment template
```bash
cp surfsense/.env.example surfsense/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `POSTGRES_PASSWORD` | Database password | Yes |
| `REDIS_PASSWORD` | Redis password | Yes |
| `SEARXNG_SECRET_KEY` | SEARXNG instance secret | Yes |
| `OPENAI_API_KEY` | For embeddings (or use local) | Yes* |
| `ENCRYPTION_KEY` | 64-char hex for data encryption | Yes |

*Can use FreeLLMAPI/LiteLLM instead of direct OpenAI key.

### 3. GPU Support (optional)
```bash
# Uses docker-compose.gpu.yml overlay
make up SERVICE=surfsense
```

## Service Access
- **Local:** http://localhost:3929
- **Tailscale:** https://home.taile2cc7a.ts.net:8444

## Backup
```bash
./scripts/backup.sh surfsense
```
Backs up: PostgreSQL dump, Caddy config/data, object store, opensandbox data.

## Dependencies
- `surfsense-db` (PostgreSQL)
- `surfsense-redis` (Redis)
- `surfsense-searxng` (Search)
- `surfsense-opensandbox-server` (Code execution)
- `surfsense-zero-cache` (Embedding cache)

## Notes
- Ignores `migrations` container in status checks
- Uses both frontend-net and backend-net networks
- GPU overlay available for ML acceleration
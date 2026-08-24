# LiteLLM Setup

LLM gateway / model router (OpenAI-compatible) with FreeLLMAPI integration for free model routing and paid key fallback.

## Prerequisites
- PostgreSQL database (included)
- FreeLLMAPI running on host:3001
- Ollama running on host:11434 (for local fallback)
- Master key for admin API protection

## Architecture
```
FreeLLMAPI (port 3001) → LiteLLM (port 4000) → Ollama (port 11434)
     │                        │                     │
  Free models             Router & fallback      Local models
  (auto-detect)          (paid keys here)       (llama3.2, etc.)
```

## Configuration

### 1. Copy environment template
```bash
cp litellm/.env.example litellm/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `LITELLM_MASTER_KEY` | Admin API key (openssl rand -hex 32) | Yes |
| `FREE_LLMAPI_API_KEY` | Key for FreeLLMAPI gateway | Yes |
| `POSTGRES_PASSWORD` | PostgreSQL password | Yes |
| `DATABASE_URL` | Postgres connection string | Yes |

### 3. Configure model routing
Edit `litellm/litellm_config.yaml`:
- `free-auto` → routes to FreeLLMAPI (free models)
- `ollama/*` → routes to local Ollama
- `local-fallback` → explicit local model fallback

Paid API keys (OpenAI, Anthropic, etc.) go in **LiteLLM only**, not FreeLLMAPI.

## Service Access
- **Local:** http://localhost:4000
- **Admin UI:** http://localhost:4000/ui
- **Tailscale:** https://home.taile2cc7a.ts.net:8445/ui

## Backup
```bash
./scripts/backup.sh litellm
```

## AI Routing Chain
All AI services (Open WebUI, OpenCode Agent, etc.) should point to **LiteLLM at `http://host.docker.internal:4000`** with the `LITELLM_MASTER_KEY` as the API key.

This gives:
1. Free model auto-detection via FreeLLMAPI
2. Paid model access via LiteLLM keys
3. Local Ollama fallback
4. Centralized routing, logging, budgets

## Notes
- Database: `litellm-db` (PostgreSQL on backend-net)
- `openapi.snapshot.json` must be refreshed after LiteLLM upgrades
- MCP admin tools exposed at `/litellm_admin/mcp`
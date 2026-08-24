# Open WebUI Setup

Self-hosted AI chat interface with agents, RAG, and multi-model support.

## Prerequisites
- LiteLLM gateway running on port 4000 (recommended) OR Ollama
- Backend connection to LLM provider

## Configuration

### 1. Copy environment template
```bash
cp open-webui/.env.example open-webui/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `WEBUI_SECRET_KEY` | Secret key for auth (openssl rand -hex 32) | Yes |
| `OPENAI_API_BASE_URL` | LLM API base (point to LiteLLM: http://host.docker.internal:4000/v1) | Yes |
| `OPENAI_API_KEY` | LiteLLM master key | Yes |

### 3. Point to LiteLLM (Recommended)
Set `OPENAI_API_BASE_URL=http://host.docker.internal:4000/v1` and `OPENAI_API_KEY=your_litellm_master_key` to route all chat requests through LiteLLM (FreeLLMAPI free models + paid fallback + Ollama).

## Service Access
- **Local:** http://localhost:8084
- **Tailscale:** https://home.taile2cc7a.ts.net:8456

## Backup
```bash
./scripts/backup.sh open-webui
```
Backs up: data bind mount.

## Notes
- Data stored in `open-webui/data/` (gitignored)
- Uses both frontend-net and backend-net
- First run creates admin user
- Supports RAG, documents, web search, custom agents, and multiple LLM backends via LiteLLM
# FreeLLMAPI Setup

Free-LLM aggregator and router (OpenAI-compatible) providing free access to multiple LLM providers with automatic load-balancing, ordering, and failover.

## Prerequisites
- SQLite database (file-based, included)
- Shared frontend-net network

## Configuration

### 1. Copy environment template
```bash
cp FreeLLMAPI/.env.example FreeLLMAPI/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `ENCRYPTION_KEY` | 64-char hex key for secure storage | Yes |
| `PORT` | API port (default: 3001) | No |

### 3. Add Free API Keys
Configure free tiers or rate-limited API keys for providers (such as Gemini, Groq, Cohere, TogetherAI, etc.) inside FreeLLMAPI's dashboard or database. 

**Rule:** Do NOT put paid keys in FreeLLMAPI. Paid keys should go in **LiteLLM only** for billing and precise spend tracking.

## Service Access
- **Local:** http://localhost:3001
- **Tailscale:** https://home.taile2cc7a.ts.net:8459

## Backup
```bash
./scripts/backup.sh freellmapi
```
Backs up: `data/` bind mount containing provider configs and logs.

## Integration with LiteLLM
FreeLLMAPI is exposed to LiteLLM as the `free-auto` model. This allows automatic model detection, load balancing, and failover for free model queries before falling back to local or paid models.

In `litellm/litellm_config.yaml`:
```yaml
model_list:
  - model_name: free-auto
    litellm_params:
      model: openai/auto
      api_base: http://host.docker.internal:3001/v1
      api_key: os.environ/FREE_LLMAPI_API_KEY
```

## Notes
- Single-user access by default. Keep host binding restricted to localhost/Tailscale.
- Data stored in `FreeLLMAPI/data/` (gitignored).
- Handles API endpoint failover transparently.
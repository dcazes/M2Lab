# Ollama Setup

Local LLM runner with GPU acceleration for running models privately.

## Prerequisites
- NVIDIA GPU with CUDA (for GPU acceleration)
- Sufficient VRAM/RAM for models
- Model storage space

## Configuration

### 1. Copy environment template
```bash
cp ollama/.env.example ollama/.env
```

### 2. Optional variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `OLLAMA_HOST` | Bind address (default: 0.0.0.0) | No |
| `OLLAMA_MODELS` | Model storage path (default: /root/.ollama) | No |

### 3. GPU Support
```bash
# Uses docker-compose.gpu.yml overlay
make up SERVICE=ollama
```

## Service Access
- **Local:** http://localhost:11434
- **Tailscale:** https://home.taile2cc7a.ts.net:8457

## Backup
```bash
./scripts/backup.sh ollama
```
Backs up: model data bind mount.

## Pull Models
```bash
# From host
curl -X POST http://localhost:11434/api/pull -d '{"name": "llama3.2"}'
curl -X POST http://localhost:11434/api/pull -d '{"name": "qwen2.5"}'
curl -X POST http://localhost:11434/api/pull -d '{"name": "mistral"}'
```

## AI Routing Integration
Ollama is the **local fallback** for LiteLLM. Configure in `litellm/litellm_config.yaml`:
```yaml
- model_name: "ollama/*"
  litellm_params:
    model: "ollama/*"
    api_base: http://host.docker.internal:11434
```

## Notes
- Model data in `ollama/data/` (gitignored)
- Uses both frontend-net and backend-net
- GPU overlay requires NVIDIA Container Toolkit
- Accessible via `host.docker.internal:11434` from other containers
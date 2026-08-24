# AI Routing Architecture & Flow

OmniLab implements a centralized, resilient AI routing architecture that separates **free provider aggregations**, **paid API billing/budgets**, and **local GPU execution**.

---

## 📐 The Routing Pipeline

```
[ AI Consumers ] 
  (Open WebUI, SurfSense, OpenCode Agent, etc.)
        │
        ▼ (OpenAI-Compatible /v1 API)
  [ LiteLLM Gateway ] (Port 4000)
        │
        ├─► 1. Free Tier (`free-auto`) ──► FreeLLMAPI (Port 3001) ──► Free Cloud Providers
        │                                                               (Gemini, Groq, etc.)
        │
        ├─► 2. Local Fallback (`ollama/*`) ──► Ollama (Port 11434) ──► Local GPU Models
        │                                                               (Llama 3.2, Qwen 2.5)
        │
        └─► 3. Paid Providers (Direct API) ──► Paid Keys (OpenAI, Anthropic, etc.)
```

---

## 🔑 Key Principles

### 1. Free vs. Paid Separation
- **FreeLLMAPI (`port 3001`)**: Handles free-tier provider aggregations, rate limits, and auto-rotation. **Never put paid API keys here.**
- **LiteLLM (`port 4000`)**: Acts as the master gateway. It routes free requests to FreeLLMAPI (`free-auto`), local queries to Ollama, and paid provider requests (OpenAI, Anthropic, DeepSeek, etc.) using keys stored strictly in `litellm/.env`.

### 2. Centralized AI Consumption
All applications in OmniLab (Open WebUI, SurfSense, OpenCode Agent) point to **LiteLLM (`http://host.docker.internal:4000/v1`)** using the `LITELLM_MASTER_KEY`. This ensures:
- **Unified Logging & Budgets:** Track spend and rate limits across all agents in one place.
- **Automatic Fallbacks:** If free cloud providers fail or rate-limit, LiteLLM automatically falls back to local Ollama (`local-fallback`).

---

## 🛠️ Configuration Quick Reference

### FreeLLMAPI (`FreeLLMAPI/.env`)
```env
ENCRYPTION_KEY=your_64_char_hex_key
PORT=3001
```

### LiteLLM (`litellm/.env`)
```env
LITELLM_MASTER_KEY=your_master_key
FREE_LLMAPI_API_KEY=your_freellmapi_key
LITELLM_MCP_KEY=your_mcp_bearer_token
POSTGRES_PASSWORD=your_db_password
DATABASE_URL=postgresql://litellm:password@litellm-db:5432/litellm

# Paid keys go here ONLY:
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
```

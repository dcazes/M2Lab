## 9. Decision record (2026-08-23)

**Always-on runtime chosen:** headless OpenCode container (opencode-agent service) instead of LangGraph router for phase 1.

**Rationale:**
- Native subagents with per-agent permissions/skills/MCP, provider-agnostic via LiteLLM (Ollama default), MIT license.
- Satisfies all six hard requirements: self-hosted Docker (no SaaS), subagents with own tools, MCP maturity, ability to edit the stack (FS+shell+docker), runs on local LLMs, persistent/headless service.
- The agent system is fully contained inside the stack: image digest-pinned, config committed in repo, models via in-stack LiteLLM→Ollama, no external dependencies.

**Caveats recorded:**
- Headless permission mode "ask" hangs forever — use allow/deny only (see agent permission matrices).
- Lifecycle goes through host-run `homelab-ctl-mcp` (systemd unit importing `ctl/registry.py`), not a containerized MCP (would need docker.sock).
- The agent `opencode-agent` is a denied sid for mutating verbs in `homelab-ctl-mcp` (self-lockout protection).
- Secrets (`.env` files) are physically hidden from the agent container via `/dev/null` overmounts (agent uid 1000 cannot read them).
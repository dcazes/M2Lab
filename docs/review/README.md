# Homelab Stack Review — Documentation Index

This directory holds the review of the HomeServer homelab: what runs, how it is
configured, where it is weak, and a grounded proposal for an AI agent layer
(MCP-per-service + subagents + intent-routing master).

## Reading order

| # | Document | Status | Contents |
|---|----------|--------|----------|
| 01 | `01-stack-index.md` | ⏳ pending (exp-1) | Exhaustive inventory of all 16 services: images, ports, networks, volumes, secrets handling, hardening, backups, control plane. |
| 02 | `02-critique.md` | ⏳ pending (exp-1) | Findings on setup, networking, and security with severity ratings and concrete fixes. |
| 03 | `03-ai-agent-architecture.md` | 📝 draft from research | MCP-per-service + subagent + master-router design, grounded in current tooling. Actionable build plan. |
| 04 | `04-research-notes.md` | ✅ complete | Raw grounded web research: existing MCP servers, OpenAPI→MCP autogen, orchestration patterns, security, precedents. Source of truth for §03. |
| 05–06 | `05-dashboard-react-rewrite-plan.md`, `06-subagent-fleet-plan.md` | 📝 working plans | Dashboard implementation and service-focused agent-fleet planning. |
| 07 | `07-product-plan.md` | ✅ proposed direction | Product thesis, first-run catalog, harness-agnostic MCP gateway, policy model, initial app catalog, and staged workflows. |

## How to search this set

All docs are plain Markdown in git — greppable across the repo:

```bash
rg -n "portainer" docs/review/
rg -n "read.?only" docs/review/04-research-notes.md
rg -n "CVE" docs/review/
```

## Scope & conventions

- **No secrets in docs.** Inventory records *that* a credential exists and *where*
  (path), never the value. `.env` contents stay out of git.
- **Dates** reflect the review date (2026-08-22). MCP/server versions in §04 are
  research snapshots — re-verify at implementation time.
- **Confidence** is called out per recommendation in §04 and §03.
- Source of truth for the running stack remains `services.yaml`; this review is a
  layer on top of it.

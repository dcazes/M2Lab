---
name: litellm-model-catalog
description: Summarize LiteLLM models, routing, keys, budgets and spend using the read-only litellm MCP tools
---

## What I do

- List configured models and identify which upstream each routes to
  (FreeLLMAPI vs Ollama vs fallback).
- Read API-key metadata, budgets, and recent spend (read-only).
- Explain routing/fallback behavior for a named model.

## When to use

Use when the user asks things like "what models do I have", "how is X routed",
"show my keys/budgets/spend", or before recommending which model an agent
should use.

## How

Use ONLY the litellm MCP server's GET-derived tools. Never attempt mutations;
they are not exposed. Report numbers exactly as returned; do not estimate.
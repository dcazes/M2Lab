## Description

<!-- What does this PR change, and why? Link any related issues. -->

## Test plan

<!-- How did you verify this works? -->

- [ ] `python3 -m unittest discover -s tests -v` passes (or N/A)
- [ ] `cd dashboard && npm run build` succeeds (or N/A)
- [ ] `cd <service-dir> && docker compose [-f overlay.yml] config -q` is valid for touched stacks (or N/A)
- [ ] `yamllint .` passes on changed YAML (or N/A)

## Verification checklist

- [ ] Unit tests / catalog tests updated where relevant
- [ ] Dashboard production build verified (if UI changed)
- [ ] Compose configuration validated (if a service changed)
- [ ] **Security note:** if this PR changes anything agent-facing (MCP tools, capabilities, approvals, or exposed surfaces), describe the impact below and confirm it stays within the documented risk tiers.

<!-- Security note (required for agent-facing changes): -->

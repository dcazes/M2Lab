---
name: verify-stack
description: Run the core verification commands for the homelab stack
---

Use this skill to validate that your changes are safe and correct before declaring work done.

**Verification commands:**
- `yamllint .` — checks all YAML files (docker-compose.yml, services.yaml, etc.) for syntax and style.
- `gitleaks detect --no-banner` — scans for accidental secrets or credentials leaked into tracked files.
- For a specific service: `cd <service-dir> && docker compose [-f overlay.yml] config -q` — validates that the compose configuration is syntactically correct and overlay files are applied.
- `python3 ctl/registry.py status` — after `make up SERVICE=<id>`, confirms that all containers for a service are running.

**When to use which:**
- Run `yamllint .` and `gitleaks detect --no-banner` **before every commit** as a hygiene gate.
- Run the compose config check **after editing any docker-compose.yml or overrides** (e.g. docker-compose.gpu.yml) but before `make up`.
- Run `python3 ctl/registry.py status` **after `make up SERVICE=<id>` or `make restart SERVICE=<id>`** to verify the service came up healthy.
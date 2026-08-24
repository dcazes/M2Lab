# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| 0.1.x   | :white_check_mark: |

## Scope & Trust Boundary

This repository is an **operations repo** for a self-hosted Docker Compose homelab. It does not ship application source code; it manages container lifecycles and stores configuration for ~17 services.

Two areas deserve extra care:

- **Docker control plane:** The `ctl/` helper and `Makefile` invoke `docker compose` (and, on the host, the Docker socket) to start, stop, back up, and destroy stacks. Anyone with write access to this repo — or to the deployed control dashboard — can affect containers on the host.
- **Secrets:** Service credentials live in gitignored `.env` files (root `.env` plus per-service `.env`). They must never be committed. CI runs Gitleaks on every push/PR to catch leaks.

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Please report privately using one of:

1. **GitHub Security Advisories** — use *Report a vulnerability* in the repo's Security tab.
2. **Email** — send details to **security@cazes.me**.

Include:

1. Steps to reproduce the vulnerability.
2. The attack vector (e.g., leaked secret in a compose file, over-permissive volume mount, exposed port).
3. Suggested remediation, if known.

You can expect an acknowledgement within a few days. Once resolved, we will coordinate disclosure.

# Contributing

Thanks for helping improve the homelab! This is an **operations repo**: it contains Docker Compose stacks, configuration, and control-plane tooling — not application source code.

## Before you start

- Read [AGENTS.md](AGENTS.md) — it documents the repo's conventions, the `services.yaml` source of truth, the `ctl/` control plane, and how verification works (there is no test suite).
- Open issues via the templates in [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE). Use the **App Integration Request** template to propose a new service.

## Adding or changing a service

1. Follow [docs/ADDING_APPS.md](docs/ADDING_APPS.md) and start from [docs/compose-template.yml](docs/compose-template.yml).
2. Register the service in `services.yaml` (this drives the Makefile targets and the dashboard).
3. Add a tile in `homepage/config/services.yaml` if it should appear on the landing page.
4. Ship a `.env.example` (never a real `.env`).

## Local verification

Run these before pushing (CI runs the same gates):

```bash
yamllint .
gitleaks detect --no-banner
ansible-lint ansible/            # only when touching ansible/
cd <service-dir> && docker compose config -q
python3 ctl/registry.py status  # after up: all containers running
```

## Pull requests

- Branch from `main` and open a PR against `main`.
- Keep PRs focused; describe the service/config change and the verification you ran.
- CI must pass: Gitleaks, Yamllint, Trivy (HIGH/CRITICAL), and ansible-lint (when relevant).

## Security

Found a vulnerability? Follow [SECURITY.md](SECURITY.md) and report privately — do not open a public issue.

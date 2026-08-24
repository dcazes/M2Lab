# Homelab Production Setup

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![CI](https://github.com/dcazes/omnilab/actions/workflows/ci.yml/badge.svg)
![Docker Compose](https://img.shields.io/badge/Docker-Compose-blue?logo=docker)
![Services](https://img.shields.io/badge/services-17%2B-blue)

A production-ready, security-hardened self-hosted homelab using Docker Compose, Tailscale for secure remote access, and a collection of popular self-hosted applications.

## Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Service Catalog](#service-catalog)
- [Quick Start](#quick-start)
- [Security & Privacy](#security--privacy-notes)
- [CI Pipeline](#ci-pipeline)
- [Contributing](#contributing)
- [Security Policy](#security-policy)

## Project Overview

This repository contains a collection of self-hosted services (Vaultwarden, Nextcloud, Immich, Paperless-ngx, etc.) configured with security best practices:
- Non-root execution
- Dropped Linux capabilities
- Read-only root filesystems where applicable
- Internal network isolation for databases and caches
- Secrets managed via environment variables (gitignored `.env` files)
- Tailscale Serve for secure HTTPS access over the tailnet
- CI pipeline for secret scanning and linting

## Architecture

The homelab uses a two-network design for service segmentation:

```
+------------------+     +------------------+
|   Frontend Net   |     |   Backend Net    |
|  (internal: false)|     |  (internal: true)|
+--------+---------+     +--------+---------+
         ^                         ^
         |                         |
+--------+---------+     +------------------+
|  Public Services |     |  Data Stores     |
|  (Web UIs, APIs) |     |  (Postgres, Redis)|
|  - Vaultwarden   |     |  - Postgres DBs  |
|  - Homepage      |     |  - Redis caches  |
|  - Immich UI     |     +------------------+
|  - Paperless-ngx |
|  - Nextcloud     |
|  - etc.          |
+------------------+
```

- **Frontend-net**: Public-facing services (web UIs, APIs) that expose ports to the host for Tailscale Serve.
- **Backend-net**: Internal-only services (databases, caches) with no host port exposure and no internet egress.

Each service's `docker-compose.yml` defines these networks and attaches containers appropriately:
- Public services attach to both `frontend-net` and `backend-net` (to reach backend services).
- Databases and caches attach only to `backend-net`.
- Containers on `backend-net` cannot initiate outbound connections (internet isolation).

Tailscale Serve maps `tailnet_port` → `127.0.0.1:<host_port>` on the host, allowing secure access to services over the tailnet (e.g., `https://home.taile2cc7a.ts.net:8446` → Vaultwarden).

## Service Catalog

The stack is defined in [`services.yaml`](services.yaml) — the single source of truth that drives the Makefile targets, the `ctl/` control plane, and the dashboard. It currently registers **17 services**, including Vaultwarden, Nextcloud, Immich, Paperless-ngx, Mealie, SurfSense, Open WebUI, and LiteLLM. To propose or add a new app, follow [docs/ADDING_APPS.md](docs/ADDING_APPS.md) (or open an [App Request](.github/ISSUE_TEMPLATE/app_request.yml)).

## Prerequisites

- Docker Engine >= 20.10
- Docker Compose V2
- Tailscale account and installed on host
- (Optional) make, python3 (for helper scripts)

## Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/dcazes/omnilab.git
   cd omnilab
   ```

2. Copy the template environment file and configure secrets:
   ```bash
   cp .env.example .env
   # Edit .env to set passwords, API keys, etc.
   # (Each service also has its own .env.example for service-specific variables.)
   ```

3. Start the services:
   ```bash
   # Start a specific service (e.g., vaultwarden)
   make vaultwarden
   # Or start all services
   make start-all
   ```

   Alternatively, use the helper script:
   ```bash
   python3 ctl/registry.py up <service-id>
   ```

## Security & Privacy Notes

- **Zero-Trust Networking**: Services are segmented into frontend and backend networks. Databases reside on an internal-only network (`internal: true`) with no host port mapping, preventing direct exposure even if the container is compromised.
- **Non-Root Execution**: Containers run as a non-root user (UID 1000:1000) where possible.
- **Privilege Reduction**: Application containers drop all Linux capabilities (`cap_drop: ALL`) where the image tolerates it and gain no new privileges (`security_opt: ["no-new-privileges:true"]`). Database/cache images keep their built-in users and entrypoint privilege-drop (they run on the internal-only `backend-net` with no host exposure and no internet egress).
- **Read-Only RootFS**: Where applicable, containers run with read-only root filesystems, using temporary in-memory filesystems (`tmpfs`) for `/tmp` and `/run`.
- **Secret Management**: Secrets are stored in gitignored `.env` files (never committed). A root `.env.example` aggregates all required variables with placeholder values.
- **CI Security**: GitHub Actions workflow runs Gitleaks, Yamllint, and Trivy on every push and pull request to detect secrets, misconfigurations, and vulnerabilities.

## CI Pipeline

The repository includes a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs on push and pull requests to `main`:
- Secret scanning via Gitleaks
- YAML linting
- Trivy configuration and filesystem scans

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a service or improve the stack, and [AGENTS.md](AGENTS.md) for the repo's operational conventions. Pull requests run the CI security gates described above.

## Security Policy

Found a vulnerability? Follow [SECURITY.md](SECURITY.md) and report it privately — do not open a public issue.

## Acknowledgments

This setup integrates numerous excellent self-hosted applications and follows Docker security best practices.
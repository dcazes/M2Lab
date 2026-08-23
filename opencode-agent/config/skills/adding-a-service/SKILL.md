---
name: adding-a-service
description: Checklist for safely adding a new service to the homelab stack
---

Follow this checklist when adding a new service. All rules are enforced by CI (yamllint, gitleaks, trivy) and the makefile.

1. **Create the service directory**
   - `mkdir myapp && cp docs/compose-template.yml myapp/docker-compose.yml`
   - Edit image, ports, volumes, and create `myapp/.env` with real values (gitignored).

2. **Harden the service (copy-paste this block)**
   - Ports bound to `127.0.0.1` only — Tailscale Serve is the public door.
   - Secrets via `${VAR}` referencing `<newapp>/.env` (gitignored).
   - `security_opt: no-new-privileges:true`; add `cap_drop: ALL` / `user: "1000:1000"` only if the data dir is owned by uid 1000.
   - Networks: attach `frontend-net` always; add `backend-net` only if the app reaches a local db/redis.
   - Never give stock postgres/redis/mariadb images `user:` or `read_only:` overrides — their entrypoints need privileged boot.
   - Never create new networks; reuse the shared external ones (subnet exhaustion).

3. **Register in services.yaml**
   - Copy the shape of an existing entry (id, display_name, description, category, icon, dir, project, port, tailnet_port, url, health, optional backup/compose_files).
   - Pick a free `tailnet_port` (see the used list at the bottom of this file).

4. **Add a `.env.example`**
   - Create `myapp/.env.example` listing every `${VAR}` with placeholder values (e.g. `change_me`).

5. **Add a homepage tile (if desired)**
   - Edit `homepage/config/services.yaml` under the appropriate group.
   - Add icon, href (Tailscale Serve URL), description.

6. **Verify before pushing**
   - Run `yamllint .`, `gitleaks detect --no-banner`, `ansible-lint ansible/` (if touching ansible).
   - `make up SERVICE=myapp` → healthy containers.
   - `git add myapp services.yaml && git commit && git push`.

Healthchecks are strongly recommended (add a `health:` block) but not enforced in CI.
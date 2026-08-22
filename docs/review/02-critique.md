# Critique — Setup, Networking, Security

> **Source:** local inventory (`01-stack-index.md`) + grounded research
> (`04-research-notes.md`). Findings are rated **Critical / High / Medium / Low**.
> Fixes reference `AGENTS.md` rules. The AI-agent layer (§03) inherits and
> amplifies several of these risks — read §4 before building MCP servers.

---

## 1. Critical

### C1 — Container with no hardening at all: open-webui
`open-webui/docker-compose.yml` defines **none** of `no-new-privileges`,
`cap_drop`, `read_only`, `user`, `security_opt`. It's a FastAPI app with Ollama
access and an admin UI. A container breakout here reaches the host with no
containment.
**Fix:** add `no-new-privileges:true`, `cap_drop: [ALL]`, `user: "1000:1000"`,
`read_only: true` + `tmpfs: /tmp,/run` (mirror immich/vaultwarden). Pin the image
to a digest, not `:main`.

### C2 — ollama has no hardening and binds 0.0.0.0 internally
`ollama` defines no security opts and sets `OLLAMA_HOST=0.0.0.0:11434` inside the
container (published port is loopback, but the in-container listener is
wildcard). GPU passthrough widens the attack surface.
**Fix:** add the same hardening block as C1; set `OLLAMA_HOST=127.0.0.1` inside
the container so the listener is loopback-only. Pin image.

### C3 — docker.sock mounted without `cap_drop`: portainer
Portainer mounts `/var/run/docker.sock` (full Docker API) but omits
`cap_drop: [ALL]`. Combined, a Portainer RCE = root on the host's Docker socket.
**Fix:** add `cap_drop: [ALL]` + `no-new-privileges:true` (keep `read_only` off
per AGENTS.md stock-image rule). Restrict the socket exposure where possible.

### C4 — firecrawl defines a new Docker network
`firecrawl/docker-compose.yml` creates its own `backend` bridge instead of using
the shared `homelab_backend`. AGENTS.md explicitly forbids new networks
(subnet exhaustion). It also binds redis to `0.0.0.0`.
**Fix:** migrate to `frontend-net`/`backend-net`; bind redis to the internal
network only.

---

## 2. High

### H1 — Unpinned / `:latest` images (most services)
open-webui `:main`, surfsense/worker `:latest`, firecrawl (5 imgs), vaultwarden,
beszel, actual-budget, homepage, ollama, etc. No digest pins → silent behavior
changes and unreproducible restores.
**Fix:** pin `@sha256:` digests for all images (immich/paperless already do this
for db/redis — extend to app images). Track digests in `services.yaml` or compose.

### H2 — Missing healthchecks (8 services)
open-webui, ollama, nextcloud (all), adventurelog (both), actual-budget,
beszel-agent, homepage, paperless app. Breaks dashboard `healthy` state and the
`make update` gate, and removes a basic liveness signal.
**Fix:** add HTTP/TCP healthchecks per the `health:` block already in
`services.yaml` (e.g. `curl -f http://localhost:<port>/` or app-specific path).

### H3 — surfsense & beszel-agent on host/default networks
surfsense uses default bridge (can't resolve backend-net DBs by name);
beszel-agent uses `network_mode: host` (bypasses shared-net isolation, exposes
docker.sock :ro on the host stack).
**Fix:** move surfsense onto `frontend-net`+`backend-net`. For beszel-agent,
prefer the shared network over `host` mode unless host metrics genuinely require
it; add a restart policy.

### H4 — Missing per-service `.env.example` (7 services)
puppygraph, adventurelog, nextcloud, open-webui, ollama, firecrawl.
AGENTS.md requires shipping an `.env.example` per service.
**Fix:** add a service-dir `.env.example` for each, mirroring root template vars.

### H5 — vaultwarden hardcoded `DOMAIN` in compose
`vaultwarden/docker-compose.yml:13` hardcodes the Tailscale URL. Inflexible and
leaks topology into git.
**Fix:** move to `${VAULTWARDEN_DOMAIN}` env var.

### H6 — adventurelog postgis has no `user:`
AGENTS.md warns stock postgres/postgis entrypoints need privileged boot; the
absence of `user:` is inconsistent and may cause boot failures or unintended
privilege.
**Fix:** follow the stock-image rule — do **not** add `user:`/`cap_drop:`/
`read_only:` to the postgis container; verify it boots, and remove any conflicting
`user:` on the app if present.

### H7 — nextcloud `user: "1000:1000"` only on app
Per AGENTS.md this pattern "broke nextcloud-db/puppygraph before." Applying
`user` to the app but not db/redis is inconsistent.
**Fix:** remove `user:` from the nextcloud app container (keep it off db/redis per
the stock-image rule) and confirm boot.

---

## 3. Medium

### M1 — No fail2ban / SSH hardening in bootstrap
Ansible `base` installs ufw but no fail2ban and edits no `sshd_config`.
**Fix:** add fail2ban; set `PermitRootLogin no`, key-only auth, and consider
`MaxAuthTries`. Idempotent in a new role or `base`.

### M2 — Tailscale authkey empty
`group_vars/all.yml` has `tailscale_authkey: ""` → manual `tailscale up`.
**Fix:** provision an authkey (or `tailscale up --ssh`) for unattended rebuilds;
store in secrets, not git.

### M3 — Backups: no encryption, no offsite
`scripts/backup.sh` has no encryption flag and no offsite target. A host loss or
ransomware event loses everything.
**Fix:** add age/openssl encryption and an offsite sync (rclone to a tailnet
peer or object store). Verify restore drills.

### M4 — AI services missing Homepage tiles
ollama, open-webui, firecrawl have no tile in `homepage/config/services.yaml`.
**Fix:** add tiles (AGENTS.md rule).

### M5 — No local Gitleaks pre-commit
CI runs Gitleaks but there's no local hook, so secret leaks are caught only at
push.
**Fix:** add a pre-commit / pre-push Gitleaks hook (or `lefthook`/`husky`).

### M6 — beszel-agent has no restart policy
If the agent dies, monitoring silently gaps.
**Fix:** add `restart: unless-stopped`.

---

## 4. Security implications for the AI-agent layer (read before §03)

The proposed MCP-per-service + subagent design (see `03-ai-agent-architecture.md`)
**inherits and amplifies** the risks above:

- **docker.sock services are the crown jewels.** Portainer, surfsense,
  beszel-agent, homepage all expose the Docker socket. An MCP server with write
  scope against Portainer = remote container control. These must be **read-only
  MCP profiles only**, or excluded from write routing entirely.
- **Prompt injection via stored content** is real here: Paperless OCR docs,
  Nextcloud files, Immich metadata, and SurfSense's web-ingested knowledge base
  can all contain instructions that hijack an agent. Doc-heavy services need
  read-only MCP profiles + content sanitization + human-in-the-loop for writes.
- **Unpinned images + no healthchecks** make the MCP control plane itself
  fragile; pin MCP server images and healthcheck them.
- **Network containment of the agent:** the MCP fleet must live on a dedicated
  `homelab_mcp` network, loopback/Tailscale-only, with no published ports and
  egress limited to the tailnet — see §03.

---

## 5. Prioritized fix list

| Order | Item | Rating | Effort |
|-------|------|--------|--------|
| 1 | Harden open-webui + ollama (C1, C2) | Critical | Low |
| 2 | `cap_drop` + no-new-privileges on portainer (C3) | Critical | Low |
| 3 | Firecrawl → shared networks, redis internal (C4) | Critical | Low |
| 4 | Pin all images to digests (H1) | High | Med |
| 5 | Add healthchecks to 8 services (H2) | High | Med |
| 6 | Fix surfsense/beszel networking (H3) | High | Med |
| 7 | Ship 7 missing `.env.example` (H4) | High | Low |
| 8 | Vaultwarden DOMAIN → env (H5) | High | Low |
| 9 | Fix postgis/nextcloud `user:` (H6, H7) | High | Low |
| 10 | fail2ban + SSH hardening (M1) | Med | Med |
| 11 | Tailscale authkey (M2) | Med | Low |
| 12 | Backup encryption + offsite (M3) | Med | Med |
| 13 | Homepage tiles for AI services (M4) | Med | Low |
| 14 | Local Gitleaks hook (M5) | Med | Low |
| 15 | beszel-agent restart policy (M6) | Med | Low |

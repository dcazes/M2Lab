# Adding a New App

The whole procedure. No Makefile edits needed — `services.yaml` is the registry.

## 1. Create the stack

```bash
mkdir myapp && cp docs/compose-template.yml myapp/docker-compose.yml
# edit image/ports/volumes/env; create myapp/.env with real values
```

Hardening rules baked into the template (keep them):

- Ports bound to `127.0.0.1` only — Tailscale Serve is the public door.
- Secrets via `${VAR}` referencing `<newapp>/.env` (gitignored by `*.env`).
- `security_opt: no-new-privileges:true`; add `cap_drop: ALL` / `user: "1000:1000"`
  only if the data dir is owned by uid 1000.
- Networks: attach `frontend-net` always; add `backend-net` only if the app
  reaches a local db/redis. Databases get backend-net ONLY and no host ports.
- Never give stock postgres/redis/mariadb images `user:` or `read_only:` overrides
  — their entrypoints need privileged boot (see nextcloud-db/puppygraph history).
- Do NOT create new networks; reuse the shared external ones (subnet exhaustion).

## 2. Register it

Add an entry to `services.yaml` (copy the shape of an existing one):

```yaml
  - id: myapp
    display_name: MyApp
    description: What it does
    category: productivity        # any bucket you like
    icon: "📦"
    dir: myapp
    project: myapp                # compose project name
    port: 8123                    # host loopback port
    tailnet_port: 8460            # tailnet HTTPS port to serve it on
    url: http://localhost:8123
    health:
      mode: http
      url: "http://localhost:8123/"
```

Optional fields used by registry.py: `compose_files` (extra `-f` overrides,
e.g. GPU), `depends_on` (container names for status checks), `backup.binds`.

Pick a free `tailnet_port`. Used so far: root→8083 homepage, 8443 immich,
8444 surfsense, 8445 litellm, 8446 vaultwarden, 8448 puppygraph,
8450 beszel, 8451 paperless, 8452 actual, 8453 nextcloud, 8454 adventurelog,
8455 mealie, 8456 open-webui, 8457 ollama, 8458 firecrawl, 8459 freellmapi,
8460 ctl dashboard, 8461 opencode-agent, 9090 portainer.

## 3. Deploy + expose

```bash
make up SERVICE=myapp                 # generic verb — works for any id
sudo tailscale serve --bg --https=8460 http://127.0.0.1:8123
python3 ctl/registry.py status        # confirm healthy
```

Other generic verbs: `stop`, `restart`, `logs`, `pull`, `update`.

## 4. Ship it

```bash
git add myapp services.yaml && git commit -m "add myapp" && git push
```

CI runs Gitleaks/Yamllint/Trivy automatically. Homepage cards come from
`homepage/config/services.yaml` — add a card there too if you want a tile.

## Checklist before pushing

- [ ] `.env.example` created listing every `${VAR}` with placeholders
- [ ] No literal secrets in compose file
- [ ] DB has no published ports and backend-net only
- [ ] Port bound to 127.0.0.1
- [ ] Reuses frontend-net/backend-net, defines no new networks
- [ ] services.yaml entry added; `make up SERVICE=<id>` works

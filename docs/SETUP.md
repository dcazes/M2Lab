# Full Rebuild Runbook

From a dead disk to a working homelab. Everything is in Git; the machine is
cattle. Target: fresh Debian 12 / Ubuntu 22.04+ with a sudo user and SSH up.

## 1. Bootstrap the host with Ansible

On the box (or from any machine that can reach it over SSH):

```bash
sudo apt install -y ansible          # or: pipx install ansible
git clone https://github.com/dcazes/omnilab.git
cd omnilab/ansible
```

Edit `group_vars/all.yml` — user, repo path, timezone, and either paste a
Tailscale auth key (admin console → Settings → Keys) or leave empty to join
interactively afterwards.

Dry-run first, review the diff, then apply:

```bash
ansible-playbook bootstrap.yml --check --diff --ask-become-pass
ansible-playbook bootstrap.yml --ask-become-pass
```

This installs: base packages, Docker Engine + Compose plugin (official repo),
Tailscale, UFW (deny incoming / allow SSH + tailscale0), the docker group,
the shared `homelab_frontend` + `homelab_backend` networks, and clones this
repo to `repo_path`. Idempotent — safe to re-run anytime.

If no auth key was set: `sudo tailscale up --hostname=home`.

## 2. Restore secrets

`.env` files are gitignored by design. For each service you run, create one:

```bash
cd <service> && cp .env.example .env   # where examples exist
```

Fill real values. Minimum for a working tailnet door:
- Tailscale Serve mappings (step 4) need nothing extra.
- Each service's own secrets (DB passwords, API keys) per its `.env.example`.

## 3. Start everything

```bash
make start-all        # or selectively: make up SERVICE=vaultwarden
python3 ctl/registry.py status
```

## 4. Re-expose on the tailnet

```bash
for m in \
  "8443 http://127.0.0.1:2283" \
  "8444 http://127.0.0.1:3929" \
  "8445 http://127.0.0.1:4000" \
  "8446 http://127.0.0.1:8081" \
  "8448 http://127.0.0.1:8082" \
  "8450 http://127.0.0.1:8090" \
  "8451 http://127.0.0.1:8010" \
  "8452 http://127.0.0.1:5006" \
  "8453 http://127.0.0.1:8020" \
  "8454 http://127.0.0.1:8015" \
  "8455 http://127.0.0.1:9000" ; do
  set -- $m; sudo tailscale serve --bg --https=$1 $2 || true
done
sudo tailscale serve --bg --https=9090 http://127.0.0.1:9090   # portainer
sudo tailscale serve reset                                      # nuke if wrong
```

(Homepage rides the root serve: `sudo tailscale serve --bg http://127.0.0.1:8083`
 — check `tailscale serve status` and adjust to match services.yaml ports.)

### Dashboard bootstrap

The control plane (FastAPI dashboard + systemd unit) needs a venv, a built
frontend, and its own tailnet door:

```bash
python3 -m venv .venv && .venv/bin/pip install -r ctl/requirements.txt
cd ctl-web-next && npm ci && npm run build && cd ..
systemctl --user enable --now homelab-ctl
sudo tailscale serve --bg --https=8460 http://127.0.0.1:8787
```

Open `https://<your-tailnet-host>:8460` and use **Initiate**. It safely prepares
and starts Vaultwarden, LiteLLM, and the self-hosted Firecrawl stack, then
offers Nextcloud and SurfSense as optional foundations. Vaultwarden account
creation remains a direct user step because its master password must never pass
through OmniLab. Provider credentials are optional and are configured after
LiteLLM is online. App lifecycle actions require a fresh, short-lived approval.

## 5. Verify

```bash
.venv/bin/python -m unittest discover -s tests -v
cd ctl-web-next && npm run build && cd ..
python3 ctl/registry.py status     # all healthy, no crash-loops
docker ps --format '{{.Names}}'    # expected container list
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:<port>/   # spot-check
```

Then open the tailnet URLs from another device.

## Gotchas learned the hard way

- **Subnet exhaustion**: never define per-stack networks again — reuse the two
  shared external ones. ~24 bridges maxed out the default address pool once.
- **Stock DB images**: postgres/postgis/redis/mariadb break under
  `user:`/`cap_drop:` overrides. Backend-net only, no ports, leave them be.
- **puppygraph** can't have `no-new-privileges` (its entrypoint uses `su`).
- **Mealie data** is uid 911; chown or drop the `user:` override.
- **UFW & Docker**: published ports bypass UFW. We only publish on 127.0.0.1,
  which keeps the firewall meaningful.
- **beszel-agent**: needs its TOKEN from the hub dashboard after first hub boot.

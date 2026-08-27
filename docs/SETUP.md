# OmniLab Installation and Operations

OmniLab currently targets Debian 12, Ubuntu 22.04+, and compatible derivatives
on x86-64 or ARM64 hosts. The control plane runs directly on the host because it
manages multiple Docker Compose projects and their local configuration files.

## Quick installation

Run the installer as your normal login user, not as root:

```bash
git clone https://github.com/dcazes/omnilab.git
cd omnilab
./install.sh
```

The installer asks for confirmation before making changes. It installs Docker
Engine and Compose, Python, Ansible, the shared Docker networks, an isolated
Python environment, and persistent systemd user services. It also creates the
control-plane MCP token without displaying it. Existing `.env` files and service
data are never replaced.

The production React bundle is included in the repository, so Node.js is not an
end-user prerequisite.

### Installer options

```text
./install.sh --dry-run          # show planned commands only
./install.sh --yes              # skip the confirmation prompt
./install.sh --no-start        # install without starting the dashboard
./install.sh --with-upgrade    # also apply safe OS package upgrades
./install.sh --with-firewall   # opt in to the repository's UFW policy
```

Firewall management is opt-in because changing the host's inbound policy can
affect custom SSH configurations. OmniLab remains local-only without that option:
all dashboard and application ports are bound to `127.0.0.1`.

## First start

Open `http://127.0.0.1:8787` after installation. If Docker was installed during
this run, sign out and back in once before installing application stacks; Linux
does not add the current login to a new group retroactively.

The dashboard's Initiate and Settings views prepare service-specific `.env`
files, generate supported credentials, and start only the applications you
select. Vaultwarden account creation remains a direct user action so its master
password never passes through OmniLab.

For later starts:

```bash
./start.sh
```

Use `./start.sh --foreground` for an interactive development-style process or
`./start.sh --no-open` to suppress opening a local browser.

## Updates

Pull changes and rerun the installer. It is idempotent and preserves secrets:

```bash
git pull --ff-only
./install.sh --yes
```

Update an installed application from the dashboard, or use the registry-aware
CLI so services with Compose overlays are handled correctly:

```bash
make update SERVICE=<service-id>
```

## Operations and troubleshooting

```bash
systemctl --user status homelab-ctl
journalctl --user -u homelab-ctl -n 100
systemctl --user restart homelab-ctl
python3 ctl/registry.py status
```

Common issues:

- **Docker permission denied:** sign out and back in, then run `./start.sh`.
- **Port 8787 already in use:** stop the conflicting process or set
  `DASHBOARD_PORT` in the root `.env` and restart the unit.
- **Dashboard bundle missing:** restore the checkout or, as a developer, run
  `npm ci && npm run build` in `ctl-web-next`.
- **A service needs configuration:** use Settings in the dashboard; do not copy
  every `.env.example` globally or commit generated `.env` files.
- **GPU service fails:** use the registry/dashboard path, which automatically
  includes declared GPU Compose overlays.

## Manual host bootstrap

The root installer is the supported path. For host rebuilds or Ansible
development, inspect changes first:

```bash
cd ansible
ansible-playbook bootstrap.yml --check --diff --ask-become-pass
ansible-playbook bootstrap.yml --ask-become-pass
```

Optional behavior is controlled in `ansible/group_vars/all.yml`; repository
updates, OS upgrades, firewall changes, and remote-access tooling are disabled
by default.

## Verification

```bash
.venv/bin/python -m unittest discover -s tests -v
cd ctl-web-next && npm ci && npm run build && cd ..
yamllint .
gitleaks detect --no-banner
ansible-lint ansible/
python3 ctl/registry.py status
```

For each changed application stack, also validate its effective Compose config,
including any overlay declared in `services.yaml`.

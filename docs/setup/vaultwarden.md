# Vaultwarden Setup

Password manager (Bitwarden-compatible) with self-hosted vault.

## Prerequisites
- HTTPS is required for WebAuthn/FIDO2 and for Authentik SSO. Caddy's internal CA
  serves local HTTPS (loopback mode); Tailscale provides the tailnet HTTPS URL
  once connected.
- SQLite database (file-based, included)

## Configuration

### 1. Copy environment template
```bash
cp vaultwarden/.env.example vaultwarden/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `DOMAIN` | Public HTTPS base URL for the vault | Yes |
| `SIGNUPS_ALLOWED` | Allow new user registration (true/false) | Yes |
| `ADMIN_TOKEN` | Admin panel token (openssl rand -hex 32) | Yes* |
| `SSO_ENABLED` / `SSO_ONLY` | Leave `false`; Caddy delegates sign-in to Authentik before Vaultwarden loads | Yes |
| `DATABASE_URL` | SQLite path (default: /data/db.sqlite3) | No |

*Required for admin panel access at `/admin`

### 3. Enable admin panel (optional)
```bash
# In .env
ADMIN_TOKEN=your_generated_token
```
Access at `https://your-domain/admin`

### 4. Authentik SSO wiring
Create one Authentik **Proxy** provider and attach it to the embedded outpost:

- external host: `https://127.0.0.1:19447`
- internal host: `http://127.0.0.1:8081`
- mode: **Forward Single**
- application slug: `vaultwarden`

Caddy's HTTPS Vaultwarden route performs Authentik forward authentication.
Opening it redirects unauthenticated visitors to Authentik and returns an
existing Authentik session to the vault without Vaultwarden's email-based SSO
chooser.

## Service Access
- **Local HTTPS:** https://127.0.0.1:19447 (Caddy ingress; trust Caddy's root CA at `.state/caddy-local-root.crt`)
- **Loopback (plain):** http://127.0.0.1:8081 (initial maintenance only; it bypasses Authentik)
- **Tailscale:** tailnet HTTPS URL once connected

## SSO login
Use `https://127.0.0.1:19447`. Do not use the plain `localhost:8081` login
page for normal access: it is outside Caddy and therefore cannot share the
Authentik session. Vaultwarden is not exposed to any MCP/agent path.

## Backup
```bash
./scripts/backup.sh vaultwarden
```
Backs up: SQLite database bind mount (`data/`).

## Notes
- Data stored in `vaultwarden/data/` (gitignored)
- Uses frontend-net only
- SMTP config needed for email features (invites, 2FA recovery)
- HTTPS (local Caddy CA or Tailscale) satisfies the WebAuthn secure-context requirement and is required for OIDC SSO

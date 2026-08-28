# Vaultwarden Setup

Password manager (Bitwarden-compatible) with self-hosted vault.

## Prerequisites
- HTTPS is required for WebAuthn/FIDO2 and for OIDC SSO. Caddy's internal CA
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
| `SSO_ENABLED` | Enable Authentik OpenID Connect SSO (`true`) | Yes |
| `SSO_AUTHORITY` | Authentik OIDC issuer URL (e.g. `https://127.0.0.1:19462/application/o/vaultwarden/`) | Yes |
| `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET` | OIDC client credentials (from the Authentik "Vaultwarden SSO" provider) | Yes |
| `SSO_SCOPES` | `email profile openid offline_access` | Yes |
| `SSO_PKCE` | Proof Key for Code Exchange (`true`) | Yes |
| `SSO_USE_DB` | Don't persist provider bake tokens in the DB (`false`) | Yes |
| `DATABASE_URL` | SQLite path (default: /data/db.sqlite3) | No |

*Required for admin panel access at `/admin`

### 3. Enable admin panel (optional)
```bash
# In .env
ADMIN_TOKEN=your_generated_token
```
Access at `https://your-domain/admin`

### 4. Authentik SSO wiring
The Authentik OIDC provider "Vaultwarden SSO" and its application (slug
`vaultwarden`) are created via the admin API, with:
- implicit-consent authorization flow and invalidation flow
- redirect URI `DOMAIN/identity/connect/oidc-signin`
- scopes `openid/profile/email/offline_access`

## Service Access
- **Local HTTPS:** https://127.0.0.1:19447 (Caddy ingress; trust Caddy's root CA at `.state/caddy-local-root.crt`)
- **Loopback (plain):** http://127.0.0.1:8081
- **Tailscale:** tailnet HTTPS URL once connected

## SSO login
- The vault's SSO route is `/identity/connect/oidc-signin` and is registered
  (confirmed in Vaultwarden startup logs).
- Sign in through Authentik; the vault still unlocks with your local master
  password. Vaultwarden is not exposed to any MCP/agent path.

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
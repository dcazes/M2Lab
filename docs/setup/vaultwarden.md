# Vaultwarden Setup

Password manager (Bitwarden-compatible) with self-hosted vault.

## Prerequisites
- HTTPS required for WebAuthn/FIDO2 (Tailscale provides this)
- SQLite database (file-based, included)

## Configuration

### 1. Copy environment template
```bash
cp vaultwarden/.env.example vaultwarden/.env
```

### 2. Required variables in `.env`
| Variable | Description | Required |
|----------|-------------|----------|
| `SIGNUPS_ALLOWED` | Allow new user registration (true/false) | Yes |
| `ADMIN_TOKEN` | Admin panel token (openssl rand -hex 32) | Yes* |
| `DATABASE_URL` | SQLite path (default: /data/db.sqlite3) | No |

*Required for admin panel access at `/admin`

### 3. Enable admin panel (optional)
```bash
# In .env
ADMIN_TOKEN=your_generated_token
```
Access at `https://your-domain/admin`

## Service Access
- **Local:** http://localhost:8081
- **Tailscale:** https://home.taile2cc7a.ts.net:8446

## Backup
```bash
./scripts/backup.sh vaultwarden
```
Backs up: SQLite database bind mount (`data/`).

## Notes
- Data stored in `vaultwarden/data/` (gitignored)
- Uses frontend-net only
- SMTP config needed for email features (invites, 2FA recovery)
- Tailscale HTTPS satisfies WebAuthn secure context requirement
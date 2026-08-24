# Portainer Setup

Docker management UI + control API for container lifecycle management.

## Prerequisites
- Docker socket access (`/var/run/docker.sock`)
- Persistent data volume

## Configuration

### 1. No `.env` required
Portainer uses admin-created credentials on first login.

### 2. Docker socket
The compose mounts `/var/run/docker.sock` for full Docker control.

## Service Access
- **Local:** http://localhost:9090
- **Tailscale:** https://home.taile2cc7a.ts.net:9090

## Backup
```bash
./scripts/backup.sh portainer
```
Backs up: `portainer_data` named volume.

## Notes
- Data in named volume `portainer_data`
- Uses frontend-net only
- **Security:** Full Docker socket access = root-equivalent on host
- First login creates admin user
- Used by OmniLab dashboard for container management
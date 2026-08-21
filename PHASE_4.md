# Phase 4 Log — Tailscale Remote Access

**Started:** 2026-08-20  
**Goal:** Host-level Tailscale install + `tailscale serve` to expose all services over tailnet HTTPS. Zero changes to any stack.

---

## 1. Approach

Per plan §9: **Host install + `tailscale serve`**. All services already bind `127.0.0.1:<port>`. `tailscale serve` bridges tailnet → loopback with automatic HTTPS (MagicDNS certs). No per-stack changes.

---

## 2. User instructions (execute on host)

### Step 1: Install Tailscale (official repo)
```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

### Step 2: Bring up and authenticate
```bash
sudo tailscale up
```
This opens a browser for OAuth authentication. Complete the flow.

### Step 3: Expose services to tailnet (run each as `sudo` for privileged ports < 1024, or use high ports)
```bash
# Dashboard (port 8787 → 443)
tailscale serve --bg --https=443 http://127.0.0.1:8787

# Apps (privileged ports need sudo)
sudo tailscale serve --bg --https=8443 http://127.0.0.1:2283   # Immich
sudo tailscale serve --bg --https=8444 http://127.0.0.1:3929   # SurfSense
sudo tailscale serve --bg --https=8445 http://127.0.0.1:3001   # FreeLLMAPI
sudo tailscale serve --bg --https=8446 http://127.0.0.1:8081   # Vaultwarden (Phase 5)
sudo tailscale serve --bg --https=8447 http://127.0.0.1:7474   # Neo4j Browser (Phase 5)
```

### Step 4: Verify
```bash
tailscale serve status
```
Should show all 7 mappings.

### Step 5: Test from phone (LTE, on your tailnet)
Open `https://<your-hostname>.<your-tailnet>.ts.net/` — dashboard loads.
Test each app:
- Immich: `https://<host>.ts.net:8443/`
- SurfSense: `https://<host>.ts.net:8444/`
- FreeLLMAPI: `https://<host>.ts.net:8445/api/ping` → 200

---

## 3. Notes

- **Vaultwarden hard requirement:** Must be served over HTTPS or Bitwarden clients refuse (WebCrypto). Tailnet HTTPS satisfies this.
- **Container-sidecar alternative** (not needed): `tailscale/tailscale:latest` sidecar with `TS_AUTHKEY` + caps. Reserved for future headless setups.
- **Auth keys for unattended nodes:** Generate at `console.tailscale.com/admin/settings/keys`, then `sudo tailscale up --authkey=tskey-...`.

---

## 4. Verification results

**Serve mappings created:**
```
https://dak-rog-strix-g10dk-g10dk.taile2cc7a.ts.net/        → 127.0.0.1:8787 (dashboard)
https://dak-rog-strix-g10dk-g10dk.taile2cc7a.ts.net:8443/   → 127.0.0.1:2283 (Immich)
https://dak-rog-strix-g10dk-g10dk.taile2cc7a.ts.net:8444/   → 127.0.0.1:3929 (SurfSense)
https://dak-rog-strix-g10dk-g10dk.taile2cc7a.ts.net:8445/   → 127.0.0.1:3001 (FreeLLMAPI)
```

**Phone-on-LTE test (Pixel 8, tailnet):**
- Dashboard: ✅ Loads
- Immich: ✅ Loads
- SurfSense: ✅ Loads
- FreeLLMAPI `/api/ping`: ✅ Returns JSON

**Local browser (LibreWolf):** Cannot connect to MagicDNS HTTPS due to certificate trust (expected — the cert is issued for tailnet, not localhost). This does not affect the intended use case (remote access).

---

## 5. Deviations

- Dashboard serve required `sudo` for port 443 (privileged). Ran `sudo tailscale serve --bg --https=443 http://127.0.0.1:8787`.
- Added `sudo tailscale set --operator=dak` for future non-root serve commands (not yet tested).

---

## 6. Next

Phase 5: Vaultwarden + Neo4j stacks. Need user to `docker pull` images, then create compose dirs and registry entries.
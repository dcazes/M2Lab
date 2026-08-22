# Phase 3 Log — Dashboard Frontend

**Started:** 2026-08-20  
**Goal:** Single static file, vanilla JS. Polls `/api/services` (3s) and `/api/system` (5s); buttons POST actions; log panel opens SSE. Renders whatever `services.yaml` contains — adding an app needs no frontend change.

---

## 1. File to create

- `ctl-web/index.html` — complete dashboard UI per plan §8

---

## 2. Implementation

(in progress)

---

## 3. Verification results

**Dashboard URL:** http://127.0.0.1:8787

**Features verified via browser:**
- **System stats:** CPU/RAM/DISK bars update every 5s. Docker "●" indicates API connectivity.
- **Service cards:**
  - Icons and names match `services.yaml`.
  - States (running/stopped) update every 3s.
  - "Open" buttons appear only when service is running.
- **Actions:**
  - Start/Stop/Restart/Update buttons all shell out to Compose CLI correctly.
  - Output from CLI appears in the log box below.
  - "Logs" button opens an SSE stream; logs from all containers in the project interleave in real-time.
- **Global Actions:** START/STOP/UPDATE ALL work sequentially.

**Persistence:**
- `homelab-ctl.service` installed to `~/.config/systemd/user/`.
- Active and running: `systemctl --user status homelab-ctl`.
- Linger enabled: `loginctl enable-linger dak`. Dashboard will start on boot and stay alive after logout.

---

## 4. Deviations from plan

- **Frontend JS `all_()` loop**: Used `await act(id, a)` inside the loop (sequential) as planned to prevent "compose storms" (multiple concurrent `docker compose` calls competing for the engine lock). Sequential start is safer for the system.

---

## 5. Next

Phase 4: Tailscale remote access. This requires installing Tailscale on the host and running `tailscale serve`. Proceeding with instructions for the user.
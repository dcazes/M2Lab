# Phase 7 Log — Switchover Procedure

**Goal:** Provide a step-by-step guide to decommission the old Programs structure and make `HomeServer/` the permanent live environment.

---

## 1. Status Check

The `HomeServer/` prototype is currently **running**. Because it uses the same ports and names as the original `Programs/` stacks:
- **Port conflicts:** You cannot run both simultaneously on the same host (though today they are sharing container names/networks so "switching" is already partially done).
- **Volumes:** Both locations share the same Docker named volumes (`surfsense-postgres`, etc.). Bind-mounted data is now split: `HomeServer/immich-app/library` is separate from `Programs/immich-app/library`.

---

## 2. Switchover Steps (Recommended)

When you are ready to make `HomeServer/` the definitive location:

### Step 1: Stop and Clean up
Stop all containers to ensure a clean data state.
```bash
cd /home/dak/Desktop/Programs/HomeServer
make stop-all
# stop original stacks too if any are lingering
cd /home/dak/Desktop/Programs/immich-app && docker compose down
cd /home/dak/Desktop/Programs/surfsense && docker compose down
cd /home/dak/Desktop/Programs/FreeLLMAPI && docker compose down
```

### Step 2: Final Data Sync (Optional)
If you made changes in the original `Programs/` while prototyping:
```bash
# Sync Immich library back to HomeServer
rsync -av /home/dak/Desktop/Programs/immich-app/library/ /home/dak/Desktop/Programs/HomeServer/immich-app/library/
# Sync FreeLLMAPI db
cp /home/dak/Desktop/Programs/FreeLLMAPI/data/freeapi.db /home/dak/Desktop/Programs/HomeServer/FreeLLMAPI/data/
```

### Step 3: Archive old Programs
Move the old folders out of the way to avoid confusion.
```bash
cd /home/dak/Desktop/Programs
mkdir -p archive
mv immich-app surfsense FreeLLMAPI Makefile archive/
```

### Step 4: Promote HomeServer
You can keep it at `HomeServer/` or move its contents up to `Programs/`. If moving:
```bash
cd /home/dak/Desktop/Programs/HomeServer
mv * .venv .env ..
cd ..
rmdir HomeServer
```
*Note: if you move files, update the `WorkingDirectory` and `ExecStart` paths in `~/.config/systemd/user/homelab-ctl.service` and run `systemctl --user daemon-reload`.*

---

## 3. Final Verification

1. **Dashboard:** `http://localhost:8787` (local) or tailnet (remote).
2. **Services:** START ALL and ensure icons turn green.
3. **Backups:** Run `./scripts/backup.sh all` to ensure the new paths are being backed up.

---

## 4. Completed Project Summary

- **Architecture:** Declarative `services.yaml` driving both CLI and Web.
- **CLI:** `make <verb> SERVICE=<id>` (muscle memory preserved).
- **Web:** FastAPI + Vanilla JS dashboard with SSE logs and real-time stats.
- **Networking:** Local loopback only + Tailscale for secure remote access (HTTPS).
- **Apps:** SurfSense, Immich, FreeLLMAPI + new Vaultwarden & PuppyGraph.
- **Ops:** systemd user unit for autostart; daily backup script.

**Project Complete.** Any further tweaks (new apps, backup scheduling) follow the patterns established in `services.yaml`.
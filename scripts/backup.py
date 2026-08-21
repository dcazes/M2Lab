#!/usr/bin/env python3
import yaml
import subprocess
import os
import sys
from datetime import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKUPS = os.path.join(ROOT, "backups")
DATE = datetime.now().strftime("%Y-%m-%d")

os.makedirs(BACKUPS, exist_ok=True)

def run(cmd, capture=False):
    if capture:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return subprocess.run(cmd, shell=True)

def backup_service(svc):
    sid = svc["id"]
    backup = svc.get("backup")
    if not backup:
        return

    print(f"[{sid}] Starting backup...")

    # PostgreSQL Dumps
    for dump in backup.get("dumps", []):
        container = dump["container"]
        user = dump["user"]
        db = dump["database"]
        print(f"[{sid}] Dumping {db} from {container}...")
        dest = os.path.join(BACKUPS, f"{sid}-{db}-{DATE}.sql.gz")
        # Suppress stderr to avoid noisy warnings
        cmd = f"docker exec {container} pg_dump -U {user} {db} 2>/dev/null | gzip > {dest}"
        run(cmd)
        print(f"  → {os.path.basename(dest)}")

    # Named Volumes
    for vol in backup.get("volumes", []):
        print(f"[{sid}] Backing up volume {vol}...")
        dest = os.path.join(BACKUPS, f"{vol}-{DATE}.tgz")
        cmd = f"docker run --rm -v {vol}:/src:ro -v {BACKUPS}:/dst alpine tar czf /dst/{os.path.basename(dest)} -C /src . 2>/dev/null"
        run(cmd)
        print(f"  → {os.path.basename(dest)}")

    # Bind Mounts
    for bind in backup.get("binds", []):
        print(f"[{sid}] Backing up bind mount {bind}...")
        src_path = os.path.join(ROOT, svc["dir"], bind)
        if os.path.exists(src_path):
            dest = os.path.join(BACKUPS, f"{sid}-{bind}-{DATE}.tgz")
            cmd = f"tar czf {dest} -C {os.path.join(ROOT, svc['dir'])} {bind} 2>/dev/null"
            run(cmd)
            print(f"  → {os.path.basename(dest)}")
        else:
            print(f"  ! Path not found: {src_path}")

    print(f"[{sid}] Done.")

def main():
    with open(os.path.join(ROOT, "services.yaml"), "r") as f:
        config = yaml.safe_load(f)

    services = config.get("services", [])
    target = sys.argv[1] if len(sys.argv) > 1 else "all"

    if target == "all":
        for svc in services:
            backup_service(svc)
    else:
        svc = next((s for s in services if s["id"] == target), None)
        if svc:
            backup_service(svc)
        else:
            print(f"Unknown service: {target}")
            sys.exit(1)

if __name__ == "__main__":
    main()

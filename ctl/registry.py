#!/usr/bin/env python3
"""registry.py — compose operations driven by services.yaml."""
import os
import sys
import subprocess
import yaml
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_raw = yaml.safe_load((ROOT / "services.yaml").read_text())
SETTINGS: dict = _raw["settings"]
SERVICES: list[dict] = _raw["services"]
SVCS = {s["id"]: s for s in SERVICES}


def tailscale_required() -> bool:
    """Whether onboarding must gate on an installed+connected Tailscale.

    The env override wins over the services.yaml setting so operators can opt
    in/out without touching tracked config. False (the default) lets the
    identity foundation run entirely on loopback with no Tailscale present.
    """
    env = os.environ.get("OMNILAB_REQUIRE_TAILSCALE")
    if env is not None:
        return env.lower() == "true"
    return str(SETTINGS.get("tailscale_required", False)).lower() == "true"


def base_cmd(s: dict) -> list[str]:
    cmd = ["docker", "compose"]
    for f in s.get("compose_files", []):
        cmd += ["-f", "docker-compose.yml", "-f", f]
    return cmd


def run(s: dict, args: list[str]) -> int:
    cmd = base_cmd(s) + args
    print("+", " ".join(cmd), f"(in {s['dir']}/)")
    return subprocess.call(cmd, cwd=ROOT / s["dir"])


def service_by_id(sid: str) -> dict:
    if sid not in SVCS:
        raise KeyError(f"unknown service {sid!r}")
    return SVCS[sid]


def main():
    if len(sys.argv) < 2:
        print("Usage: registry.py <verb> [service-id]", file=sys.stderr)
        return 1
    verb = sys.argv[1]
    if verb == "ids":
        print(" ".join(SVCS))
        return 0
    # status without service-id = all services
    if verb == "status" and len(sys.argv) < 3:
        rc = 0
        for s in SERVICES:
            rc = run(s, ["ps"]) or rc
        return rc
    if len(sys.argv) < 3:
        print(f"Usage: registry.py {verb} <service-id>", file=sys.stderr)
        return 1
    sid = sys.argv[2]
    try:
        s = service_by_id(sid)
    except KeyError:
        print(f"Unknown service: {sid}. Available: {', '.join(sorted(s['id'] for s in SERVICES))}", file=sys.stderr)
        sys.exit(1)
    match verb:
        case "up":
            return run(s, ["up", "-d"])
        case "stop":
            return run(s, ["stop"])
        case "pull":
            return run(s, ["pull"])
        case "logs":
            return run(s, ["logs", "-f", "--tail=200"])
        case "update":
            return run(s, ["pull"]) or run(s, ["up", "-d"])
        case "status":
            return run(s, ["ps"])
    print(f"Unknown verb {verb!r}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main() or 0)
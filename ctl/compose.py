"""compose.py — async wrapper for `docker compose` subprocess calls."""
import asyncio
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


async def run_compose(s: dict, args: list[str]) -> tuple[int, str]:
    """Run `docker compose [-f overlay...] <args>` inside the service dir."""
    cmd = ["docker", "compose"]
    for f in s.get("compose_files", []):
        cmd += ["-f", "docker-compose.yml", "-f", f]
    cmd += args
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=str(ROOT / s["dir"]),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=900)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 1, "timeout after 900s"
    return proc.returncode or 0, out.decode(errors="replace")
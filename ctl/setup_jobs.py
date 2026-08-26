"""Durable setup/onboarding jobs backed by the standard-library SQLite.

Jobs contain only progress metadata and sanitized errors. Credentials remain in
service env files and are never written to this database.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .registry import ROOT


DB_PATH = ROOT / ".state" / "setup-jobs.sqlite3"
_LOCK = threading.Lock()
TERMINAL = {"ready", "failed", "cancelled"}
ACTIVE = {"queued", "preparing", "starting", "waiting", "configuring", "verifying"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS setup_jobs (
          id TEXT PRIMARY KEY,
          target TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          stage TEXT NOT NULL,
          summary TEXT NOT NULL,
          progress INTEGER NOT NULL DEFAULT 0,
          action_json TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS setup_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          stage TEXT NOT NULL,
          status TEXT NOT NULL,
          message TEXT NOT NULL,
          FOREIGN KEY(job_id) REFERENCES setup_jobs(id)
        );
        """
    )
    return connection


def _decode(row: sqlite3.Row, events: list[dict] | None = None) -> dict:
    item = dict(row)
    item["action"] = json.loads(item.pop("action_json")) if item.get("action_json") else None
    item["events"] = events or []
    return item


def create_job(target: str, kind: str, summary: str) -> dict:
    with _LOCK, _connect() as connection:
        existing = connection.execute(
            "SELECT * FROM setup_jobs WHERE target = ? ORDER BY created_at DESC LIMIT 1", (target,)
        ).fetchone()
        if existing and existing["status"] not in TERMINAL:
            return get_job(existing["id"])
        job_id = uuid.uuid4().hex
        timestamp = _now()
        connection.execute(
            "INSERT INTO setup_jobs (id,target,kind,status,stage,summary,progress,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (job_id, target, kind, "queued", "queued", summary, 0, timestamp, timestamp),
        )
        connection.execute(
            "INSERT INTO setup_events (job_id,timestamp,stage,status,message) VALUES (?,?,?,?,?)",
            (job_id, timestamp, "queued", "queued", "Setup queued"),
        )
    return get_job(job_id)


def update_job(job_id: str, *, status: str, stage: str, summary: str,
               progress: int, message: str, action: dict | None = None,
               error: str | None = None) -> dict:
    timestamp = _now()
    action_json = json.dumps(action, separators=(",", ":")) if action else None
    with _LOCK, _connect() as connection:
        if not connection.execute("SELECT 1 FROM setup_jobs WHERE id = ?", (job_id,)).fetchone():
            raise KeyError(job_id)
        connection.execute(
            "UPDATE setup_jobs SET status=?,stage=?,summary=?,progress=?,action_json=?,error=?,updated_at=? WHERE id=?",
            (status, stage, summary, max(0, min(progress, 100)), action_json, error, timestamp, job_id),
        )
        connection.execute(
            "INSERT INTO setup_events (job_id,timestamp,stage,status,message) VALUES (?,?,?,?,?)",
            (job_id, timestamp, stage, status, message),
        )
    return get_job(job_id)


def get_job(job_id: str) -> dict:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM setup_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise KeyError(job_id)
        events = [dict(event) for event in connection.execute(
            "SELECT timestamp,stage,status,message FROM setup_events WHERE job_id = ? ORDER BY id", (job_id,)
        ).fetchall()]
        return _decode(row, events)


def list_jobs(limit: int = 30) -> dict:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM setup_jobs ORDER BY updated_at DESC LIMIT ?", (max(1, min(limit, 100)),)
        ).fetchall()
        jobs = []
        for row in rows:
            events = [dict(event) for event in connection.execute(
                "SELECT timestamp,stage,status,message FROM setup_events WHERE job_id = ? ORDER BY id DESC LIMIT 20",
                (row["id"],),
            ).fetchall()][::-1]
            jobs.append(_decode(row, events))
    return {
        "jobs": jobs,
        "active": sum(job["status"] in ACTIVE or job["status"] == "user_action_required" for job in jobs),
        "attention": sum(job["status"] in {"failed", "user_action_required"} for job in jobs),
    }


def recover_interrupted_jobs() -> int:
    """Turn process-interrupted work into an explicit, retryable state."""
    timestamp = _now()
    with _LOCK, _connect() as connection:
        rows = connection.execute(
            f"SELECT id,stage FROM setup_jobs WHERE status IN ({','.join('?' for _ in ACTIVE)})",
            tuple(ACTIVE),
        ).fetchall()
        for row in rows:
            connection.execute(
                "UPDATE setup_jobs SET status='failed',summary='Setup was interrupted',error=?,updated_at=? WHERE id=?",
                ("The control plane restarted during setup. Retry safely from Settings.", timestamp, row["id"]),
            )
            connection.execute(
                "INSERT INTO setup_events (job_id,timestamp,stage,status,message) VALUES (?,?,?,?,?)",
                (row["id"], timestamp, row["stage"], "failed", "Control plane restart interrupted this setup run"),
            )
    return len(rows)

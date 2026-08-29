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
        CREATE TABLE IF NOT EXISTS setup_batches (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          phase TEXT NOT NULL,
          current_index INTEGER NOT NULL DEFAULT 0,
          reserve_ratio REAL NOT NULL DEFAULT 0.20,
          pull_embedding INTEGER NOT NULL DEFAULT 1,
          host_total_bytes INTEGER NOT NULL DEFAULT 0,
          host_baseline_bytes INTEGER NOT NULL DEFAULT 0,
          measured_bytes INTEGER NOT NULL DEFAULT 0,
          projected_bytes INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS setup_batch_items (
          batch_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          service_id TEXT NOT NULL,
          role TEXT NOT NULL,
          dependencies_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL,
          phase TEXT NOT NULL,
          sso_strategy TEXT NOT NULL,
          baseline_bytes INTEGER NOT NULL DEFAULT 0,
          peak_bytes INTEGER NOT NULL DEFAULT 0,
          steady_bytes INTEGER NOT NULL DEFAULT 0,
          marginal_bytes INTEGER NOT NULL DEFAULT 0,
          gpu_peak_bytes INTEGER NOT NULL DEFAULT 0,
          projected_bytes INTEGER NOT NULL DEFAULT 0,
          confidence TEXT NOT NULL DEFAULT 'unmeasured',
          measured_at TEXT,
          error TEXT,
          PRIMARY KEY(batch_id, ordinal),
          FOREIGN KEY(batch_id) REFERENCES setup_batches(id)
        );
        CREATE TABLE IF NOT EXISTS setup_batch_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          batch_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          service_id TEXT,
          phase TEXT NOT NULL,
          status TEXT NOT NULL,
          message TEXT NOT NULL,
          FOREIGN KEY(batch_id) REFERENCES setup_batches(id)
        );
        """
    )
    # Lightweight in-place migrations keep existing durable setup databases usable.
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(setup_batch_items)")}
    for name in ("marginal_bytes", "gpu_peak_bytes"):
        if name not in columns:
            connection.execute(f"ALTER TABLE setup_batch_items ADD COLUMN {name} INTEGER NOT NULL DEFAULT 0")
    batch_columns = {row["name"] for row in connection.execute("PRAGMA table_info(setup_batches)")}
    if "pull_embedding" not in batch_columns:
        connection.execute("ALTER TABLE setup_batches ADD COLUMN pull_embedding INTEGER NOT NULL DEFAULT 1")
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


def _decode_batch(connection: sqlite3.Connection, row: sqlite3.Row) -> dict:
    items = []
    for item_row in connection.execute(
        "SELECT * FROM setup_batch_items WHERE batch_id = ? ORDER BY ordinal", (row["id"],)
    ).fetchall():
        item = dict(item_row)
        item["dependencies"] = json.loads(item.pop("dependencies_json") or "[]")
        items.append(item)
    events = [dict(event) for event in connection.execute(
        "SELECT timestamp,service_id,phase,status,message FROM setup_batch_events "
        "WHERE batch_id = ? ORDER BY id DESC LIMIT 100", (row["id"],)
    ).fetchall()][::-1]
    result = dict(row)
    result["items"] = items
    result["events"] = events
    return result


def create_batch(items: list[dict], *, reserve_ratio: float = 0.20,
                 host_total_bytes: int = 0, host_baseline_bytes: int = 0,
                 pull_embedding: bool = True) -> dict:
    """Create one immutable, ordered onboarding batch."""
    batch_id = uuid.uuid4().hex
    timestamp = _now()
    with _LOCK, _connect() as connection:
        active = connection.execute(
            "SELECT id FROM setup_batches WHERE status IN "
            "('queued','running','paused_memory','paused_handoff','paused_interrupted') "
            "ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
        if active:
            return get_batch(active["id"])
        connection.execute(
            "INSERT INTO setup_batches "
            "(id,status,phase,current_index,reserve_ratio,pull_embedding,host_total_bytes,host_baseline_bytes,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (batch_id, "queued", "queued", 0, reserve_ratio, int(pull_embedding),
             host_total_bytes, host_baseline_bytes, timestamp, timestamp),
        )
        for ordinal, item in enumerate(items):
            connection.execute(
                "INSERT INTO setup_batch_items "
                "(batch_id,ordinal,service_id,role,dependencies_json,status,phase,sso_strategy,projected_bytes) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (batch_id, ordinal, item["service_id"], item["role"],
                 json.dumps(item.get("dependencies", []), separators=(",", ":")), "queued", "queued",
                 item["sso_strategy"], int(item.get("projected_bytes", 0))),
            )
        connection.execute(
            "INSERT INTO setup_batch_events (batch_id,timestamp,phase,status,message) VALUES (?,?,?,?,?)",
            (batch_id, timestamp, "queued", "queued", f"Queued {len(items)} services for safe sequential setup"),
        )
    return get_batch(batch_id)


def get_batch(batch_id: str) -> dict:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM setup_batches WHERE id = ?", (batch_id,)).fetchone()
        if not row:
            raise KeyError(batch_id)
        return _decode_batch(connection, row)


def list_batches(limit: int = 10) -> dict:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM setup_batches ORDER BY updated_at DESC LIMIT ?", (max(1, min(limit, 50)),)
        ).fetchall()
        return {"batches": [_decode_batch(connection, row) for row in rows]}


def update_batch(batch_id: str, *, status: str, phase: str, current_index: int | None = None,
                 measured_bytes: int | None = None, projected_bytes: int | None = None,
                 error: str | None = None, message: str | None = None,
                 service_id: str | None = None) -> dict:
    timestamp = _now()
    fields = ["status=?", "phase=?", "error=?", "updated_at=?"]
    values: list = [status, phase, error, timestamp]
    if current_index is not None:
        fields.append("current_index=?")
        values.append(current_index)
    if measured_bytes is not None:
        fields.append("measured_bytes=?")
        values.append(max(0, measured_bytes))
    if projected_bytes is not None:
        fields.append("projected_bytes=?")
        values.append(max(0, projected_bytes))
    values.append(batch_id)
    with _LOCK, _connect() as connection:
        if not connection.execute("SELECT 1 FROM setup_batches WHERE id=?", (batch_id,)).fetchone():
            raise KeyError(batch_id)
        connection.execute(f"UPDATE setup_batches SET {','.join(fields)} WHERE id=?", values)
        if message:
            connection.execute(
                "INSERT INTO setup_batch_events (batch_id,timestamp,service_id,phase,status,message) VALUES (?,?,?,?,?,?)",
                (batch_id, timestamp, service_id, phase, status, message),
            )
    return get_batch(batch_id)


def update_batch_item(batch_id: str, ordinal: int, *, status: str, phase: str,
                      baseline_bytes: int | None = None, peak_bytes: int | None = None,
                      steady_bytes: int | None = None, marginal_bytes: int | None = None,
                      gpu_peak_bytes: int | None = None, projected_bytes: int | None = None,
                      confidence: str | None = None, measured_at: str | None = None,
                      error: str | None = None, message: str | None = None) -> dict:
    timestamp = _now()
    fields = ["status=?", "phase=?", "error=?"]
    values: list = [status, phase, error]
    for name, value in (("baseline_bytes", baseline_bytes), ("peak_bytes", peak_bytes),
                        ("steady_bytes", steady_bytes), ("marginal_bytes", marginal_bytes),
                        ("gpu_peak_bytes", gpu_peak_bytes), ("projected_bytes", projected_bytes),
                        ("confidence", confidence), ("measured_at", measured_at)):
        if value is not None:
            fields.append(f"{name}=?")
            values.append(value)
    values.extend([batch_id, ordinal])
    with _LOCK, _connect() as connection:
        connection.execute(
            f"UPDATE setup_batch_items SET {','.join(fields)} WHERE batch_id=? AND ordinal=?", values
        )
        connection.execute("UPDATE setup_batches SET updated_at=? WHERE id=?", (timestamp, batch_id))
        if message:
            sid_row = connection.execute(
                "SELECT service_id FROM setup_batch_items WHERE batch_id=? AND ordinal=?", (batch_id, ordinal)
            ).fetchone()
            connection.execute(
                "INSERT INTO setup_batch_events (batch_id,timestamp,service_id,phase,status,message) VALUES (?,?,?,?,?,?)",
                (batch_id, timestamp, sid_row["service_id"] if sid_row else None, phase, status, message),
            )
    return get_batch(batch_id)


def recover_interrupted_batches() -> int:
    timestamp = _now()
    with _LOCK, _connect() as connection:
        rows = connection.execute(
            "SELECT id FROM setup_batches WHERE status IN ('queued','running')"
        ).fetchall()
        for row in rows:
            connection.execute(
                "UPDATE setup_batches SET status='paused_interrupted',phase='paused_interrupted',"
                "error=?,updated_at=? WHERE id=?",
                ("The control plane restarted. Resume to re-check the current service safely.", timestamp, row["id"]),
            )
            connection.execute(
                "INSERT INTO setup_batch_events (batch_id,timestamp,phase,status,message) VALUES (?,?,?,?,?)",
                (row["id"], timestamp, "paused_interrupted", "paused_interrupted",
                 "Control plane restart paused sequential setup"),
            )
    return len(rows)

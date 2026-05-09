"""
history.py — SQLite snapshot writer: captures fleet state every 30 seconds.
Ring buffer: keeps the last 120 snapshots (120 × 30s = 1 hour of history).
Uses Python's built-in sqlite3 via asyncio.run_in_executor so it stays
non-blocking inside the FastAPI event loop.
"""
import asyncio
import json
import os
import sqlite3
from datetime import datetime
from typing import Callable, Dict, Any, List

_HERE = os.path.dirname(os.path.abspath(__file__))
_DB_PATH = os.path.join(_HERE, "history.db")

_SNAPSHOT_INTERVAL = 30   # seconds between snapshots
_MAX_SNAPSHOTS     = 120  # 120 × 30 s = 1 hour ring buffer

# ---------------------------------------------------------------------------
# Synchronous helpers — executed in a thread pool to avoid blocking the loop
# ---------------------------------------------------------------------------

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _init_sync() -> None:
    conn = _get_conn()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS fleet_snapshots (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp    TEXT    NOT NULL,
                ships        TEXT    NOT NULL,
                alerts_count INTEGER NOT NULL DEFAULT 0,
                zones_count  INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ts "
            "ON fleet_snapshots(timestamp DESC)"
        )
        conn.commit()
    finally:
        conn.close()


def _write_sync(timestamp: str, ships_json: str,
                alerts_count: int, zones_count: int) -> None:
    conn = _get_conn()
    try:
        conn.execute(
            "INSERT INTO fleet_snapshots "
            "(timestamp, ships, alerts_count, zones_count) VALUES (?,?,?,?)",
            (timestamp, ships_json, alerts_count, zones_count),
        )
        # Ring-buffer: delete oldest rows beyond the limit
        conn.execute("""
            DELETE FROM fleet_snapshots
            WHERE id NOT IN (
                SELECT id FROM fleet_snapshots
                ORDER BY id DESC LIMIT ?
            )
        """, (_MAX_SNAPSHOTS,))
        conn.commit()
    finally:
        conn.close()


def _read_sync(limit: int, offset: int) -> List[Dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT id, timestamp, ships, alerts_count, zones_count "
            "FROM fleet_snapshots "
            "ORDER BY timestamp ASC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return [
            {
                "snapshot_id":  row["id"],
                "timestamp":    row["timestamp"],
                "ships":        json.loads(row["ships"]),
                "alerts_count": row["alerts_count"],
                "zones_count":  row["zones_count"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def _count_sync() -> int:
    conn = _get_conn()
    try:
        return conn.execute(
            "SELECT COUNT(*) FROM fleet_snapshots"
        ).fetchone()[0]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Async public API — called from FastAPI lifespan / routes
# ---------------------------------------------------------------------------

async def init_db() -> None:
    """Create the SQLite DB and tables (idempotent)."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _init_sync)
    print(f"[history] SQLite database ready  →  {_DB_PATH}")


async def close_db() -> None:
    """No persistent connection to close (per-call pattern)."""
    pass


async def write_snapshot(ships: list, alerts_count: int,
                         zones_count: int) -> None:
    """Persist a single fleet snapshot (non-blocking)."""
    loop = asyncio.get_event_loop()
    ts = datetime.utcnow().isoformat()
    ships_json = json.dumps(ships, default=str)
    await loop.run_in_executor(
        None, _write_sync, ts, ships_json, alerts_count, zones_count
    )


async def get_snapshots(limit: int = 120, offset: int = 0) -> List[Dict]:
    """Retrieve historical snapshots ordered oldest-first."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _read_sync, limit, offset)


async def get_snapshot_count() -> int:
    """Return total number of stored snapshots."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _count_sync)


async def snapshot_loop(get_state_fn: Callable[[], Dict[str, Any]]) -> None:
    """
    Background task: writes a fleet snapshot every SNAPSHOT_INTERVAL seconds.
    Runs until the event loop is cancelled on shutdown.
    """
    while True:
        await asyncio.sleep(_SNAPSHOT_INTERVAL)
        try:
            state = get_state_fn()
            await write_snapshot(
                ships        = state.get("ships", []),
                alerts_count = state.get("alerts_count", 0),
                zones_count  = state.get("zones_count", 0),
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[history] Snapshot loop error: {e}")

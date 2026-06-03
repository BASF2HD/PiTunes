"""SQLite music library cache for browse/search (playback stays on MPD)."""

from .db import get_connection, init_db, db_path
from . import queries
from .scanner import ScanState, start_scan, scan_status

__all__ = [
    "get_connection",
    "init_db",
    "db_path",
    "queries",
    "ScanState",
    "start_scan",
    "scan_status",
]

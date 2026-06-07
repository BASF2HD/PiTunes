import os
import sqlite3
import threading
from pathlib import Path

SCHEMA_VERSION = 5

_local = threading.local()
_init_lock = threading.Lock()
_db_path: Path | None = None


def db_path() -> Path:
    global _db_path
    if _db_path is None:
        default = Path(os.environ.get("ECHOFLOW_CACHE_DIR", "/var/cache/echoflow")) / "library.db"
        _db_path = Path(os.environ.get("ECHOFLOW_LIBRARY_DB", str(default)))
    return _db_path


def get_connection() -> sqlite3.Connection:
    if getattr(_local, "conn", None) is None:
        path = db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA temp_store=MEMORY")
        _local.conn = conn
    return _local.conn


def _migrate_schema(conn, current: int) -> None:
    if current >= SCHEMA_VERSION:
        return
    if current < 3:
        for statement in (
            "ALTER TABLE tracks ADD COLUMN rating INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE albums ADD COLUMN rating INTEGER NOT NULL DEFAULT 0",
        ):
            try:
                conn.execute(statement)
            except Exception:
                pass
        conn.execute("PRAGMA user_version = 3")
        conn.commit()
        current = 3
    if current < 4:
        try:
            conn.execute("ALTER TABLE tracks ADD COLUMN artist TEXT NOT NULL DEFAULT ''")
        except Exception:
            pass
        conn.execute("PRAGMA user_version = 4")
        conn.commit()
        current = 4
    if current < 5:
        try:
            conn.execute("ALTER TABLE tracks ADD COLUMN composer TEXT NOT NULL DEFAULT ''")
        except Exception:
            pass
        conn.execute("PRAGMA user_version = 5")
        conn.commit()


def init_db() -> None:
    with _init_lock:
        conn = get_connection()
        current = conn.execute("PRAGMA user_version").fetchone()[0]
        if current == 0:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS artists (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL COLLATE NOCASE,
                    sort_name TEXT NOT NULL DEFAULT '',
                    UNIQUE(name)
                );

                CREATE TABLE IF NOT EXISTS albums (
                    id INTEGER PRIMARY KEY,
                    title TEXT NOT NULL COLLATE NOCASE,
                    artist_id INTEGER REFERENCES artists(id),
                    album_artist_id INTEGER,
                    year INTEGER,
                    genre TEXT,
                    rating INTEGER NOT NULL DEFAULT 0,
                    track_count INTEGER NOT NULL DEFAULT 0,
                    duration_sec REAL NOT NULL DEFAULT 0,
                    art_path TEXT,
                    art_mtime INTEGER,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS tracks (
                    id INTEGER PRIMARY KEY,
                    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
                    file_path TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL DEFAULT '',
                    artist TEXT NOT NULL DEFAULT '',
                    composer TEXT NOT NULL DEFAULT '',
                    track_number INTEGER,
                    disc_number INTEGER NOT NULL DEFAULT 1,
                    duration_sec REAL NOT NULL DEFAULT 0,
                    rating INTEGER NOT NULL DEFAULT 0,
                    mtime INTEGER NOT NULL,
                    file_size INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS scan_runs (
                    id INTEGER PRIMARY KEY,
                    started_at INTEGER NOT NULL,
                    finished_at INTEGER,
                    files_seen INTEGER NOT NULL DEFAULT 0,
                    files_added INTEGER NOT NULL DEFAULT 0,
                    files_removed INTEGER NOT NULL DEFAULT 0,
                    files_updated INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'running'
                );

                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
                CREATE INDEX IF NOT EXISTS idx_albums_title ON albums(title COLLATE NOCASE);
                CREATE INDEX IF NOT EXISTS idx_albums_year ON albums(year);
                CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
                CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(file_path);

                CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
                    album_title,
                    artist_name,
                    track_title,
                    album_id UNINDEXED,
                    tokenize='unicode61 remove_diacritics 2'
                );
                """
            )
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            conn.commit()
            return
        _migrate_schema(conn, current)


def load_app_settings() -> dict:
    init_db()
    return {
        row["key"]: row["value"]
        for row in get_connection().execute("SELECT key, value FROM app_settings").fetchall()
    }


def save_app_settings(settings: dict) -> None:
    import time

    init_db()
    conn = get_connection()
    now = int(time.time())
    for key, value in settings.items():
        conn.execute(
            """
            INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (str(key), str(value), now),
        )
    conn.commit()


def album_count() -> int:
    init_db()
    conn = get_connection()
    row = conn.execute("SELECT COUNT(*) AS c FROM albums").fetchone()
    return int(row["c"]) if row else 0

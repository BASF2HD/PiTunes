import os
import threading
import time
from pathlib import Path

from . import art_resolver
from .db import get_connection, init_db

try:
    from mutagen import File as MutagenFile
except Exception:
    MutagenFile = None


class ScanState:
    def __init__(self):
        self.lock = threading.Lock()
        self.running = False
        self.progress = 0
        self.message = ""
        self.last_finished_at = 0
        self.last_error = ""

    def to_dict(self):
        with self.lock:
            return {
                "running": self.running,
                "progress": self.progress,
                "message": self.message,
                "lastFinishedAt": self.last_finished_at,
                "lastError": self.last_error,
            }


scan_state = ScanState()

SKIP_SCAN_DIR_NAMES = {"__macosx", ".spotlight-v100", ".trashes", "@eadir"}


def scan_status():
    conn = get_connection()
    row = conn.execute(
        "SELECT id, started_at, finished_at, status, files_seen, files_added, files_removed, files_updated "
        "FROM scan_runs ORDER BY id DESC LIMIT 1"
    ).fetchone()
    payload = scan_state.to_dict()
    if row:
        payload["lastRun"] = dict(row)
    payload["albumCount"] = conn.execute("SELECT COUNT(*) AS c FROM albums").fetchone()["c"]
    return payload


def _parse_tags(path: Path):
    title = path.stem
    artist = "Unknown artist"
    album = "Unknown album"
    album_artist = ""
    year = None
    genre = ""
    track_number = None
    disc_number = 1
    duration = 0.0

    if MutagenFile is not None:
        try:
            audio = MutagenFile(path, easy=True)
            if audio is not None:
                tags = audio.tags or {}
                title = _first_tag(tags, "title") or title
                artist = _first_tag(tags, "artist") or artist
                album = _first_tag(tags, "album") or album
                album_artist = _first_tag(tags, "albumartist") or _first_tag(tags, "album artist") or ""
                genre = _first_tag(tags, "genre") or ""
                year = _parse_year(_first_tag(tags, "date"))
                track_number = _parse_int(_first_tag(tags, "tracknumber"))
                disc_number = _parse_int(_first_tag(tags, "discnumber")) or 1
                duration = float(getattr(audio.info, "length", 0) or 0)
        except Exception:
            pass

    return {
        "title": title,
        "artist": artist,
        "album": album,
        "album_artist": album_artist or artist,
        "year": year,
        "genre": genre,
        "track_number": track_number,
        "disc_number": disc_number,
        "duration": duration,
    }


def _first_tag(tags, key):
    values = tags.get(key)
    if not values:
        return None
    value = values[0] if isinstance(values, list) else values
    return str(value).strip() if value else None


def _parse_year(value):
    if not value:
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if len(digits) >= 4:
        try:
            return int(digits[:4])
        except ValueError:
            return None
    return None


def _parse_int(value):
    if not value:
        return None
    first = str(value).split("/")[0].strip()
    try:
        return int(first)
    except ValueError:
        return None


def _upsert_artist(conn, name):
    name = (name or "Unknown artist").strip() or "Unknown artist"
    conn.execute(
        "INSERT OR IGNORE INTO artists(name, sort_name) VALUES (?, ?)",
        (name, name.lower()),
    )
    row = conn.execute("SELECT id FROM artists WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
    return int(row["id"])


def _get_or_create_album(conn, title, artist_id, album_artist_id, year, genre, now):
    title = (title or "Unknown album").strip() or "Unknown album"
    row = conn.execute(
        "SELECT id FROM albums WHERE title = ? COLLATE NOCASE AND artist_id = ?",
        (title, artist_id),
    ).fetchone()
    if row:
        return int(row["id"])
    conn.execute(
        """
        INSERT INTO albums(title, artist_id, album_artist_id, year, genre, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (title, artist_id, album_artist_id, year, genre or "", now),
    )
    return int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])


def _rebuild_album_stats(conn, album_ids):
    for album_id in album_ids:
        row = conn.execute(
            "SELECT COUNT(*) AS c, COALESCE(SUM(duration_sec), 0) AS d FROM tracks WHERE album_id = ?",
            (album_id,),
        ).fetchone()
        conn.execute(
            "UPDATE albums SET track_count = ?, duration_sec = ? WHERE id = ?",
            (int(row["c"]), float(row["d"]), album_id),
        )


def _rebuild_fts(conn):
    conn.execute("DELETE FROM search_fts")
    conn.execute(
        """
        INSERT INTO search_fts(album_title, artist_name, track_title, album_id)
        SELECT a.title, ar.name, t.title, a.id
        FROM tracks t
        JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = a.artist_id
        """
    )


def _resolve_art_for_album(conn, music_root: Path, album_id: int, prefer_folder: bool):
    row = conn.execute(
        "SELECT file_path FROM tracks WHERE album_id = ? ORDER BY track_number, id LIMIT 1",
        (album_id,),
    ).fetchone()
    if not row:
        return
    track_path = (music_root / row["file_path"]).resolve()
    art = art_resolver.resolve_album_art_file(track_path, music_root, prefer_folder=prefer_folder)
    if art and art.is_file():
        conn.execute(
            "UPDATE albums SET art_path = ?, art_mtime = ? WHERE id = ?",
            (str(art), int(art.stat().st_mtime), album_id),
        )


def run_scan(music_root: Path, prefer_folder: bool = False, trigger_mpd_update: bool = True):
    init_db()
    music_root = music_root.resolve()
    if not music_root.is_dir():
        with scan_state.lock:
            scan_state.last_error = f"Music directory not found: {music_root}"
        return

    with scan_state.lock:
        if scan_state.running:
            return
        scan_state.running = True
        scan_state.progress = 0
        scan_state.message = "Scanning files"
        scan_state.last_error = ""

    conn = get_connection()
    now = int(time.time())
    run_id = None
    files_seen = 0
    files_added = 0
    files_updated = 0
    files_removed = 0
    touched_albums = set()

    try:
        conn.execute(
            "INSERT INTO scan_runs(started_at, status) VALUES (?, 'running')",
            (now,),
        )
        run_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        conn.commit()

        existing = {
            row["file_path"]: (int(row["mtime"]), int(row["file_size"]), int(row["id"]))
            for row in conn.execute("SELECT id, file_path, mtime, file_size FROM tracks").fetchall()
        }
        seen_paths = set()

        for root, dirs, files in os.walk(music_root):
            dirs[:] = [
                name
                for name in dirs
                if not name.startswith(".") and name.casefold() not in SKIP_SCAN_DIR_NAMES
            ]
            audio_files = sorted(
                (name for name in files if art_resolver.is_audio_file(Path(name))),
                key=str.casefold,
            )
            for name in audio_files:
                path = Path(root) / name
                try:
                    rel = path.relative_to(music_root).as_posix()
                    stat = path.stat()
                except (OSError, ValueError):
                    continue

                files_seen += 1
                seen_paths.add(rel)
                mtime = int(stat.st_mtime)
                size = int(stat.st_size)
                prev = existing.get(rel)

                if prev and prev[0] == mtime and prev[1] == size:
                    if files_seen % 200 == 0:
                        with scan_state.lock:
                            scan_state.progress = files_seen
                    continue

                meta = _parse_tags(path)
                artist_id = _upsert_artist(conn, meta["artist"])
                album_artist_id = _upsert_artist(conn, meta["album_artist"])
                album_id = _get_or_create_album(
                    conn,
                    meta["album"],
                    artist_id,
                    album_artist_id,
                    meta["year"],
                    meta["genre"],
                    now,
                )
                touched_albums.add(album_id)

                if prev:
                    conn.execute(
                        """
                        UPDATE tracks SET album_id = ?, title = ?, track_number = ?, disc_number = ?,
                            duration_sec = ?, mtime = ?, file_size = ?
                        WHERE id = ?
                        """,
                        (
                            album_id,
                            meta["title"],
                            meta["track_number"],
                            meta["disc_number"],
                            meta["duration"],
                            mtime,
                            size,
                            prev[2],
                        ),
                    )
                    files_updated += 1
                else:
                    conn.execute(
                        """
                        INSERT INTO tracks(album_id, file_path, title, track_number, disc_number,
                            duration_sec, mtime, file_size)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            album_id,
                            rel,
                            meta["title"],
                            meta["track_number"],
                            meta["disc_number"],
                            meta["duration"],
                            mtime,
                            size,
                        ),
                    )
                    files_added += 1

                if files_seen % 25 == 0:
                    conn.commit()
                    with scan_state.lock:
                        scan_state.progress = files_seen
                        scan_state.message = f"Scanned {files_seen} files"

        stale = [path for path in existing if path not in seen_paths]
        for path in stale:
            row = conn.execute("SELECT album_id FROM tracks WHERE file_path = ?", (path,)).fetchone()
            if row:
                touched_albums.add(int(row["album_id"]))
            conn.execute("DELETE FROM tracks WHERE file_path = ?", (path,))
            files_removed += 1

        conn.execute("DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks)")
        conn.execute("DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM albums WHERE artist_id IS NOT NULL)")
        _rebuild_album_stats(conn, touched_albums or {r["id"] for r in conn.execute("SELECT id FROM albums")})

        with scan_state.lock:
            scan_state.message = "Indexing artwork"
        for row in conn.execute("SELECT id FROM albums").fetchall():
            _resolve_art_for_album(conn, music_root, int(row["id"]), prefer_folder)

        _rebuild_fts(conn)
        conn.execute(
            """
            UPDATE scan_runs SET finished_at = ?, status = 'ok',
                files_seen = ?, files_added = ?, files_removed = ?, files_updated = ?
            WHERE id = ?
            """,
            (int(time.time()), files_seen, files_added, files_removed, files_updated, run_id),
        )
        conn.commit()

        if trigger_mpd_update:
            import subprocess

            try:
                subprocess.run(
                    ["mpc", "-h", os.environ.get("MPD_HOST", "127.0.0.1"), "update"],
                    check=False,
                    timeout=30,
                    capture_output=True,
                )
            except Exception:
                pass

        with scan_state.lock:
            scan_state.last_finished_at = int(time.time())
            scan_state.message = "Scan complete"
    except Exception as exc:
        conn.rollback()
        if run_id:
            conn.execute(
                "UPDATE scan_runs SET finished_at = ?, status = 'error' WHERE id = ?",
                (int(time.time()), run_id),
            )
            conn.commit()
        with scan_state.lock:
            scan_state.last_error = str(exc)
            scan_state.message = "Scan failed"
    finally:
        with scan_state.lock:
            scan_state.running = False
            scan_state.progress = files_seen


def start_scan(music_root: Path, prefer_folder: bool = False):
    thread = threading.Thread(
        target=run_scan,
        args=(music_root, prefer_folder),
        name="echoflow-library-scan",
        daemon=True,
    )
    thread.start()

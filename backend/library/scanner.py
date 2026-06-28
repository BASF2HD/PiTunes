import os
import re
import subprocess
import threading
import time
import contextlib
import wave
from collections import Counter, defaultdict
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
        self.generation = 0
        self.thread = None

    def to_dict(self):
        with self.lock:
            return {
                "running": self.running,
                "progress": self.progress,
                "message": self.message,
                "lastFinishedAt": self.last_finished_at,
                "lastError": self.last_error,
                "generation": self.generation,
            }


scan_state = ScanState()
_playback_priority_until = 0.0


class ScanCancelled(Exception):
    pass


def note_playback_activity(seconds: float = 20.0):
    global _playback_priority_until
    _playback_priority_until = max(_playback_priority_until, time.time() + float(seconds))


def _yield_for_playback():
    if time.time() < _playback_priority_until:
        time.sleep(0.25)

SKIP_SCAN_DIR_NAMES = {"__macosx", ".spotlight-v100", ".trashes", "@eadir", "#recycle", "$recycle.bin"}
UNKNOWN_ALBUM = "Unknown album"
UNKNOWN_ARTIST = "Unknown artist"
VARIOUS_ARTISTS = "Various Artists"
SCAN_COMMIT_ALBUM_INTERVAL = 1
SCAN_FLUSH_FILE_INTERVAL = 25


def _wave_duration(path: Path):
    if path.suffix.lower() not in {".wav", ".wave"}:
        return 0.0
    try:
        with contextlib.closing(wave.open(str(path), "rb")) as audio:
            frame_rate = float(audio.getframerate() or 0)
            if frame_rate > 0:
                return float(audio.getnframes() or 0) / frame_rate
    except Exception:
        pass
    return 0.0


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
    payload["trackCount"] = conn.execute("SELECT COUNT(*) AS c FROM tracks").fetchone()["c"]
    return payload


def mark_interrupted_scans():
    init_db()
    conn = get_connection()
    now = int(time.time())
    conn.execute(
        """
        UPDATE scan_runs
        SET finished_at = ?, status = 'interrupted'
        WHERE finished_at IS NULL AND status = 'running'
        """,
        (now,),
    )
    conn.commit()


def reset_library_index():
    init_db()
    conn = get_connection()
    conn.execute("DELETE FROM search_fts")
    conn.execute("DELETE FROM tracks")
    conn.execute("DELETE FROM albums")
    conn.execute("DELETE FROM artists")
    conn.execute(
        "INSERT OR REPLACE INTO app_settings(key, value, updated_at) VALUES ('library_revision', ?, ?)",
        (str(int(time.time())), int(time.time())),
    )
    conn.commit()


def _frame_text(frame):
    if frame is None:
        return None
    try:
        if hasattr(frame, "text"):
            values = frame.text
            if values:
                return str(values[0]).strip()
        if isinstance(frame, (list, tuple)) and frame:
            return str(frame[0]).strip()
        return str(frame).strip()
    except Exception:
        return None


def _tag_text(tags, *keys):
    if not tags:
        return None
    for key in keys:
        if key in tags:
            value = _frame_text(tags[key])
            if value:
                return value
        value = _first_tag(tags, key)
        if value:
            return value
    return None


def _parse_tags(path: Path):
    title = path.stem
    artist = UNKNOWN_ARTIST
    album = UNKNOWN_ALBUM
    album_artist = ""
    composer = ""
    year = None
    genre = ""
    track_number = None
    disc_number = 1
    duration = 0.0

    if MutagenFile is not None:
        try:
            audio = MutagenFile(path)
            if audio is not None:
                tags = audio.tags or {}
                title = _tag_text(tags, "title", "TIT2", "TITLE") or title
                singer = _tag_text(tags, "artist", "TPE1", "singer", "Singer", "performer", "PERFORMER", "ARTIST")
                if singer:
                    artist = singer
                album = _tag_text(tags, "album", "TALB", "ALBUM") or album
                album_artist = _tag_text(tags, "albumartist", "album artist", "TPE2", "ALBUMARTIST") or ""
                composer = _tag_text(tags, "composer", "TCOM", "COMPOSER") or ""
                genre = _tag_text(tags, "genre", "TCON", "GENRE") or ""
                year = _parse_year(_tag_text(tags, "date", "TDRC", "DATE", "YEAR"))
                track_number = _parse_int(_tag_text(tags, "tracknumber", "TRCK", "TRACKNUMBER"))
                disc_number = _parse_int(_tag_text(tags, "discnumber", "TPOS", "DISCNUMBER")) or 1
                duration = float(getattr(audio.info, "length", 0) or 0)
        except Exception:
            pass

    if duration <= 0:
        duration = _wave_duration(path)

    track_artist = artist if artist != UNKNOWN_ARTIST else ""
    return {
        "title": title,
        "artist": track_artist,
        "composer": composer,
        "album": album,
        "album_artist": album_artist,
        "has_album_artist": bool(album_artist),
        "year": year,
        "genre": genre,
        "track_number": track_number,
        "disc_number": disc_number,
        "duration": duration,
    }


def _is_audio_scan_file(name):
    if name.startswith(".") or name.startswith("._"):
        return False
    return art_resolver.is_audio_file(Path(name))


def _folder_album_title(folder_name):
    title = re.sub(r"\s*\[[^\]]+\]", "", folder_name)
    title = re.sub(
        r"\s*\([^)]*\b(?:tamil|acd|cdrip|wav|flac|mp3|records?|music|pyramid|suruthi|alai osai|aditya)[^)]*\)",
        "",
        title,
        flags=re.I,
    )
    title = re.sub(r"\s+", " ", title).strip(" -_")
    return title or folder_name.strip() or UNKNOWN_ALBUM


def _folder_year(folder_name):
    match = re.search(r"(?:19|20)\d{2}", folder_name)
    return int(match.group(0)) if match else None


def _most_common(values, fallback=""):
    cleaned = [str(value).strip() for value in values if str(value or "").strip()]
    if not cleaned:
        return fallback
    return Counter(cleaned).most_common(1)[0][0]


def _folder_album_metadata(folder_name, parsed_files):
    albums = [item["meta"]["album"] for item in parsed_files if item["meta"]["album"] != UNKNOWN_ALBUM]
    explicit_album_artists = [
        item["meta"]["album_artist"]
        for item in parsed_files
        if item["meta"].get("has_album_artist") and item["meta"]["album_artist"]
    ]
    artists = [
        item["meta"]["artist"]
        for item in parsed_files
        if item["meta"]["artist"]
    ]
    years = [item["meta"]["year"] for item in parsed_files if item["meta"]["year"]]
    genres = [item["meta"]["genre"] for item in parsed_files if item["meta"]["genre"]]

    title = _most_common(albums) or _folder_album_title(folder_name)
    album_artist = _most_common(explicit_album_artists)
    if not album_artist:
        unique_artists = {artist.casefold(): artist for artist in artists}
        album_artist = next(iter(unique_artists.values())) if len(unique_artists) == 1 else VARIOUS_ARTISTS

    display_artist = album_artist or _most_common(artists, UNKNOWN_ARTIST)
    return {
        "title": title,
        "artist": display_artist,
        "album_artist": album_artist or display_artist,
        "year": _most_common(years) or _folder_year(folder_name),
        "genre": _most_common(genres),
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
        "SELECT id FROM albums WHERE title = ? COLLATE NOCASE ORDER BY id LIMIT 1",
        (title,),
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


def _start_mpd_update():
    try:
        subprocess.Popen(
            ["mpc", "-h", os.environ.get("MPD_HOST", "127.0.0.1"), "update"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def _index_album_folder(conn, music_root: Path, folder: str, items, now: int, prefer_folder: bool):
    if not items:
        return None, 0, 0

    folder_name = Path(folder).name if folder != "." else music_root.name
    album_meta = _folder_album_metadata(folder_name, items)
    artist_id = _upsert_artist(conn, album_meta["artist"])
    album_artist_id = _upsert_artist(conn, album_meta["album_artist"])
    album_id = _get_or_create_album(
        conn,
        album_meta["title"],
        artist_id,
        album_artist_id,
        album_meta["year"],
        album_meta["genre"],
        now,
    )

    files_added = 0
    files_updated = 0
    for item in items:
        meta = item["meta"]
        prev = item["prev"]
        unchanged = (
            prev
            and prev[0] == item["mtime"]
            and prev[1] == item["size"]
            and prev[3] == album_id
            and prev[4] == (meta["artist"] or "")
            and prev[5] == (meta["composer"] or "")
        )

        if unchanged:
            continue

        if prev:
            conn.execute(
                """
                UPDATE tracks SET album_id = ?, title = ?, artist = ?, composer = ?, track_number = ?, disc_number = ?,
                    duration_sec = ?, mtime = ?, file_size = ?
                WHERE id = ?
                """,
                (
                    album_id,
                    meta["title"],
                    meta["artist"] or "",
                    meta["composer"] or "",
                    meta["track_number"],
                    meta["disc_number"],
                    meta["duration"],
                    item["mtime"],
                    item["size"],
                    prev[2],
                ),
            )
            files_updated += 1
        else:
            conn.execute(
                """
                INSERT INTO tracks(album_id, file_path, title, artist, composer, track_number, disc_number,
                    duration_sec, mtime, file_size)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    album_id,
                    item["rel"],
                    meta["title"],
                    meta["artist"] or "",
                    meta["composer"] or "",
                    meta["track_number"],
                    meta["disc_number"],
                    meta["duration"],
                    item["mtime"],
                    item["size"],
                ),
            )
            files_added += 1

    _rebuild_album_stats(conn, {album_id})
    _resolve_art_for_album(conn, music_root, album_id, prefer_folder)
    return album_id, files_added, files_updated


def run_scan(music_root: Path, prefer_folder: bool = False, trigger_mpd_update: bool = False, generation: int | None = None):
    init_db()
    music_root = music_root.resolve()
    if not music_root.is_dir():
        with scan_state.lock:
            scan_state.last_error = f"Music directory not found: {music_root}"
        return

    if generation is None:
        with scan_state.lock:
            generation = scan_state.generation

    def check_cancelled():
        with scan_state.lock:
            if generation != scan_state.generation:
                raise ScanCancelled()

    with scan_state.lock:
        if generation != scan_state.generation:
            return
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
        if trigger_mpd_update:
            _start_mpd_update()

        existing = {
            row["file_path"]: (
                int(row["mtime"]),
                int(row["file_size"]),
                int(row["id"]),
                int(row["album_id"]),
                row["artist"] or "",
                row["composer"] or "",
            )
            for row in conn.execute(
                "SELECT id, album_id, file_path, mtime, file_size, artist, composer FROM tracks"
            ).fetchall()
        }
        seen_paths = set()
        albums_indexed = 0

        def flush_album_items(folder, items):
            nonlocal albums_indexed, files_added, files_updated
            if not items:
                return
            check_cancelled()
            _yield_for_playback()
            album_id, added, updated = _index_album_folder(
                conn,
                music_root,
                folder,
                items,
                now,
                prefer_folder,
            )
            if album_id:
                touched_albums.add(album_id)
                albums_indexed += 1
            files_added += added
            files_updated += updated
            if albums_indexed % SCAN_COMMIT_ALBUM_INTERVAL == 0:
                check_cancelled()
                conn.commit()
                with scan_state.lock:
                    if generation == scan_state.generation:
                        scan_state.progress = files_seen
                        scan_state.message = f"Scanned {files_seen} files, indexed {albums_indexed} albums"

        for root, dirs, files in os.walk(music_root):
            check_cancelled()
            dirs[:] = [
                name
                for name in dirs
                if not name.startswith(".") and name.casefold() not in SKIP_SCAN_DIR_NAMES
            ]
            audio_files = sorted(
                (name for name in files if _is_audio_scan_file(name)),
                key=str.casefold,
            )
            folder = Path(root).relative_to(music_root).as_posix()
            folder_groups = defaultdict(list)
            pending_folder_items = 0
            for name in audio_files:
                check_cancelled()
                _yield_for_playback()
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
                with scan_state.lock:
                    if generation == scan_state.generation:
                        scan_state.progress = files_seen
                        scan_state.message = f"Scanning files ({files_seen} seen)"
                if files_seen % SCAN_FLUSH_FILE_INTERVAL == 0:
                    with scan_state.lock:
                        if generation == scan_state.generation:
                            scan_state.progress = files_seen
                            scan_state.message = f"Scanning files ({files_seen} seen)"

                meta = _parse_tags(path)
                album_key = (
                    str(meta.get("album") or UNKNOWN_ALBUM).casefold(),
                    str(meta.get("album_artist") if meta.get("has_album_artist") else "").casefold(),
                )
                folder_groups[album_key].append({
                    "rel": rel,
                    "mtime": mtime,
                    "size": size,
                    "prev": prev,
                    "meta": meta,
                })
                pending_folder_items += 1
                if len(folder_groups[album_key]) >= SCAN_FLUSH_FILE_INTERVAL:
                    flush_album_items(folder, folder_groups[album_key])
                    folder_groups[album_key] = []
                    pending_folder_items = sum(len(items) for items in folder_groups.values())
                elif pending_folder_items >= SCAN_FLUSH_FILE_INTERVAL:
                    for items in folder_groups.values():
                        flush_album_items(folder, items)
                    folder_groups.clear()
                    pending_folder_items = 0

                if files_seen % 200 == 0:
                    with scan_state.lock:
                        if generation == scan_state.generation:
                            scan_state.progress = files_seen

            for items in folder_groups.values():
                flush_album_items(folder, items)

        check_cancelled()
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
            scan_state.message = "Finalizing search index"
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
            if generation == scan_state.generation:
                scan_state.last_finished_at = int(time.time())
                scan_state.message = "Scan complete"
    except ScanCancelled:
        conn.rollback()
        if run_id:
            conn.execute(
                "UPDATE scan_runs SET finished_at = ?, status = 'cancelled' WHERE id = ?",
                (int(time.time()), run_id),
            )
            conn.commit()
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
            if generation == scan_state.generation:
                scan_state.progress = files_seen


def _scan_worker(previous_thread, music_root: Path, prefer_folder: bool, generation: int, reset_library: bool):
    if previous_thread and previous_thread.is_alive():
        with scan_state.lock:
            if generation == scan_state.generation:
                scan_state.message = "Waiting for previous scan to stop"
        previous_thread.join()
    with scan_state.lock:
        if generation != scan_state.generation:
            return
    if reset_library:
        reset_library_index()
        with scan_state.lock:
            if generation == scan_state.generation:
                scan_state.progress = 0
                scan_state.message = "Library cleared; scanning selected source"
    run_scan(music_root, prefer_folder, generation=generation)


def start_scan(music_root: Path, prefer_folder: bool = False, reset_library: bool = False, force_restart: bool = False):
    previous_thread = None
    with scan_state.lock:
        if scan_state.running and not force_restart:
            return False
        if force_restart:
            scan_state.generation += 1
            scan_state.message = "Switching music source"
            previous_thread = scan_state.thread
        generation = scan_state.generation

    thread = threading.Thread(
        target=_scan_worker,
        args=(previous_thread, music_root, prefer_folder, generation, reset_library),
        name="pitunes-library-scan",
        daemon=True,
    )
    with scan_state.lock:
        scan_state.thread = thread
    thread.start()
    return True

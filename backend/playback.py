"""SQLite-backed MPD playback: fast-start queues and continuous album browse."""

from __future__ import annotations

import json
import logging
import socket
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

from library import queries as lib_queries
from library import ui_context as lib_ui_context
from library import userdata as lib_userdata
from library.db import get_connection
from library.scanner import note_playback_activity
from mpd_client import mpd
from shared import ApiError, MPD_HOST, MPD_PORT, MUSIC_DIR, SETTINGS_FILE, mpd_quote

SYNC_QUEUE_HEAD = 0

PLAYBACK_LOG_FILE = Path("/var/log/pitunes/playback.log")
_logger = logging.getLogger("pitunes.playback")


def _ensure_playback_logger() -> None:
    if _logger.handlers:
        return
    try:
        PLAYBACK_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(PLAYBACK_LOG_FILE, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        _logger.addHandler(handler)
        _logger.setLevel(logging.INFO)
    except Exception:
        stream = logging.StreamHandler()
        stream.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        _logger.addHandler(stream)
        _logger.setLevel(logging.INFO)


def log_playback(event: str, **fields: Any) -> None:
    _ensure_playback_logger()
    payload = " ".join(f"{key}={value!r}" for key, value in fields.items())
    message = f"{event} {payload}".strip()
    _logger.info(message)


def _forward_queue_from_target(uris: list[str], target: str) -> list[str]:
    target = _normalize_uri(target)
    normalized = [_normalize_uri(item) for item in uris if _normalize_uri(item)]
    if not normalized:
        return [target] if target else []
    if target not in normalized:
        return [target, *normalized] if target else normalized
    return normalized[normalized.index(target) :]

_play_lock = threading.Lock()
_play_context: dict[str, Any] = {
    "continuous": False,
    "album_id": "",
    "entry_id": "",
}

_mpd_append_lock = threading.Lock()
_mpd_append_generation = 0


def _normalize_uri(uri: str) -> str:
    return str(uri or "").strip().replace("\\", "/")


def pitunes_stream_url(uri: str, listen_port: int) -> str:
    return f"http://127.0.0.1:{listen_port}/api/stream?file={quote(_normalize_uri(uri))}"


def _music_root() -> Path:
    try:
        settings = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        return Path(settings.get("music_directory") or str(MUSIC_DIR))
    except Exception:
        return MUSIC_DIR


def _file_exists_in_library(uri: str) -> bool:
    path = _music_root() / _normalize_uri(uri)
    return path.is_file()


def set_play_context(
    *,
    continuous: bool,
    album_id: str = "",
    entry_id: str = "",
) -> None:
    with _play_lock:
        _play_context["continuous"] = bool(continuous)
        _play_context["album_id"] = str(album_id or "").strip()
        _play_context["entry_id"] = str(entry_id or "").strip()


def clear_continuous_playback() -> None:
    with _play_lock:
        _play_context["continuous"] = False


def _cancel_mpd_append_queue() -> int:
    global _mpd_append_generation
    with _mpd_append_lock:
        _mpd_append_generation += 1
        return _mpd_append_generation


def mpd_add_uri(uri: str, *, listen_port: int = 8080) -> str:
    uri = _normalize_uri(uri)
    if not uri:
        raise ApiError(400, "MPD queue entry is empty")

    if uri.startswith("http://") or uri.startswith("https://"):
        mpd.command("add " + mpd_quote(uri))
        return uri

    candidates: list[str] = []
    if _file_exists_in_library(uri):
        candidates.append(uri)
    else:
        candidates.append(uri)
        candidates.append(pitunes_stream_url(uri, listen_port))

    last_error = None
    for candidate in candidates:
        try:
            mpd.command("add " + mpd_quote(candidate))
            return candidate
        except ApiError as exc:
            last_error = exc
            if "No such" not in str(exc):
                raise
    raise last_error or ApiError(502, "MPD could not add track")


def album_track_uris(album_id_or_name: str) -> list[str]:
    raw = str(album_id_or_name or "").strip()
    if not raw.isdigit():
        return []
    tracks = lib_queries.album_tracks(int(raw)).get("tracks") or []
    uris: list[str] = []
    for track in tracks:
        uri = _normalize_uri(track.get("file") or track.get("id"))
        if uri:
            uris.append(uri)
    return uris


def _browse_sort_key(sort: str) -> str:
    value = (sort or "title").strip().lower()
    if value in ("year-asc", "year-desc", "title", "artist", "rating", "highest", "toprated"):
        return value
    return "title"


def _browse_filters_from_context(ctx: dict[str, Any]) -> dict[str, Any]:
    mode = str(ctx.get("mode") or "album").strip().lower()
    filters: dict[str, Any] = {"sort": _browse_sort_key(str(ctx.get("albumBrowseSort") or "title"))}

    if mode == "artist":
        artist = str(ctx.get("selectedArtist") or "").strip()
        if artist:
            filters["artist_filter"] = artist
    elif mode == "composer":
        composer = str(ctx.get("selectedComposer") or "").strip()
        if composer:
            filters["composer_filter"] = composer
    elif mode == "genre":
        genre = str(ctx.get("selectedGenre") or "").strip()
        if genre:
            filters["genre_filter"] = genre
    elif mode == "year":
        year = str(ctx.get("selectedYear") or "").strip()
        if year.isdigit():
            filters["year_filter"] = int(year)
    elif mode in ("rating", "toprated"):
        filters["toprated"] = True
        filters["sort"] = "rating"
    elif mode == "album":
        scope = str(ctx.get("albumBrowseScope") or "all").strip().lower()
        if scope == "favourite":
            album_ids = [int(value) for value in lib_userdata.favourite_albums() if str(value).isdigit()]
            if album_ids:
                filters["album_ids"] = album_ids
    return filters


def next_album_id_after(current_album_id: str, ctx: dict[str, Any] | None = None) -> str:
    ctx = ctx or lib_ui_context.get()
    current = str(current_album_id or ctx.get("entryId") or "").strip()
    if not current.isdigit():
        return ""

    filters = _browse_filters_from_context(ctx)
    sort = filters.pop("sort", "title")
    result = lib_queries.list_albums(limit=50000, offset=0, sort=sort, **filters)
    album_ids = [str(item.get("id") or "") for item in result.get("albums") or []]
    album_ids = [item for item in album_ids if item.isdigit()]
    if current not in album_ids:
        return ""
    index = album_ids.index(current)
    if index + 1 >= len(album_ids):
        return ""
    return album_ids[index + 1]


def _mpd_append_uris_async(uris: list[str], *, listen_port: int = 8080) -> None:
    with _mpd_append_lock:
        generation = _mpd_append_generation

    def worker() -> None:
        for item in uris:
            with _mpd_append_lock:
                if generation != _mpd_append_generation:
                    return
            uri = _normalize_uri(item)
            if not uri:
                continue
            try:
                mpd_add_uri(uri, listen_port=listen_port)
            except Exception:
                pass

    thread = threading.Thread(target=worker, name="pitunes-mpd-queue-append", daemon=True)
    thread.start()


def play_queue_fast(
    *,
    target_uri: str,
    queue: list[str],
    album_id: str = "",
    entry_id: str = "",
    continuous: bool = True,
    listen_port: int = 8080,
) -> None:
    note_playback_activity()
    target = _normalize_uri(target_uri)
    uris = [_normalize_uri(item) for item in queue if _normalize_uri(item)]
    if not target:
        raise ApiError(400, "file is required")
    if not uris:
        uris = album_track_uris(str(album_id or entry_id or ""))
    if not uris:
        uris = [target]
    forward = _forward_queue_from_target(uris, target)
    if not forward:
        raise ApiError(400, "queue has no playable files")

    resolved_album_id = str(entry_id or album_id or "").strip()
    if not resolved_album_id.isdigit():
        resolved_album_id = str(album_id or "").strip()
    if not resolved_album_id.isdigit():
        row = get_connection().execute(
            "SELECT album_id FROM tracks WHERE file_path = ? LIMIT 1",
            (target,),
        ).fetchone()
        if row:
            resolved_album_id = str(int(row["album_id"]))

    set_play_context(
        continuous=bool(continuous) and bool(resolved_album_id),
        album_id=resolved_album_id,
        entry_id=str(entry_id or resolved_album_id),
    )

    _cancel_mpd_append_queue()
    mpd.command("clear")
    mpd_add_uri(forward[0], listen_port=listen_port)
    mpd.command("play 0")

    remaining = forward[1:]
    sync_batch = remaining[:SYNC_QUEUE_HEAD]
    async_batch = remaining[SYNC_QUEUE_HEAD:]
    for item in sync_batch:
        try:
            mpd_add_uri(item, listen_port=listen_port)
        except Exception:
            pass
    if async_batch:
        _mpd_append_uris_async(async_batch, listen_port=listen_port)

    log_playback(
        "play_queue_fast",
        album_id=resolved_album_id,
        target=target,
        queue_len=len(forward),
        continuous=bool(continuous) and bool(resolved_album_id),
    )
    lib_ui_context.publish_playback("album", albumBrowseScope="all", playbackKey=target, entryId=resolved_album_id)


def append_album_and_play(album_id: str, *, listen_port: int = 8080) -> bool:
    uris = album_track_uris(album_id)
    if not uris:
        return False

    first = uris[0]
    rest = uris[1:]
    _cancel_mpd_append_queue()
    mpd.command("clear")
    try:
        mpd_add_uri(first, listen_port=listen_port)
    except Exception as exc:
        log_playback("append_album_fail", album_id=album_id, error=str(exc), stage="first")
        return False

    mpd.command("play 0")

    sync_batch = rest[:SYNC_QUEUE_HEAD]
    async_batch = rest[SYNC_QUEUE_HEAD:]
    for item in sync_batch:
        try:
            mpd_add_uri(item, listen_port=listen_port)
        except Exception:
            pass
    if async_batch:
        _mpd_append_uris_async(async_batch, listen_port=listen_port)

    album = lib_queries.album_by_id(int(album_id))
    title = (album or {}).get("title") or album_id
    lib_ui_context.publish_playback(
        "album",
        albumBrowseScope="all",
        playbackKey=first,
        entryId=str(album_id),
        entryTitle=str(title),
    )
    log_playback(
        "append_album_and_play",
        album_id=album_id,
        track_count=len(uris),
        first=first,
    )
    set_play_context(continuous=True, album_id=str(album_id), entry_id=str(album_id))
    note_playback_activity()
    return True


def _status_int(status: dict[str, str], key: str, default: int = 0) -> int:
    value = str(status.get(key) or default).strip()
    if value.lstrip("-").isdigit():
        return int(value)
    return default


def _status_float(status: dict[str, str], key: str, default: float = 0.0) -> float:
    try:
        return float(status.get(key) or default)
    except (TypeError, ValueError):
        return default


_continue_lock = threading.Lock()
_last_continue_at = 0.0


def maybe_continue_next_album(*, listen_port: int = 8080) -> bool:
    global _last_continue_at
    now = time.time()
    if now - _last_continue_at < 2.0:
        return False
    if not _continue_lock.acquire(blocking=False):
        return False
    try:
        if time.time() - _last_continue_at < 2.0:
            return False
        with _play_lock:
            if not _play_context.get("continuous"):
                log_playback("continue_skip", reason="continuous_off")
                return False
            current_album_id = str(_play_context.get("album_id") or "").strip()

        status = mpd.single_map("status")
        state = str(status.get("state") or "stop").lower()
        if state not in ("stop", "ended"):
            return False

        playlist_length = _status_int(status, "playlistlength")
        if playlist_length <= 0:
            log_playback("continue_skip", reason="empty_playlist", album_id=current_album_id)
            return False

        song_raw = status.get("song")
        if song_raw is None or str(song_raw).strip() == "":
            at_queue_end = True
        else:
            song_pos = _status_int(status, "song")
            at_queue_end = song_pos >= max(0, playlist_length - 1)
        if not at_queue_end:
            log_playback(
                "continue_skip",
                reason="not_queue_end",
                album_id=current_album_id,
                song=song_raw,
                playlist_length=playlist_length,
            )
            return False
        if state == "play":
            elapsed = _status_float(status, "elapsed")
            duration = _status_float(status, "duration")
            near_track_end = duration <= 3 or elapsed >= max(0.0, duration - 2.0)
            if not near_track_end:
                return False

        ctx = lib_ui_context.get()
        next_album_id = next_album_id_after(current_album_id, ctx)
        if not next_album_id:
            log_playback("continue_stop", reason="no_next_album", album_id=current_album_id)
            clear_continuous_playback()
            return False

        if not append_album_and_play(next_album_id, listen_port=listen_port):
            log_playback(
                "continue_fail",
                reason="append_failed",
                album_id=current_album_id,
                next_album_id=next_album_id,
            )
            return False
        _last_continue_at = time.time()
        log_playback(
            "continue_ok",
            album_id=current_album_id,
            next_album_id=next_album_id,
            playlist_length=playlist_length,
        )
        return True
    except Exception as exc:
        log_playback("continue_error", error=str(exc))
        return False
    finally:
        _continue_lock.release()


class MPDIdleWatcher(threading.Thread):
    """Listen for MPD player/playlist changes and continue album browse playback."""

    def __init__(self, listen_port: int = 8080):
        super().__init__(name="pitunes-mpd-idle", daemon=True)
        self.listen_port = listen_port
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                self._idle_once()
            except Exception:
                time.sleep(2.0)

    def _idle_once(self) -> None:
        sock = socket.create_connection((MPD_HOST, MPD_PORT), 5)
        fh = sock.makefile("rwb", buffering=0)
        try:
            greeting = fh.readline().decode("utf-8", errors="replace").strip()
            if not greeting.startswith("OK MPD"):
                return
            fh.write(b"idle player playlist\n")
            while not self._stop.is_set():
                raw = fh.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").strip()
                if not line.startswith("changed: "):
                    continue
                sock.settimeout(0.05)
                try:
                    while True:
                        extra = fh.readline()
                        if not extra:
                            break
                        extra_line = extra.decode("utf-8", errors="replace").strip()
                        if not extra_line.startswith("changed: "):
                            break
                except OSError:
                    pass
                finally:
                    sock.settimeout(None)
                fh.write(b"noidle\n")
                self._consume_until_ok(fh)
                maybe_continue_next_album(listen_port=self.listen_port)
                return
        finally:
            try:
                fh.write(b"close\n")
            except Exception:
                pass
            sock.close()

    @staticmethod
    def _consume_until_ok(fh) -> None:
        while True:
            raw = fh.readline()
            if not raw:
                break
            line = raw.decode("utf-8", errors="replace").strip()
            if line == "OK":
                break


class ContinuousPlaybackPoller(threading.Thread):
    """Backup poll for album-to-album continue when MPD idle events are missed."""

    def __init__(self, listen_port: int = 8080):
        super().__init__(name="pitunes-playback-poll", daemon=True)
        self.listen_port = listen_port
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        while not self._stop.is_set():
            self._stop.wait(1.5)
            if self._stop.is_set():
                break
            with _play_lock:
                if not _play_context.get("continuous"):
                    continue
            maybe_continue_next_album(listen_port=self.listen_port)


_idle_watcher: MPDIdleWatcher | None = None
_poll_thread: ContinuousPlaybackPoller | None = None


def start_mpd_idle_watcher(listen_port: int = 8080) -> None:
    global _idle_watcher, _poll_thread
    if _idle_watcher and _idle_watcher.is_alive():
        return
    _idle_watcher = MPDIdleWatcher(listen_port=listen_port)
    _idle_watcher.start()
    if not (_poll_thread and _poll_thread.is_alive()):
        _poll_thread = ContinuousPlaybackPoller(listen_port=listen_port)
        _poll_thread.start()

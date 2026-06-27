"""Shared UI browse context for multi-client sync (browser + touchscreen)."""

from __future__ import annotations

import json
import threading
import time
from copy import deepcopy
from typing import Any

from shared import CACHE_DIR

_LOCK = threading.Lock()
_CONTEXT_FILE = CACHE_DIR / "ui-context.json"
_DEFAULT: dict[str, Any] = {
    "revision": 0,
    "mode": "album",
    "albumBrowseScope": "all",
    "albumBrowseSort": "year-desc",
    "artistBrowseSort": "year-desc",
    "songsBrowseScope": "all",
    "songsDisplayMode": "album",
    "songsBrowseSort": "year-desc",
    "playlistBrowseSort": "year-desc",
    "radioScope": "all",
    "playlistDisplayMode": "album",
    "albumFilter": "",
    "selectedArtist": "",
    "selectedComposer": "",
    "selectedGenre": "",
    "selectedYear": "",
    "activePlaylistId": "",
    "activeSmartPlaylistId": "",
    "browseIndex": 0,
    "entryId": "",
    "entryTitle": "",
    "inputSource": "local",
    "playbackKind": "",
    "playbackKey": "",
    "playing": False,
}


def _sanitize(payload: dict[str, Any]) -> dict[str, Any]:
    clean = deepcopy(_DEFAULT)
    for key in clean:
        if key not in payload:
            continue
        value = payload[key]
        if key == "revision":
            try:
                clean[key] = int(value)
            except (TypeError, ValueError):
                pass
            continue
        if key in ("browseIndex",):
            try:
                clean[key] = int(value)
            except (TypeError, ValueError):
                pass
            continue
        if key == "playing":
            clean[key] = bool(value)
            continue
        if isinstance(value, (int, float)) and key == "browseIndex":
            clean[key] = int(value)
            continue
        clean[key] = "" if value is None else str(value)
    return clean


def _load_unlocked() -> dict[str, Any]:
    if not _CONTEXT_FILE.exists():
        return deepcopy(_DEFAULT)
    try:
        data = json.loads(_CONTEXT_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return _sanitize(data)
    except Exception:
        pass
    return deepcopy(_DEFAULT)


def _save_unlocked(data: dict[str, Any]) -> None:
    _CONTEXT_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CONTEXT_FILE.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def get() -> dict[str, Any]:
    with _LOCK:
        return _load_unlocked()


def publish(payload: dict[str, Any] | None) -> dict[str, Any]:
    payload = payload or {}
    with _LOCK:
        current = _load_unlocked()
        incoming_revision = payload.get("revision")
        try:
            incoming_revision = int(incoming_revision)
        except (TypeError, ValueError):
            incoming_revision = 0
        revision = max(incoming_revision, int(time.time() * 1000))
        if revision <= int(current.get("revision") or 0):
            revision = int(time.time() * 1000)
            if revision <= int(current.get("revision") or 0):
                revision = int(current.get("revision") or 0) + 1
        merged = _sanitize({**current, **payload, "revision": revision})
        _save_unlocked(merged)
        return merged


def publish_playback(mode: str, **extra: Any) -> dict[str, Any]:
    kind = str(mode or "album")
    source = "radio" if kind == "radio" else "local"
    payload = {
        "mode": kind,
        "playbackKind": kind,
        "inputSource": source,
        "playing": True,
        **extra,
    }
    return publish(payload)

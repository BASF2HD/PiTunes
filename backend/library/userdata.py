"""User favourites, playlists, and internet radio stations (JSON persistence)."""

from __future__ import annotations

import json
import threading
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any

from shared import CONFIG_DIR

_LOCK = threading.Lock()
_USERDATA_FILE = CONFIG_DIR / "userdata.json"
_SEED_FILE = Path(__file__).resolve().parents[2] / "config" / "radio-stations.seed.json"

_DEFAULT: dict[str, Any] = {
    "favouriteTracks": [],
    "favouriteAlbums": [],
    "playlists": [],
    "radioStations": [],
}


def _empty_store() -> dict[str, Any]:
    return deepcopy(_DEFAULT)


def _load_unlocked() -> dict[str, Any]:
    if not _USERDATA_FILE.exists():
        store = _empty_store()
        _seed_radio_stations(store)
        return store
    try:
        data = json.loads(_USERDATA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = _empty_store()
    for key, value in _DEFAULT.items():
        data.setdefault(key, deepcopy(value))
    if not data.get("radioStations"):
        _seed_radio_stations(data)
    return data


def _seed_radio_stations(store: dict[str, Any]) -> None:
    if store.get("radioStations"):
        return
    if not _SEED_FILE.exists():
        return
    try:
        payload = json.loads(_SEED_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    stations = []
    for item in payload.get("stations") or []:
        station = _normalize_station(item, source="seed")
        if station:
            stations.append(station)
    store["radioStations"] = stations


def _save_unlocked(store: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _USERDATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(store, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(_USERDATA_FILE)


def _with_store(mutator):
    with _LOCK:
        store = _load_unlocked()
        result = mutator(store)
        _save_unlocked(store)
        return result


def _station_id() -> str:
    return uuid.uuid4().hex


def _sanitize_favicon(value: Any) -> str:
    raw = str(value or "").strip()
    if raw.startswith(("http://", "https://")):
        return raw
    return ""


def _normalize_station(item: dict[str, Any], source: str = "manual") -> dict[str, Any] | None:
    url = str(item.get("url") or item.get("streamUrl") or "").strip()
    name = str(item.get("name") or "").strip()
    if not url or not name:
        return None
    if not url.startswith(("http://", "https://")):
        return None
    tags = item.get("tags") or item.get("genre") or ""
    if isinstance(tags, list):
        tags = ", ".join(str(tag) for tag in tags if tag)
    return {
        "id": str(item.get("id") or _station_id()),
        "name": name,
        "url": url,
        "homepage": str(item.get("homepage") or ""),
        "favicon": _sanitize_favicon(item.get("favicon") or item.get("favicon_url") or item.get("artUrl")),
        "country": str(item.get("country") or item.get("countrycode") or ""),
        "tags": str(tags),
        "source": str(item.get("source") or source),
        "externalUuid": str(item.get("externalUuid") or item.get("stationuuid") or ""),
        "favourite": bool(item.get("favourite")),
        "sortOrder": int(item.get("sortOrder") or 0),
    }


def _public_station(station: dict[str, Any]) -> dict[str, Any]:
    tags = station.get("tags") or ""
    return {
        "id": station["id"],
        "name": station["name"],
        "url": station["url"],
        "streamUrl": station["url"],
        "homepage": station.get("homepage") or "",
        "country": station.get("country") or "",
        "genre": tags,
        "tags": tags,
        "artUrl": _sanitize_favicon(station.get("favicon")),
        "favicon": _sanitize_favicon(station.get("favicon")),
        "favourite": bool(station.get("favourite")),
        "source": station.get("source") or "manual",
        "externalUuid": station.get("externalUuid") or "",
    }


def favourite_tracks() -> set[str]:
    store = _load_unlocked()
    return {str(value) for value in store.get("favouriteTracks") or [] if value}


def favourite_albums() -> set[str]:
    store = _load_unlocked()
    return {str(value) for value in store.get("favouriteAlbums") or [] if value}


def set_favourite_track(track_id: str, starred: bool) -> None:
    track_id = str(track_id or "").strip()
    if not track_id:
        return

    def mutate(store):
        tracks = [str(value) for value in store.get("favouriteTracks") or []]
        if starred:
            if track_id not in tracks:
                tracks.append(track_id)
        else:
            tracks = [value for value in tracks if value != track_id]
        store["favouriteTracks"] = tracks

    _with_store(mutate)


def set_favourite_album(album_id: str, starred: bool) -> None:
    album_id = str(album_id or "").strip()
    if not album_id:
        return

    def mutate(store):
        albums = [str(value) for value in store.get("favouriteAlbums") or []]
        if starred:
            if album_id not in albums:
                albums.append(album_id)
        else:
            albums = [value for value in albums if value != album_id]
        store["favouriteAlbums"] = albums

    _with_store(mutate)


def list_playlists() -> list[dict[str, Any]]:
    store = _load_unlocked()
    return deepcopy(store.get("playlists") or [])


def create_playlist(name: str) -> dict[str, Any]:
    playlist = {"id": _station_id(), "name": name.strip(), "trackIds": []}

    def mutate(store):
        store.setdefault("playlists", []).append(playlist)
        return playlist

    return _with_store(mutate)


def add_track_to_playlist(playlist_id: str, track_id: str) -> dict[str, Any] | None:
    playlist_id = str(playlist_id or "").strip()
    track_id = str(track_id or "").strip()
    if not playlist_id or not track_id:
        return None

    def mutate(store):
        for playlist in store.get("playlists") or []:
            if playlist.get("id") != playlist_id:
                continue
            track_ids = list(playlist.get("trackIds") or [])
            if track_id not in track_ids:
                track_ids.append(track_id)
            playlist["trackIds"] = track_ids
            return deepcopy(playlist)
        return None

    return _with_store(mutate)


def list_radio_stations(scope: str = "all") -> list[dict[str, Any]]:
    store = _load_unlocked()
    stations = [_public_station(item) for item in store.get("radioStations") or []]
    stations.sort(key=lambda item: (not item.get("favourite"), item.get("name", "").lower()))
    if scope == "favourites":
        stations = [item for item in stations if item.get("favourite")]
    return stations


def get_radio_station(station_id: str) -> dict[str, Any] | None:
    station_id = str(station_id or "").strip()
    if not station_id:
        return None
    store = _load_unlocked()
    for item in store.get("radioStations") or []:
        if item.get("id") == station_id:
            return _public_station(item)
    return None


def add_radio_station(body: dict[str, Any]) -> dict[str, Any]:
    external_uuid = str(body.get("externalUuid") or body.get("stationuuid") or "").strip()

    def mutate(store):
        stations = list(store.get("radioStations") or [])
        if external_uuid:
            for existing in stations:
                if existing.get("externalUuid") == external_uuid:
                    return _public_station(existing)
        station = _normalize_station(body, source=str(body.get("source") or "manual"))
        if not station:
            raise ValueError("name and stream url are required")
        station["favourite"] = bool(body.get("favourite"))
        stations.append(station)
        store["radioStations"] = stations
        return _public_station(station)

    return _with_store(mutate)


def set_radio_favourite(station_id: str, starred: bool) -> dict[str, Any] | None:
    station_id = str(station_id or "").strip()
    if not station_id:
        return None

    def mutate(store):
        for station in store.get("radioStations") or []:
            if station.get("id") != station_id:
                continue
            station["favourite"] = bool(starred)
            return _public_station(station)
        return None

    return _with_store(mutate)


def remove_radio_station(station_id: str) -> bool:
    station_id = str(station_id or "").strip()
    if not station_id:
        return False

    def mutate(store):
        before = len(store.get("radioStations") or [])
        store["radioStations"] = [
            item for item in store.get("radioStations") or [] if item.get("id") != station_id
        ]
        return len(store.get("radioStations") or []) < before

    return bool(_with_store(mutate))

#!/usr/bin/env python3
import base64
import hashlib
import html
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

try:
    from PIL import Image
except Exception:
    Image = None

from mpd_client import mpd
from shared import (
    ART_CACHE_DIR,
    CACHE_DIR,
    CONFIG_DIR,
    LISTEN_HOST,
    LISTEN_PORT,
    MUSIC_DIR,
    SETTINGS_FILE,
    ApiError,
    mpd_quote,
    parse_mpd_lines,
)

from library import art_resolver
from library.db import album_count, init_db, load_app_settings, save_app_settings
from library.scanner import scan_status, start_scan
from library import queries as lib_queries
from library import userdata as lib_userdata
from library import radio_browser as lib_radio_browser

try:
    from input_sources import (
        control_external_source,
        external_player_payload,
        get_external_input_state,
        renderer_art_url,
        seek_external_source,
        set_external_volume,
        sync_local_playback_takeover,
    )
except ImportError:
    get_external_input_state = None  # type: ignore
    external_player_payload = None  # type: ignore
    renderer_art_url = None  # type: ignore
    sync_local_playback_takeover = None  # type: ignore
    control_external_source = None  # type: ignore
    seek_external_source = None  # type: ignore
    set_external_volume = None  # type: ignore

try:
    from network_wifi import hotspot_start, hotspot_stop, wifi_connect, wifi_scan, wifi_status
except ImportError:
    hotspot_start = hotspot_stop = wifi_connect = wifi_scan = wifi_status = None  # type: ignore
try:
    from storage_sources import mount_selected_storage, network_storage_configure, network_storage_status
except ImportError:
    mount_selected_storage = network_storage_configure = network_storage_status = None  # type: ignore
try:
    from audio_output import apply_audio_output, audio_devices_payload, normalize_route
except ImportError:
    apply_audio_output = None  # type: ignore
    audio_devices_payload = None  # type: ignore
    normalize_route = None  # type: ignore

def ensure_dirs():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    ART_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not SETTINGS_FILE.exists():
        write_settings(
            {
                "music_directory": str(MUSIC_DIR),
                "audio_output": "hdmi",
                "dac_hat": "",
                "alsa_device": "default",
                "mixer": "software",
                "album_art": "embedded-first",
            }
        )


def load_settings():
    ensure_dirs()
    try:
        with SETTINGS_FILE.open("r", encoding="utf-8") as fh:
            settings = json.load(fh)
            settings.update(load_app_settings())
            return settings
    except (OSError, json.JSONDecodeError):
        return {
            "music_directory": str(MUSIC_DIR),
            "audio_output": "hdmi",
            "dac_hat": "",
            "alsa_device": "default",
            "mixer": "software",
            "album_art": "embedded-first",
        }


def write_settings(settings):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(settings, fh, indent=2, sort_keys=True)
        fh.write("\n")
    tmp.replace(SETTINGS_FILE)
    save_app_settings(settings)


def music_root():
    settings = load_settings()
    return Path(settings.get("music_directory", str(MUSIC_DIR)))


def music_found(root: Path) -> bool:
    if not root.is_dir():
        return False
    try:
        for directory, dirs, files in os.walk(root):
            dirs[:] = [name for name in dirs if not name.startswith(".")]
            if any(art_resolver.is_audio_file(Path(name)) for name in files):
                return True
    except OSError:
        return False
    return False


def use_library():
    try:
        return lib_queries.library_ready()
    except Exception:
        return False


def first_value(value, default=""):
    if isinstance(value, list):
        return value[0] if value else default
    return value if value is not None else default


def collect_values(entries, key):
    values = []
    for entry in entries:
        value = entry.get(key)
        if isinstance(value, list):
            values.extend(value)
        elif value:
            values.append(value)
    return values


def as_track(entry):
    file_uri = first_value(entry.get("file"))
    title = first_value(entry.get("Title")) or first_value(entry.get("Name")) or Path(file_uri).stem
    artist = first_value(entry.get("Artist")) or first_value(entry.get("AlbumArtist")) or "Unknown artist"
    album = first_value(entry.get("Album")) or "Unknown album"
    duration = float(first_value(entry.get("duration")) or first_value(entry.get("Time")) or 0)
    track = first_value(entry.get("Track"))
    return {
        "file": file_uri,
        "title": title,
        "artist": artist,
        "album": album,
        "track": track,
        "duration": duration,
    }


def api_status():
    status = mpd.single_map("status")
    song = mpd.single_map("currentsong")
    elapsed = 0.0
    duration = 0.0
    if "elapsed" in status:
        elapsed = float(status["elapsed"])
    if "duration" in status:
        duration = float(status["duration"])
    elif "Time" in song:
        duration = float(song["Time"])
    return {
        "state": status.get("state", "stop"),
        "volume": int(status.get("volume", "0")) if status.get("volume", "0").lstrip("-").isdigit() else 0,
        "elapsed": elapsed,
        "duration": duration,
        "song": as_track(song) if song else None,
        "updating_db": status.get("updating_db"),
        "repeat": status.get("repeat") == "1",
        "random": status.get("random") == "1",
    }


def api_albums():
    rows = mpd.entries("list album")
    albums = []
    for name in collect_values(rows, "Album"):
        if name:
            albums.append({"album": name, "art_url": "/api/art?album=" + quote(name)})
    return {"albums": sorted(albums, key=lambda item: item["album"].lower())}


def api_artists():
    rows = mpd.entries("list artist")
    artists = sorted(
        [name for name in collect_values(rows, "Artist") if name],
        key=lambda value: value.lower(),
    )
    return {"artists": artists}


def api_tracks(query):
    album = query.get("album", [None])[0]
    artist = query.get("artist", [None])[0]
    if use_library() and not album and not artist:
        offset = int(query.get("offset", [0])[0])
        limit = int(query.get("limit", [10000])[0])
        return lib_queries.list_all_tracks(offset, limit)
    if album:
        command = "find album " + mpd_quote(album)
    elif artist:
        command = "find artist " + mpd_quote(artist)
    else:
        command = "listallinfo"
    tracks = [as_track(row) for row in mpd.entries(command)]
    tracks.sort(key=lambda item: (item["album"].lower(), track_sort_key(item["track"]), item["title"].lower()))
    return {"tracks": tracks}


def compat_album_id(name):
    return quote(name, safe="")


def compat_album_name(album_id):
    return unquote(album_id or "")


def resolve_album_title(album_id_or_name):
    raw = str(album_id_or_name or "")
    if raw.isdigit():
        item = lib_queries.album_by_id(int(raw))
        if item:
            return item["title"]
    return compat_album_name(raw)


def compat_albums(query):
    offset = int(query.get("offset", [0])[0])
    limit = int(query.get("limit", [96])[0])
    filter_value = query.get("filter", [""])[0]
    sort = query.get("sort", ["title"])[0]

    if use_library():
        artist_filter = None
        composer_filter = None
        year_filter = None
        genre_filter = None
        album_ids = None
        toprated = False

        if filter_value.startswith("artist:"):
            artist_filter = filter_value.split(":", 1)[1]
        elif filter_value.startswith("composer:"):
            composer_filter = filter_value.split(":", 1)[1]
        elif filter_value.startswith("year:"):
            try:
                year_filter = int(filter_value.split(":", 1)[1])
            except ValueError:
                year_filter = None
        elif filter_value.startswith("genre:"):
            genre_filter = filter_value.split(":", 1)[1]
        elif filter_value in ("toprated", "highest", "rating"):
            toprated = True
            sort = "rating"
        elif filter_value.startswith("favourite"):
            album_ids = [int(value) for value in lib_userdata.favourite_albums() if str(value).isdigit()]
            if not album_ids:
                return {"albums": [], "total": 0, "offset": offset, "limit": limit}

        return lib_queries.list_albums(
            offset,
            limit,
            artist_filter=artist_filter,
            composer_filter=composer_filter,
            year_filter=year_filter,
            genre_filter=genre_filter,
            album_ids=album_ids,
            toprated=toprated,
            sort=sort,
        )

    albums = api_albums()["albums"]
    if filter_value.startswith("artist:"):
        artist = filter_value.split(":", 1)[1]
        rows = api_tracks({"artist": [artist]})["tracks"]
        allowed = {track["album"] for track in rows}
        albums = [album for album in albums if album["album"] in allowed]
    total = len(albums)
    page = albums[offset : offset + limit]
    return {
        "albums": [
            {
                "id": compat_album_id(album["album"]),
                "title": album["album"],
                "artist": "",
                "albumArtist": "",
                "year": "",
                "artUrl": album["art_url"],
            }
            for album in page
        ],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


def compat_album_tracks(album_id):
    if str(album_id).isdigit() and use_library():
        return lib_queries.album_tracks(int(album_id))
    album = compat_album_name(album_id)
    tracks = api_tracks({"album": [album]})["tracks"]
    return {
        "tracks": [
            {
                "id": track["file"],
                "file": track["file"],
                "trackNumber": track["track"],
                "title": track["title"],
                "artist": track["artist"] or "",
                "singer": track["artist"] or "",
                "duration": track["duration"],
            }
            for track in tracks
        ]
    }


def compat_artists():
    if use_library():
        return lib_queries.list_artists()
    artists = api_artists()["artists"]
    return {"artists": [{"name": name, "album_count": ""} for name in artists]}


def compat_genres():
    if use_library():
        return lib_queries.list_genres()
    return {"genres": []}


def compat_years():
    if use_library():
        return lib_queries.list_years()
    return {"years": []}


def compat_composers():
    if use_library():
        return lib_queries.list_composers()
    return {"composers": []}


def compat_favourites():
    return {
        "tracks": sorted(lib_userdata.favourite_tracks()),
        "albums": sorted(lib_userdata.favourite_albums()),
    }


def compat_starred_tracks():
    if not use_library():
        return {"tracks": []}
    return lib_queries.list_starred_tracks(sorted(lib_userdata.favourite_tracks()))


def _is_radio_stream_uri(uri: str) -> bool:
    value = str(uri or "").strip().lower()
    return value.startswith("http://") or value.startswith("https://")


def _radio_player_payload(status, song):
    track = as_track(song) if song else {}
    file_uri = track.get("file") or ""
    station = None
    if _is_radio_stream_uri(file_uri):
        for item in lib_userdata.list_radio_stations("all"):
            if item.get("url") == file_uri or item.get("streamUrl") == file_uri:
                station = item
                break
    title = (station or {}).get("name") or track.get("title") or "Internet Radio"
    subtitle = (station or {}).get("genre") or (station or {}).get("tags") or "Internet radio"
    return {
        "inputSource": "radio",
        "radio": station or {"name": title, "url": file_uri, "streamUrl": file_uri},
        "status": {
            "state": status.get("state", "stop"),
            "volume": int(status.get("volume", "0")) if str(status.get("volume", "0")).lstrip("-").isdigit() else 0,
            "elapsed": float(status.get("elapsed", 0) or 0),
            "duration": float(status.get("duration", 0) or track.get("duration", 0) or 0),
        },
        "song": {
            "Title": title,
            "Artist": subtitle,
            "Album": "Internet radio",
            "file": file_uri,
            "Time": track.get("duration", 0),
        },
    }


def compat_radio(query=None):
    query = query or {}
    scope = first_value(query.get("scope")) or "all"
    return {"stations": lib_userdata.list_radio_stations(scope)}


def compat_radio_search(query):
    q = first_value(query.get("q")) or ""
    country = first_value(query.get("country")) or ""
    tag = first_value(query.get("tag")) or ""
    limit = int(query.get("limit", [20])[0])
    offset = int(query.get("offset", [0])[0])
    try:
        results = lib_radio_browser.search_stations(q, country, tag, limit, offset)
    except Exception as exc:
        return {"stations": [], "error": str(exc), "offset": offset, "limit": limit, "hasMore": False}
    return {
        "stations": results,
        "offset": offset,
        "limit": limit,
        "hasMore": len(results) >= limit,
    }


def post_radio_station(body):
    try:
        station = lib_userdata.add_radio_station(body)
    except ValueError as exc:
        raise ApiError(400, str(exc)) from exc
    return {"ok": True, "station": station}


def post_radio_favourite(body):
    station_id = first_value(body.get("stationId") or body.get("id"))
    if not station_id:
        raise ApiError(400, "stationId required")
    starred = body.get("starred", body.get("favourite", True))
    if isinstance(starred, str):
        starred = starred.lower() in ("1", "true", "yes")
    else:
        starred = bool(starred)
    station = lib_userdata.set_radio_favourite(station_id, starred)
    if not station:
        raise ApiError(404, "Station not found")
    return {"ok": True, "starred": starred, "station": station}


def post_radio_remove(body):
    station_id = first_value(body.get("stationId") or body.get("id"))
    if not station_id:
        raise ApiError(400, "stationId required")
    if not lib_userdata.remove_radio_station(station_id):
        raise ApiError(404, "Station not found")
    return {"ok": True}


def play_radio(body):
    station_id = first_value(body.get("stationId") or body.get("id"))
    url = first_value(body.get("url") or body.get("streamUrl"))
    name = first_value(body.get("name")) or "Internet Radio"
    if station_id:
        station = lib_userdata.get_radio_station(station_id)
        if not station:
            raise ApiError(404, "Station not found")
        url = station.get("url") or station.get("streamUrl")
        name = station.get("name") or name
    if not url:
        raise ApiError(400, "stationId or url required")
    if not _is_radio_stream_uri(url):
        raise ApiError(400, "Invalid stream URL")
    mpd.command("clear")
    mpd.command("add " + mpd_quote(url))
    mpd.command("play")
    status = mpd.single_map("status")
    song = mpd.single_map("currentsong")
    if song:
        song["Title"] = name
        song["Album"] = "Internet radio"
    return _radio_player_payload(status, song)


def compat_playlists():
    return {"playlists": lib_userdata.list_playlists()}


def compat_playlist_tracks(playlist_id):
    playlist = next(
        (item for item in lib_userdata.list_playlists() if item.get("id") == playlist_id),
        None,
    )
    if not playlist:
        raise ApiError(404, "Playlist not found")
    if not use_library():
        return {"tracks": [], "playlist": playlist}
    track_ids = list(playlist.get("trackIds") or [])
    return {
        "playlist": playlist,
        **lib_queries.list_starred_tracks(track_ids),
    }


def post_favourites(body):
    track_id = first_value(body.get("trackId") or body.get("id") or body.get("file"))
    album_id = first_value(body.get("albumId"))
    starred = body.get("starred", True)
    if isinstance(starred, str):
        starred = starred.lower() in ("1", "true", "yes")
    else:
        starred = bool(starred)
    if track_id:
        lib_userdata.set_favourite_track(track_id, starred)
        return {"ok": True, "starred": starred, "trackId": track_id}
    if album_id:
        lib_userdata.set_favourite_album(str(album_id), starred)
        return {"ok": True, "starred": starred, "albumId": str(album_id)}
    raise ApiError(400, "trackId or albumId required")


def post_create_playlist(body):
    name = first_value(body.get("name"))
    if not name:
        raise ApiError(400, "name required")
    track_id = first_value(body.get("trackId") or body.get("file"))
    playlist = lib_userdata.create_playlist(name)
    if track_id:
        playlist = lib_userdata.add_track_to_playlist(playlist["id"], track_id) or playlist
    return {"ok": True, "playlist": playlist}


def post_playlist_add_track(body):
    playlist_id = first_value(body.get("playlistId"))
    track_id = first_value(body.get("trackId") or body.get("file"))
    if not playlist_id or not track_id:
        raise ApiError(400, "playlistId and trackId required")
    playlist = lib_userdata.add_track_to_playlist(playlist_id, track_id)
    if not playlist:
        raise ApiError(404, "Playlist not found")
    return {"ok": True, "playlist": playlist}


def compat_search(query):
    q = query.get("q", [""])[0]
    limit = int(query.get("limit", [120])[0])
    if use_library():
        return lib_queries.search_all(q, limit)
    q_lower = q.lower().strip()
    albums = compat_albums({"limit": [str(limit)]})["albums"]
    tracks = api_tracks({}).get("tracks", [])
    if q_lower:
        albums = [
            album for album in albums
            if q_lower in album.get("title", "").lower()
            or q_lower in album.get("artist", "").lower()
        ]
        tracks = [
            track for track in tracks
            if q_lower in track.get("title", "").lower()
            or q_lower in track.get("artist", "").lower()
            or q_lower in track.get("album", "").lower()
        ]
    return {
        "albums": albums[:limit],
        "tracks": tracks[:limit],
        "total": min(limit, len(albums)) + min(limit, len(tracks)),
    }


def compat_player_state():
    if get_external_input_state and external_player_payload and sync_local_playback_takeover:
        external = get_external_input_state()
        sync_local_playback_takeover(bool(external and external.get("playing")))
        if external:
            return external_player_payload(external)
        sync_local_playback_takeover(False)

    mpd_status = mpd.single_map("status")
    mpd_song = mpd.single_map("currentsong")
    file_uri = mpd_song.get("file") if mpd_song else ""
    if _is_radio_stream_uri(file_uri):
        return _radio_player_payload(mpd_status, mpd_song)

    status = api_status()
    song = status.get("song") or {}
    return {
        "inputSource": "local",
        "status": {
            "state": status.get("state", "stop"),
            "volume": status.get("volume", 0),
            "elapsed": status.get("elapsed", 0),
            "duration": status.get("duration", 0),
        },
        "song": {
            "Title": song.get("title", ""),
            "Artist": song.get("artist", ""),
            "Album": song.get("album", ""),
            "file": song.get("file", ""),
            "Time": song.get("duration", 0),
        },
    }


def compat_settings():
    settings = load_settings()
    if use_library():
        conn = lib_queries.get_connection()
        album_total = conn.execute("SELECT COUNT(*) AS c FROM albums").fetchone()["c"]
        track_total = conn.execute("SELECT COUNT(*) AS c FROM tracks").fetchone()["c"]
    else:
        album_total = len(api_albums().get("albums", []))
        track_total = 0
    return {
        "config": {
            "musicDir": settings.get("music_directory", str(MUSIC_DIR)),
            "ui": {
                "animationSpeed": float(settings.get("animationSpeed", 0.18)),
                "visibleCoverCount": int(settings.get("visibleCoverCount", 31)),
                "themeAccent": settings.get("themeAccent", "#8ea0ff"),
            },
        },
        "settings": settings,
        "scan": scan_status(),
        "counts": {"albums": int(album_total), "tracks": int(track_total)},
        "outputs": [],
        "libraryBackend": "sqlite" if use_library() else "mpd",
    }


def compat_system_info():
    return {
        "hostname": "PiTunes",
        "uptime": "",
        "urls": ["http://pitunes.local"],
        "ip": [],
        "rootDisk": {},
    }


SERVICE_UNITS = {
    "ssh": "ssh.service",
    "bluetooth": "bluetooth.service",
    "airplay": "shairport-sync.service",
    "kiosk": "lightdm.service",
}

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WIRELESS_AUDIO_SETUP = PROJECT_ROOT / "scripts" / "setup-wireless-audio.sh"
BLUETOOTH_HELPER_UNITS = (
    "pitunes-bluealsa-aplay.service",
    "pitunes-bt-agent.service",
    "pitunes-bluetooth-discoverable.service",
    "bluealsa.service",
)
BLUETOOTH_RADIO_UNITS = ("hciuart.service",)
AIRPLAY_HELPER_UNITS = ("nqptp.service",)
SSH_HELPER_UNITS = ("ssh.socket",)
SERVICE_REQUIRED_UNITS = {
    "bluetooth": (
        "bluetooth.service",
        "bluealsa.service",
        "pitunes-bt-agent.service",
        "pitunes-bluealsa-aplay.service",
        "pitunes-bluetooth-discoverable.service",
    ),
    "airplay": ("shairport-sync.service", "avahi-daemon.service"),
}


def run_command(args, check=False, timeout=25):
    try:
        return subprocess.run(
            args,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        return subprocess.CompletedProcess(args, 124, exc.stdout or "", exc.stderr or "command timed out")
    except OSError as exc:
        return subprocess.CompletedProcess(args, 127, "", str(exc))


def sudo_script(script, *args):
    if not script.exists():
        return None
    return run_command(["sudo", "-n", "/bin/bash", str(script), *args])


def lsblk_devices():
    result = run_command(
        ["lsblk", "-J", "-o", "NAME,PATH,TRAN,TYPE,FSTYPE,LABEL,SIZE,MOUNTPOINT"],
        timeout=8,
    )
    if result.returncode != 0:
        return []
    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return []

    flattened = []

    def walk(items, parent_tran=""):
        for item in items or []:
            next_item = dict(item)
            next_tran = next_item.get("tran") or parent_tran
            next_item["_tran"] = next_tran
            flattened.append(next_item)
            walk(next_item.get("children"), next_tran)

    walk(payload.get("blockdevices", []))
    return flattened


def usb_music_roots(selected, selected_device):
    roots = []
    for item in lsblk_devices():
        path = item.get("path")
        block_type = item.get("type")
        filesystem = item.get("fstype") or ""
        if not path or item.get("_tran") != "usb":
            continue
        if block_type != "part" and not (block_type == "disk" and filesystem):
            continue
        if filesystem.lower() in {"swap"}:
            continue

        label = item.get("label") or Path(path).name
        size = item.get("size") or ""
        mountpoint = item.get("mountpoint") or ""
        details = [path]
        if filesystem:
            details.append(filesystem)
        if size:
            details.append(size)
        if mountpoint:
            details.append(f"mounted at {mountpoint}")
        description = " / ".join(details)
        roots.append({
            "path": str(MUSIC_DIR),
            "kind": "local",
            "label": f"Local HDD / SSD: {label}",
            "description": description,
            "available": True,
            "readable": True,
            "selected": selected == "local" and selected_device == path,
            "device": path,
            "filesystem": filesystem,
            "size": size,
            "mountpoint": mountpoint,
        })
    roots.sort(key=lambda root: (root["device"] != selected_device, root["label"].casefold(), root["device"]))
    if selected == "local" and roots and not any(root["selected"] for root in roots):
        roots[0]["selected"] = True
    return roots


def systemctl_value(command, unit):
    try:
        result = run_command(["systemctl", command, unit])
    except OSError:
        return "unknown"
    return (result.stdout or result.stderr or "unknown").strip().splitlines()[0] if result.stdout or result.stderr else "unknown"


def service_installed(unit):
    try:
        result = run_command(["systemctl", "cat", unit])
    except OSError:
        return False
    return result.returncode == 0


def service_state(service, unit):
    if not service_installed(unit):
        return [{"name": "not installed", "active": "inactive", "enabled": "disabled"}]
    components = []
    for component in SERVICE_REQUIRED_UNITS.get(service, (unit,)):
        installed = service_installed(component)
        components.append({
            "unit": component,
            "installed": installed,
            "active": systemctl_value("is-active", component) if installed else "not-installed",
            "enabled": systemctl_value("is-enabled", component) if installed else "not-installed",
        })
    active = "active" if all(component["active"] == "active" for component in components) else "inactive"
    enabled = "enabled" if all(component["enabled"] in ("enabled", "static", "indirect", "generated") for component in components) else "disabled"
    failed = [component["unit"] for component in components if component["active"] != "active"]
    label = "active / enabled" if active == "active" and enabled == "enabled" else f"not ready: {', '.join(failed)}" if failed else f"{active} / {enabled}"
    return [{
        "name": service,
        "unit": unit,
        "active": active,
        "enabled": enabled,
        "label": label,
        "components": components,
    }]


def compat_services():
    return {"services": {service: service_state(service, unit) for service, unit in SERVICE_UNITS.items()}}


def wait_service_ready(service, unit, timeout=12):
    deadline = time.monotonic() + timeout
    state = service_state(service, unit)[0]
    while state.get("active") != "active" and time.monotonic() < deadline:
        time.sleep(1)
        state = service_state(service, unit)[0]
    return state


def control_unit(unit, command, warnings, *, required=False, label=None):
    if not service_installed(unit):
        return False
    result = run_command(["sudo", "-n", "systemctl", command, unit])
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        message = detail or f"{label or unit} {command} returned a warning"
        if required:
            raise ApiError(500, message)
        warnings.append(message)
        return False
    return True


def control_optional_units(units, commands, warnings):
    for unit in units:
        for command in commands:
            control_unit(unit, command, warnings)


def control_service(body):
    service = first_value(body.get("service")).lower()
    action = first_value(body.get("action")).lower()
    unit = SERVICE_UNITS.get(service)
    if not unit:
        raise ApiError(400, "Unknown service")
    if action not in ("start", "stop"):
        raise ApiError(400, "Unsupported service action")
    if not service_installed(unit):
        raise ApiError(404, f"{service} is not installed")

    warnings = []
    if action == "start" and service in ("airplay", "bluetooth"):
        result = sudo_script(WIRELESS_AUDIO_SETUP, service)
        if result is not None and result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            warnings.append(detail or f"{service.title()} receiver setup returned a warning")

    if action == "stop" and service == "bluetooth":
        control_optional_units(BLUETOOTH_HELPER_UNITS, ("stop", "disable"), warnings)
    elif action == "stop" and service == "airplay":
        control_optional_units(AIRPLAY_HELPER_UNITS, ("stop", "disable"), warnings)
    elif action == "stop" and service == "ssh":
        control_optional_units(SSH_HELPER_UNITS, ("stop", "disable"), warnings)

    persist_action = "enable" if action == "start" else "disable"
    for command in (action, persist_action):
        control_unit(unit, command, warnings, required=command == action, label=service)

    if action == "start" and service == "bluetooth":
        control_optional_units(
            BLUETOOTH_RADIO_UNITS + BLUETOOTH_HELPER_UNITS,
            ("enable", "restart"),
            warnings,
        )
    elif action == "start" and service == "airplay":
        control_optional_units(AIRPLAY_HELPER_UNITS, ("enable", "restart"), warnings)
    elif action == "stop" and service == "bluetooth":
        control_optional_units(BLUETOOTH_RADIO_UNITS, ("stop", "disable"), warnings)
    elif action == "start" and service == "ssh":
        control_optional_units(SSH_HELPER_UNITS, ("stop", "disable"), warnings)

    if action == "start":
        ready = wait_service_ready(service, unit)
        if ready.get("active") != "active":
            label = ready.get("label") or f"{service} did not become ready"
            raise ApiError(500, label)

    message = f"{service} {'enabled' if action == 'start' else 'disabled'}."
    if warnings:
        message = f"{message} {'; '.join(warnings)}"
    return {"ok": True, "message": message, "warnings": warnings, "services": compat_services()["services"]}


def compat_audio_devices():
    settings = load_settings()
    if audio_devices_payload:
        return audio_devices_payload(settings)
    return {
        "devices": [{"alsa": "default", "label": "default - ALSA default output"}],
        "hats": [],
        "routes": [],
        "current": {
            "route": settings.get("audio_output", "hdmi"),
            "device": settings.get("alsa_device", "default"),
            "mixer": settings.get("mixer", "software"),
            "dac_hat": settings.get("dac_hat", ""),
        },
    }


def filesystem_roots():
    settings = load_settings()
    selected = settings.get("storage_source", "local")
    selected_device = str(settings.get("local_device") or "")
    candidates = [
        (str(MUSIC_DIR), "internal", "Internal Storage", "Music stored on the SD card, NVMe, or internal system drive."),
    ]

    roots = []
    roots.extend(usb_music_roots(selected, selected_device))
    if not roots:
        roots.append({
            "path": str(MUSIC_DIR),
            "kind": "local",
            "label": "Local HDD / SSD",
            "description": "No USB music drive detected. Connect a USB HDD, SSD, or flash drive.",
            "available": False,
            "readable": False,
            "selected": selected == "local",
            "device": "",
        })
    seen = set()
    for raw_path, kind, label, description in candidates:
        path = Path(str(raw_path)).expanduser()
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path
        key = str(resolved)
        storage_key = (key, kind)
        internal_exists = kind == "internal" and any(root["kind"] == "internal" for root in roots)
        if storage_key in seen or internal_exists or not resolved.is_dir():
            continue
        seen.add(storage_key)
        roots.append({
            "path": key,
            "kind": kind,
            "label": label,
            "description": description,
            "available": True,
            "readable": os.access(resolved, os.R_OK),
            "selected": selected == kind,
        })
    network = network_storage_status() if network_storage_status else {"configured": False, "mounted": False}
    roots.append({
        "path": str(MUSIC_DIR),
        "kind": "network",
        "label": "Network Storage",
        "description": "Connected NAS share." if network.get("mounted") else "Connect a NAS or network share.",
        "available": True,
        "readable": bool(network.get("mounted")),
        "selected": selected == "network",
        "action": "configure-network",
        "status": network,
    })
    return {"roots": roots}


def filesystem_browse(query):
    raw_path = query.get("path", [str(music_root())])[0] or str(music_root())
    path = Path(raw_path).expanduser()
    try:
        resolved = path.resolve()
    except OSError:
        raise ApiError(400, "Folder not found")
    if not resolved.is_dir():
        raise ApiError(400, "Folder not found")
    if not os.access(resolved, os.R_OK):
        raise ApiError(403, "Folder is not readable")

    try:
        children = sorted(
            (child for child in resolved.iterdir() if child.is_dir()),
            key=lambda child: child.name.casefold(),
        )
    except OSError as exc:
        raise ApiError(403, str(exc))

    entries = [
        {
            "name": child.name,
            "path": str(child),
            "readable": os.access(child, os.R_OK),
        }
        for child in children[:300]
    ]
    parent = str(resolved.parent) if resolved.parent != resolved else ""
    return {"path": str(resolved), "parent": parent, "entries": entries}


def track_sort_key(value):
    if not value:
        return 9999
    first = str(value).split("/")[0]
    try:
        return int(first)
    except ValueError:
        return 9999


def find_album_first_file(album):
    rows = mpd.entries("find album " + mpd_quote(album))
    if not rows:
        return None
    rows.sort(key=lambda row: track_sort_key(row.get("Track", "")))
    return rows[0].get("file")


def safe_music_path(uri):
    decoded = unquote(uri or "")
    candidate = (music_root() / decoded).resolve()
    root = music_root().resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise ApiError(400, "Path is outside the music directory")
    return candidate


def audio_stream_file(query):
    uri = query.get("file", [None])[0]
    if not uri:
        raise ApiError(400, "file is required")
    path = safe_music_path(uri)
    if not path.is_file() or not art_resolver.is_audio_file(path):
        raise ApiError(404, "Audio file not found")
    return path


def audio_mime_type(path):
    overrides = {
        ".aac": "audio/aac",
        ".aiff": "audio/aiff",
        ".alac": "audio/mp4",
        ".flac": "audio/flac",
        ".m4a": "audio/mp4",
        ".mp3": "audio/mpeg",
        ".oga": "audio/ogg",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg",
        ".wav": "audio/wav",
    }
    return overrides.get(path.suffix.lower()) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"


def cache_key(source):
    encoded = base64.urlsafe_b64encode(source.encode("utf-8")).decode("ascii")
    return encoded.rstrip("=")


def thumb_max_px(query):
    size = int(query.get("size", ["420"])[0])
    return 128 if size <= 160 else 420


def thumb_from_file(path, key, max_px=420):
    suffix = f"_{max_px}.jpg"
    output = ART_CACHE_DIR / (key + suffix)
    if output.exists() and output.stat().st_mtime >= path.stat().st_mtime:
        return output
    if Image:
        try:
            with Image.open(path) as image:
                image.thumbnail((max_px, max_px))
                rgb = image.convert("RGB")
                rgb.save(output, "JPEG", quality=80 if max_px <= 160 else 82, optimize=True)
                return output
        except Exception:
            pass
    shutil.copyfile(path, output)
    return output


def thumb_from_bytes(data, key, max_px=420):
    output = ART_CACHE_DIR / (key + f"_{max_px}.jpg")
    if output.exists():
        return output
    if Image:
        try:
            from io import BytesIO

            with Image.open(BytesIO(data)) as image:
                image.thumbnail((max_px, max_px))
                image.convert("RGB").save(output, "JPEG", quality=80 if max_px <= 160 else 82, optimize=True)
                return output
        except Exception:
            pass
    output.write_bytes(data)
    return output


def embedded_thumb_from_track(uri, max_px):
    if not uri:
        return None
    try:
        path = safe_music_path(uri)
    except ApiError:
        path = None
    if path and path.is_file():
        embedded = art_resolver.embedded_art_bytes(path)
        if embedded:
            data, _mime = embedded
            return thumb_from_bytes(data, cache_key("embedded-file:" + str(path.resolve())), max_px)
    try:
        data, _metadata = mpd.binary("readpicture " + mpd_quote(uri) + " 0")
        return thumb_from_bytes(data, cache_key("embedded-mpd:" + uri), max_px)
    except ApiError:
        return None


def _renderer_cover_svg(renderer: str) -> str:
    is_airplay = renderer == "airplay"
    label = "AIRPLAY" if is_airplay else "BLUETOOTH"
    accent = "#3b9eff"
    icon_markup = (
        """
  <g transform="translate(210 188)">
    <rect x="-32" y="-40" width="64" height="48" rx="8" fill="none" stroke="{accent}" stroke-width="3"/>
    <path d="M0 -4 L-15 16 L15 16 Z" fill="{accent}"/>
    <path d="M-18 -14 Q0 -34 18 -14" fill="none" stroke="{accent}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M-11 -8 Q0 -22 11 -8" fill="none" stroke="{accent}" stroke-width="2.5" stroke-linecap="round"/>
  </g>"""
        if is_airplay
        else """
  <g transform="translate(210 188) scale(3.4)" fill="{accent}">
    <path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41l5.59 5.59L5 17.59 6.41 19l5.59-5.59V21h1l5.71-5.71-4.3-4.29 4.3-4.29z" transform="translate(-12,-12)"/>
  </g>"""
    ).format(accent=accent)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420" viewBox="0 0 420 420">
  <rect width="420" height="420" fill="#000"/>
  <circle cx="210" cy="188" r="88" fill="none" stroke="{accent}" stroke-width="2.5"/>
  {icon_markup}
  <text x="210" y="318" text-anchor="middle" fill="{accent}" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="500" letter-spacing="9">{label}</text>
</svg>"""


def virtual_renderer_cover(renderer, max_px=420):
    renderer = (renderer or "").strip().lower()
    if renderer not in ("airplay", "bluetooth"):
        renderer = "bluetooth"
    key = cache_key(f"renderer-v5:{renderer}")
    output = ART_CACHE_DIR / (key + f"_{max_px}.svg")
    if output.exists():
        return output
    output.write_text(_renderer_cover_svg(renderer), encoding="utf-8")
    return output


def virtual_cover_file(album_title, artist, max_px):
    title = album_title or "Unknown Album"
    subtitle = artist or "Unknown Artist"
    key = cache_key(f"virtual:{title}:{subtitle}:{max_px}")
    output = ART_CACHE_DIR / (key + f"_{max_px}.svg")
    if output.exists():
        return output
    title_text = html.escape(title)
    artist_text = html.escape(subtitle)
    title_size = 42 if len(title) < 13 else 32 if len(title) < 26 else 24
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{max_px}" height="{max_px}" viewBox="0 0 420 420">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#5f6fac"/>
      <stop offset="1" stop-color="#151621"/>
    </linearGradient>
    <pattern id="p" width="36" height="36" patternUnits="userSpaceOnUse">
      <circle cx="6" cy="6" r="2.5" fill="rgba(255,255,255,.16)"/>
      <path d="M0 36 36 0" stroke="rgba(255,255,255,.06)" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="420" height="420" fill="url(#g)"/>
  <rect width="420" height="420" fill="url(#p)" opacity=".7"/>
  <circle cx="302" cy="134" r="106" fill="rgba(0,0,0,.78)"/>
  <circle cx="302" cy="134" r="34" fill="rgba(255,255,255,.82)"/>
  <rect x="32" y="270" width="356" height="98" rx="0" fill="rgba(255,255,255,.86)"/>
  <text x="48" y="323" font-family="Arial, sans-serif" font-size="{title_size}" font-weight="800" fill="#111">{title_text}</text>
  <text x="48" y="354" font-family="Arial, sans-serif" font-size="22" fill="#333">{artist_text}</text>
  <text x="48" y="84" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="rgba(255,255,255,.74)">PiTunes STEREO</text>
</svg>"""
    output.write_text(svg, encoding="utf-8")
    return output


def _radio_icon_cache_path(remote_url: str) -> Path:
    digest = hashlib.sha256(remote_url.encode("utf-8")).hexdigest()[:32]
    return ART_CACHE_DIR / "radio-icons" / digest


def get_radio_icon_file(query):
    import urllib.request

    url = first_value(query.get("url"))
    station_id = first_value(query.get("stationId"))
    title = first_value(query.get("title")) or "Radio"
    if not url and station_id:
        station = lib_userdata.get_radio_station(station_id)
        if station:
            url = str(station.get("artUrl") or station.get("favicon") or "").strip()
            title = str(station.get("name") or title)
    if url and url.startswith(("http://", "https://")):
        cached = _radio_icon_cache_path(url)
        if cached.exists() and cached.stat().st_size > 0:
            return cached
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; PiTunes/1.0)",
                    "Accept": "image/*,*/*;q=0.8",
                },
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read(600000)
                if data:
                    cached.parent.mkdir(parents=True, exist_ok=True)
                    cached.write_bytes(data)
                    return cached
        except Exception:
            pass
    return virtual_radio_cover(title)


def virtual_radio_cover(title, max_px=420):
    label = html.escape(str(title or "Radio")[:30])
    initial = html.escape((str(title or "Radio").strip()[:1] or "R").upper())
    output = ART_CACHE_DIR / f"radio-{abs(hash(title)) % 10_000_000}-{max_px}.svg"
    if output.exists():
        return output
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{max_px}" height="{max_px}" viewBox="0 0 420 420">
  <defs>
    <linearGradient id="rg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#4f7cff"/>
      <stop offset="1" stop-color="#151621"/>
    </linearGradient>
  </defs>
  <rect width="420" height="420" fill="url(#rg)"/>
  <circle cx="210" cy="176" r="88" fill="rgba(255,255,255,.12)"/>
  <circle cx="210" cy="176" r="58" fill="rgba(255,255,255,.18)"/>
  <circle cx="210" cy="176" r="30" fill="rgba(255,255,255,.92)"/>
  <path d="M118 248c24-52 160-52 184 0" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="10" stroke-linecap="round"/>
  <path d="M96 278c36-78 232-78 268 0" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="10" stroke-linecap="round"/>
  <text x="210" y="188" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="#111">{initial}</text>
  <text x="210" y="352" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="rgba(255,255,255,.92)">{label}</text>
</svg>"""
    output.write_text(svg, encoding="utf-8")
    return output


def get_art_file(query):
    max_px = thumb_max_px(query)
    renderer = first_value(query.get("renderer"))
    if renderer in ("airplay", "bluetooth"):
        return virtual_renderer_cover(renderer, max_px)
    album_id = query.get("album_id", [None])[0]
    album = query.get("album", [None])[0]
    uri = query.get("file", [None])[0]
    album_title = album or ""
    album_artist = ""

    if album_id and str(album_id).isdigit():
        item = lib_queries.album_by_id(int(album_id))
        if item:
            album_title = item.get("title", "") or album_title
            album_artist = item.get("albumArtist") or item.get("artist") or ""
        uri = lib_queries.album_first_track_path(int(album_id)) or uri

    if album and not uri:
        if use_library():
            item = lib_queries.album_by_title(album)
            if item:
                album_title = item.get("title", "") or album
                album_artist = item.get("albumArtist") or item.get("artist") or ""
                uri = lib_queries.album_first_track_path(int(item["id"]))
        uri = find_album_first_file(album)

    embedded = embedded_thumb_from_track(uri, max_px)
    if embedded:
        return embedded
    if not album_title and uri:
        album_title = Path(uri).parent.name or Path(uri).stem
    return virtual_cover_file(album_title, album_artist, max_px)


def rebuild_art_cache():
    if not use_library():
        return {"ok": False, "message": "Library cache empty; run rescan first."}
    prefer_folder = False
    conn = lib_queries.get_connection()
    rows = conn.execute("SELECT id FROM albums").fetchall()
    for row in rows:
        from library.scanner import _resolve_art_for_album

        _resolve_art_for_album(conn, music_root(), int(row["id"]), prefer_folder)
    conn.commit()
    return {"ok": True, "albums": len(rows)}


def post_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if length == 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        raise ApiError(400, "Invalid JSON")


def play_album(body):
    album = body.get("album")
    if not album:
        raise ApiError(400, "album is required")
    mpd.command("clear")
    mpd.command("findadd album " + mpd_quote(album))
    mpd.command("play")
    return api_status()


def play_track(body):
    uri = body.get("file")
    if not uri:
        raise ApiError(400, "file is required")
    mpd.command("clear")
    mpd.command("add " + mpd_quote(uri))
    mpd.command("play")
    return api_status()


def set_volume(body):
    volume = int(body.get("volume", 0))
    volume = max(0, min(100, volume))
    mpd.command("setvol " + str(volume))
    return api_status()


def seek(body):
    seconds = max(0, int(float(body.get("seconds", 0))))
    mpd.command("seekcur " + str(seconds))
    return api_status()


def update_settings(body):
    settings = load_settings()
    for key in (
        "music_directory",
        "storage_source",
        "local_device",
        "audio_output",
        "dac_hat",
        "alsa_device",
        "mixer",
        "animationSpeed",
        "visibleCoverCount",
        "themeAccent",
    ):
        if key in body:
            settings[key] = body[key]
    if normalize_route and "audio_output" in body:
        settings["audio_output"] = normalize_route(settings.get("audio_output"))
    settings["album_art"] = "embedded-first"
    write_settings(settings)
    if "music_directory" in body or "storage_source" in body:
        if mount_selected_storage:
            mount_selected_storage()
        root = Path(settings["music_directory"])
        if music_found(root):
            start_scan(root, prefer_folder=False)
    return {"settings": settings, "message": "Settings saved. Re-run configure-mpd.sh or reboot after audio output changes."}


def trigger_library_scan():
    start_scan(music_root(), prefer_folder=False)
    return {"ok": True, "scan": scan_status()}


def _external_transport_action(path, body=None):
    if not get_external_input_state or not control_external_source:
        return None
    if not get_external_input_state():
        return None
    action_map = {
        "/api/player/play": "play",
        "/api/player/pause": "pause",
        "/api/player/previous": "previous",
        "/api/player/next": "next",
        "/api/pause": "pause",
        "/api/resume": "play",
        "/api/toggle": "toggle",
        "/api/stop": "stop",
        "/api/next": "next",
        "/api/previous": "previous",
    }
    action = action_map.get(path)
    if not action:
        return None
    if control_external_source(action):
        return compat_player_state()
    return None


def compat_player_post(path, body):
    external = _external_transport_action(path, body)
    if external is not None:
        return external

    if path == "/api/player/play":
        track_id = body.get("trackId")
        if track_id:
            return play_track({"file": track_id})
        mpd.command("pause 0")
        return compat_player_state()
    if path == "/api/player/pause":
        mpd.command("pause 1")
        return compat_player_state()
    if path == "/api/player/previous":
        mpd.command("previous")
        return compat_player_state()
    if path == "/api/player/next":
        mpd.command("next")
        return compat_player_state()
    if path == "/api/player/seek":
        external_state = get_external_input_state() if get_external_input_state else None
        if external_state and seek_external_source:
            seconds = float(body.get("seconds", 0) or 0)
            if seek_external_source(seconds, external_state.get("source")):
                return compat_player_state()
        return seek({"seconds": body.get("seconds", 0)})
    if path == "/api/player/volume":
        external_state = get_external_input_state() if get_external_input_state else None
        if external_state and set_external_volume:
            volume = int(body.get("volume", 0) or 0)
            if set_external_volume(volume, external_state.get("source")):
                return compat_player_state()
        return set_volume({"volume": body.get("volume", 0)})
    if path == "/api/player/queue":
        album_id = body.get("albumId")
        album = resolve_album_title(album_id)
        if body.get("clear") and body.get("play"):
            return play_album({"album": album})
        if body.get("clear"):
            mpd.command("clear")
        mpd.command("findadd album " + mpd_quote(album))
        return compat_player_state()
    if path == "/api/player/radio/play":
        return play_radio(body)
    raise ApiError(404, "Not found")


POST_ACTIONS = {
    "/api/play-album": play_album,
    "/api/play-track": play_track,
    "/api/volume": set_volume,
    "/api/seek": seek,
    "/api/settings": update_settings,
}

SIMPLE_MPD_POSTS = {
    "/api/pause": "pause 1",
    "/api/resume": "pause 0",
    "/api/toggle": "pause",
    "/api/stop": "stop",
    "/api/next": "next",
    "/api/previous": "previous",
    "/api/rescan": "update",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "PiTunesAPI/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, cache_control="max-age=86400"):
        mime = audio_mime_type(path)
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", cache_control)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_media_file(self, path):
        file_size = path.stat().st_size
        start = 0
        end = max(0, file_size - 1)
        status = 200
        range_header = self.headers.get("Range", "")
        if range_header.startswith("bytes="):
            requested = range_header[6:].split(",", 1)[0]
            start_text, _, end_text = requested.partition("-")
            try:
                if start_text:
                    start = int(start_text)
                    end = int(end_text) if end_text else end
                elif end_text:
                    suffix_length = int(end_text)
                    start = max(0, file_size - suffix_length)
            except ValueError:
                start = file_size
            if start < 0 or start >= file_size or end < start:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.end_headers()
                return
            end = min(end, file_size - 1)
            status = 206

        content_length = max(0, end - start + 1)
        mime = audio_mime_type(path)
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "private, max-age=3600")
        self.send_header("Content-Length", str(content_length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()

        remaining = content_length
        with path.open("rb") as fh:
            fh.seek(start)
            while remaining > 0:
                chunk = fh.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            if parsed.path == "/api/library/albums":
                self.send_json(compat_albums(query))
            elif parsed.path.startswith("/api/library/album/") and parsed.path.endswith("/tracks"):
                album_id = parsed.path[len("/api/library/album/") : -len("/tracks")]
                self.send_json(compat_album_tracks(album_id))
            elif parsed.path == "/api/library/artists":
                self.send_json(compat_artists())
            elif parsed.path == "/api/library/genres":
                self.send_json(compat_genres())
            elif parsed.path == "/api/library/years":
                self.send_json(compat_years())
            elif parsed.path == "/api/library/composers":
                self.send_json(compat_composers())
            elif parsed.path == "/api/library/tracks":
                offset = int(query.get("offset", [0])[0])
                limit = int(query.get("limit", [10000])[0])
                self.send_json(lib_queries.list_all_tracks(offset, limit) if use_library() else {"tracks": [], "total": 0})
            elif parsed.path == "/api/library/favourites":
                self.send_json(compat_favourites())
            elif parsed.path == "/api/library/starred/tracks":
                self.send_json(compat_starred_tracks())
            elif parsed.path == "/api/library/radio":
                self.send_json(compat_radio(query))
            elif parsed.path == "/api/library/radio/search":
                self.send_json(compat_radio_search(query))
            elif parsed.path == "/api/library/radio/icon":
                icon_path = get_radio_icon_file(query)
                self.send_file(icon_path, cache_control="max-age=86400")
            elif parsed.path == "/api/library/playlists":
                self.send_json(compat_playlists())
            elif parsed.path.startswith("/api/library/playlists/") and parsed.path.endswith("/tracks"):
                playlist_id = parsed.path[len("/api/library/playlists/") : -len("/tracks")]
                self.send_json(compat_playlist_tracks(unquote(playlist_id)))
            elif parsed.path == "/api/library/scan-status":
                self.send_json(scan_status())
            elif parsed.path == "/api/search":
                self.send_json(compat_search(query))
            elif parsed.path == "/api/player/state":
                self.send_json(compat_player_state())
            elif parsed.path == "/api/system/info":
                self.send_json(compat_system_info())
            elif parsed.path == "/api/network/wifi/status":
                if wifi_status:
                    self.send_json(wifi_status())
                else:
                    self.send_json({"mode": "unknown", "ip": "", "hotspot": {"active": False}})
            elif parsed.path == "/api/network/wifi/scan":
                if wifi_scan:
                    cached_only = first_value(query.get("cached"), "").lower() in ("1", "true", "yes")
                    self.send_json(wifi_scan(cached_only=cached_only))
                else:
                    self.send_json({"networks": []})
            elif parsed.path == "/api/storage/network/status":
                self.send_json(network_storage_status() if network_storage_status else {"configured": False, "mounted": False})
            elif parsed.path == "/api/services":
                self.send_json(compat_services())
            elif parsed.path == "/api/audio/devices":
                self.send_json(compat_audio_devices())
            elif parsed.path == "/api/filesystem/roots":
                self.send_json(filesystem_roots())
            elif parsed.path == "/api/filesystem/browse":
                self.send_json(filesystem_browse(query))
            elif parsed.path == "/api/status":
                self.send_json(api_status())
            elif parsed.path == "/api/albums":
                self.send_json(api_albums())
            elif parsed.path == "/api/artists":
                self.send_json(api_artists())
            elif parsed.path == "/api/tracks":
                self.send_json(api_tracks(query))
            elif parsed.path == "/api/settings":
                self.send_json(compat_settings())
            elif parsed.path == "/api/art":
                art_path = get_art_file(query)
                renderer = first_value(query.get("renderer"))
                cache_control = "no-cache, must-revalidate" if renderer in ("airplay", "bluetooth") else "max-age=86400"
                self.send_file(art_path, cache_control=cache_control)
            elif parsed.path == "/api/stream":
                self.send_media_file(audio_stream_file(query))
            elif parsed.path == "/api/health":
                self.send_json({"ok": True, "time": int(time.time()), "library": use_library()})
            else:
                raise ApiError(404, "Not found")
        except ApiError as exc:
            self.send_json({"error": exc.message}, exc.status)
        except Exception as exc:
            self.send_json({"error": str(exc)}, 500)

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/api/player/"):
                self.send_json(compat_player_post(parsed.path, post_json(self)))
            elif parsed.path == "/api/library/rescan":
                self.send_json(trigger_library_scan())
            elif parsed.path == "/api/library/rebuild-cache":
                self.send_json(rebuild_art_cache())
            elif parsed.path == "/api/library/favourites":
                self.send_json(post_favourites(post_json(self)))
            elif parsed.path == "/api/library/playlists":
                self.send_json(post_create_playlist(post_json(self)))
            elif parsed.path == "/api/library/playlists/tracks":
                self.send_json(post_playlist_add_track(post_json(self)))
            elif parsed.path == "/api/library/radio/stations":
                self.send_json(post_radio_station(post_json(self)))
            elif parsed.path == "/api/library/radio/favourites":
                self.send_json(post_radio_favourite(post_json(self)))
            elif parsed.path == "/api/library/radio/remove":
                self.send_json(post_radio_remove(post_json(self)))
            elif parsed.path == "/api/network/wifi/connect":
                body = post_json(self)
                if not wifi_connect:
                    raise ApiError(503, "WiFi not available on this host")
                ssid = first_value(body.get("ssid"))
                password = first_value(body.get("password") or body.get("psk"))
                country = first_value(body.get("country")) or "GB"
                self.send_json(wifi_connect(ssid, password, country))
            elif parsed.path == "/api/network/hotspot/start":
                if not hotspot_start:
                    raise ApiError(503, "Hotspot not available on this host")
                self.send_json(hotspot_start())
            elif parsed.path == "/api/network/hotspot/stop":
                if not hotspot_stop:
                    raise ApiError(503, "Hotspot not available on this host")
                self.send_json(hotspot_stop())
            elif parsed.path == "/api/storage/network/configure":
                if not network_storage_configure:
                    raise ApiError(503, "Network storage is not available on this host")
                settings = load_settings()
                settings.update({"storage_source": "network", "music_directory": str(MUSIC_DIR)})
                write_settings(settings)
                try:
                    result = network_storage_configure(post_json(self))
                except ValueError as exc:
                    raise ApiError(400, str(exc))
                start_scan(Path(settings["music_directory"]), prefer_folder=False)
                self.send_json(result)
            elif parsed.path == "/api/services/control":
                self.send_json(control_service(post_json(self)))
            elif parsed.path == "/api/audio/output":
                if not apply_audio_output:
                    self.send_json({"ok": True, "message": "Audio output API unavailable."})
                else:
                    try:
                        body = post_json(self)
                        settings = load_settings()
                        result = apply_audio_output(settings, body)
                        for key in ("audio_output", "dac_hat", "alsa_device", "mixer"):
                            if key in body:
                                settings[key] = body[key]
                        if "output" in body:
                            settings["audio_output"] = (
                                normalize_route(body["output"]) if normalize_route else body["output"]
                            )
                        if "alsa" in body:
                            settings["alsa_device"] = body["alsa"]
                        write_settings(settings)
                        self.send_json(result)
                    except ValueError as exc:
                        raise ApiError(400, str(exc)) from exc
                    except RuntimeError as exc:
                        raise ApiError(500, str(exc)) from exc
            elif parsed.path == "/api/system/control":
                try:
                    data = post_json(self)
                except Exception:
                    data = {}
                action = data.get("action")
                if action not in ("reboot", "shutdown"):
                    raise ApiError(400, "Invalid action. Must be 'reboot' or 'shutdown'.")

                import threading
                import time

                def run_system_control():
                    time.sleep(1.0)
                    cmd = ["sudo", "/sbin/reboot"] if action == "reboot" else ["sudo", "/sbin/poweroff"]
                    subprocess.run(cmd)

                threading.Thread(target=run_system_control, daemon=True).start()
                self.send_json({"ok": True, "message": f"System {action} initiated."})
            elif parsed.path in POST_ACTIONS:
                self.send_json(POST_ACTIONS[parsed.path](post_json(self)))
            elif parsed.path in SIMPLE_MPD_POSTS:
                if parsed.path == "/api/rescan":
                    self.send_json(trigger_library_scan())
                else:
                    external = _external_transport_action(parsed.path)
                    if external is not None:
                        self.send_json(external)
                    else:
                        mpd.command(SIMPLE_MPD_POSTS[parsed.path])
                        self.send_json(api_status())
            else:
                raise ApiError(404, "Not found")
        except ApiError as exc:
            self.send_json({"error": exc.message}, exc.status)
        except Exception as exc:
            self.send_json({"error": str(exc)}, 500)


def main():
    ensure_dirs()
    init_db()
    settings = load_settings()
    if "storage_source" not in settings:
        settings["storage_source"] = "local"
        write_settings(settings)
    root = music_root()
    if music_found(root):
        start_scan(root)
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"PiTunes API listening on http://{LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import base64
import json
import mimetypes
import shutil
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
from library.db import album_count, init_db
from library.scanner import scan_status, start_scan
from library import queries as lib_queries

try:
    from network_wifi import hotspot_start, hotspot_stop, wifi_connect, wifi_scan, wifi_status
except ImportError:
    hotspot_start = hotspot_stop = wifi_connect = wifi_scan = wifi_status = None  # type: ignore

IMAGE_NAMES = art_resolver.IMAGE_NAMES


def ensure_dirs():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    ART_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not SETTINGS_FILE.exists():
        write_settings(
            {
                "music_directory": str(MUSIC_DIR),
                "audio_output": "auto",
                "album_art": "folder-first",
            }
        )


def load_settings():
    ensure_dirs()
    try:
        with SETTINGS_FILE.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {
            "music_directory": str(MUSIC_DIR),
            "audio_output": "auto",
            "album_art": "folder-first",
        }


def write_settings(settings):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(settings, fh, indent=2, sort_keys=True)
        fh.write("\n")
    tmp.replace(SETTINGS_FILE)


def music_root():
    settings = load_settings()
    return Path(settings.get("music_directory", str(MUSIC_DIR)))


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
        artist = filter_value.split(":", 1)[1] if filter_value.startswith("artist:") else None
        return lib_queries.list_albums(offset, limit, artist, sort)

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


def compat_search(query):
    q = query.get("q", [""])[0]
    limit = int(query.get("limit", [120])[0])
    if use_library():
        return lib_queries.search_albums(q, limit)
    q_lower = q.lower()
    albums = compat_albums({"limit": [str(limit)]})["albums"]
    if q_lower:
        albums = [album for album in albums if q_lower in album["title"].lower()]
    return {"albums": albums}


def compat_player_state():
    status = api_status()
    song = status.get("song") or {}
    return {
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
        "hostname": "echoflow",
        "uptime": "",
        "urls": ["http://echoflow.local"],
        "ip": [],
        "rootDisk": {},
    }


def compat_services():
    empty = [{"name": "not installed", "active": "inactive", "enabled": "disabled"}]
    return {"services": {"bluetooth": empty, "airplay": empty, "kiosk": empty}}


def compat_audio_devices():
    return {
        "devices": [
            {"alsa": "default", "label": "default - ALSA default output"},
            {"alsa": "hw:1,0", "label": "hw:1,0 - USB DAC"},
        ],
        "current": {"device": "default", "mixer": "software"},
    }


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


def find_folder_art(track_uri):
    if not track_uri:
        return None
    directory = safe_music_path(track_uri).parent
    return art_resolver.find_folder_art(directory)


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


def get_art_file(query):
    max_px = thumb_max_px(query)
    album_id = query.get("album_id", [None])[0]
    album = query.get("album", [None])[0]
    uri = query.get("file", [None])[0]

    if album_id and str(album_id).isdigit():
        art_path = lib_queries.album_art_source(int(album_id))
        if art_path:
            path = Path(art_path)
            if not path.is_absolute():
                path = safe_music_path(art_path)
            if path.is_file():
                return thumb_from_file(path, cache_key("file:" + str(path.resolve())), max_px)
        track_path = lib_queries.album_art_source(int(album_id))
        if track_path and not Path(track_path).is_absolute():
            uri = track_path

    if album and not uri:
        if use_library():
            item = lib_queries.album_by_title(album)
            if item:
                return get_art_file({"album_id": [item["id"]], "size": [str(max_px)]})
        uri = find_album_first_file(album)
    if not uri:
        raise ApiError(404, "No track found for artwork lookup")

    folder_art = find_folder_art(uri)
    if folder_art:
        return thumb_from_file(folder_art, cache_key("file:" + str(folder_art.resolve())), max_px)

    try:
        data, _metadata = mpd.binary("readpicture " + mpd_quote(uri) + " 0")
        return thumb_from_bytes(data, cache_key("embedded:" + uri), max_px)
    except ApiError:
        raise ApiError(404, "No artwork found")


def rebuild_art_cache():
    if not use_library():
        return {"ok": False, "message": "Library cache empty; run rescan first."}
    prefer_folder = load_settings().get("album_art", "folder-first") != "embedded-first"
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
    for key in ("music_directory", "audio_output", "album_art", "animationSpeed", "visibleCoverCount", "themeAccent"):
        if key in body:
            settings[key] = body[key]
    write_settings(settings)
    return {"settings": settings, "message": "Settings saved. Re-run configure-mpd.sh or reboot after audio output changes."}


def trigger_library_scan():
    prefer_folder = load_settings().get("album_art", "folder-first") != "embedded-first"
    start_scan(music_root(), prefer_folder=prefer_folder)
    return {"ok": True, "scan": scan_status()}


def compat_player_post(path, body):
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
        return seek({"seconds": body.get("seconds", 0)})
    if path == "/api/player/volume":
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
    server_version = "EchoFlowAPI/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path):
        mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "max-age=86400")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

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
                    self.send_json(wifi_scan())
                else:
                    self.send_json({"networks": []})
            elif parsed.path == "/api/services":
                self.send_json(compat_services())
            elif parsed.path == "/api/audio/devices":
                self.send_json(compat_audio_devices())
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
                self.send_file(get_art_file(query))
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
            elif parsed.path in ("/api/services/control", "/api/audio/output", "/api/system/control"):
                self.send_json({"ok": True, "message": "Command accepted by EchoFlow compatibility API."})
            elif parsed.path in POST_ACTIONS:
                self.send_json(POST_ACTIONS[parsed.path](post_json(self)))
            elif parsed.path in SIMPLE_MPD_POSTS:
                if parsed.path == "/api/rescan":
                    self.send_json(trigger_library_scan())
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
    root = music_root()
    if album_count() == 0 and root.is_dir():
        start_scan(root)
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"EchoFlow API listening on http://{LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()

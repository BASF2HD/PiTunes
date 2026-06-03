#!/usr/bin/env python3
import json
import mimetypes
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
HOST = os.environ.get("ECHOFLOW_MOCK_HOST", "127.0.0.1")
PORT = int(os.environ.get("ECHOFLOW_MOCK_PORT", "8090"))

ALBUMS = [
    {
        "album": "Kind of Blue",
        "artist": "Miles Davis",
        "color": "#2fb7a3",
        "tracks": [
            ("1", "So What", 545),
            ("2", "Freddie Freeloader", 590),
            ("3", "Blue in Green", 337),
        ],
    },
    {
        "album": "Blue Train",
        "artist": "John Coltrane",
        "color": "#e35d49",
        "tracks": [
            ("1", "Blue Train", 643),
            ("2", "Moment's Notice", 398),
            ("3", "Locomotion", 434),
        ],
    },
    {
        "album": "Offline Sessions",
        "artist": "The Local Quartet",
        "color": "#d8ac55",
        "tracks": [
            ("1", "Boot Room Waltz", 254),
            ("2", "No Cloud Needed", 221),
            ("3", "USB Dawn", 288),
        ],
    },
    {
        "album": "Pi After Dark",
        "artist": "EchoFlow Demo Band",
        "color": "#7d8fce",
        "tracks": [
            ("1", "GPIO Glow", 312),
            ("2", "Tiny Amp", 205),
            ("3", "Library Scan", 182),
        ],
    },
]

STATUS = {
    "state": "play",
    "volume": 64,
    "elapsed": 84,
    "duration": 545,
    "song": {
        "file": "Kind of Blue/01 - So What.mp3",
        "title": "So What",
        "artist": "Miles Davis",
        "album": "Kind of Blue",
        "track": "1",
        "duration": 545,
    },
}


def all_tracks():
    rows = []
    for album in ALBUMS:
        for track, title, duration in album["tracks"]:
            rows.append(
                {
                    "file": f"{album['album']}/{track.zfill(2)} - {title}.mp3",
                    "title": title,
                    "artist": album["artist"],
                    "album": album["album"],
                    "track": track,
                    "duration": duration,
                }
            )
    return rows


def compat_album(item):
    return {
        "id": quote(item["album"], safe=""),
        "title": item["album"],
        "artist": item["artist"],
        "albumArtist": item["artist"],
        "year": "1959" if item["album"] == "Kind of Blue" else "",
        "artUrl": f"/api/art?album={quote(item['album'])}",
    }


def compat_track(track):
    return {
        "id": track["file"],
        "file": track["file"],
        "trackNumber": track["track"],
        "title": track["title"],
        "duration": track["duration"],
    }


def compat_state():
    song = STATUS.get("song") or {}
    return {
        "status": {
            "state": STATUS.get("state", "stop"),
            "volume": STATUS.get("volume", 0),
            "elapsed": STATUS.get("elapsed", 0),
            "duration": STATUS.get("duration", 0),
        },
        "song": {
            "Title": song.get("title", ""),
            "Artist": song.get("artist", ""),
            "Album": song.get("album", ""),
            "file": song.get("file", ""),
            "Time": song.get("duration", 0),
        },
    }


def album_art(album_name):
    album = next((item for item in ALBUMS if item["album"] == album_name), ALBUMS[0])
    title = album["album"].replace("&", "&amp;")
    artist = album["artist"].replace("&", "&amp;")
    color = album["color"]
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420" viewBox="0 0 420 420">
  <rect width="420" height="420" fill="#111412"/>
  <circle cx="306" cy="110" r="92" fill="{color}"/>
  <rect x="48" y="218" width="324" height="96" rx="10" fill="#f4f1e8" opacity=".9"/>
  <text x="52" y="268" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#111412">{title}</text>
  <text x="52" y="344" font-family="Arial, sans-serif" font-size="24" fill="#f4f1e8">{artist}</text>
</svg>""".encode("utf-8")


def read_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if not length:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(fmt % args)

    def json(self, payload, status=200):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_static(self, path):
        target = (FRONTEND / path.lstrip("/")).resolve()
        if path == "/" or path == "":
            target = FRONTEND / "index.html"
        if not str(target).startswith(str(FRONTEND.resolve())) or not target.exists():
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")
            return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(str(target))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        tracks = all_tracks()

        if parsed.path == "/api/library/albums":
            filter_value = query.get("filter", [""])[0]
            albums = ALBUMS
            if filter_value.startswith("artist:"):
                artist = filter_value.split(":", 1)[1]
                albums = [album for album in albums if album["artist"] == artist]
            self.json({"albums": [compat_album(item) for item in albums]})
        elif parsed.path.startswith("/api/library/album/") and parsed.path.endswith("/tracks"):
            album_id = parsed.path[len("/api/library/album/") : -len("/tracks")]
            album_name = unquote(album_id)
            rows = [track for track in tracks if track["album"] == album_name]
            self.json({"tracks": [compat_track(track) for track in rows]})
        elif parsed.path == "/api/library/artists":
            self.json({"artists": [{"name": item["artist"], "album_count": 1} for item in ALBUMS]})
        elif parsed.path == "/api/library/genres":
            self.json({"genres": [{"name": "Jazz", "album_count": 2}, {"name": "Local", "album_count": 2}]})
        elif parsed.path == "/api/library/years":
            self.json({"years": [{"year": 1959, "album_count": 1}, {"year": 2026, "album_count": 3}]})
        elif parsed.path == "/api/search":
            q = query.get("q", [""])[0].lower()
            self.json({"albums": [compat_album(item) for item in ALBUMS if q in item["album"].lower() or q in item["artist"].lower()]})
        elif parsed.path == "/api/player/state":
            if STATUS["state"] == "play":
                STATUS["elapsed"] = min(STATUS["duration"], STATUS["elapsed"] + 3)
            self.json(compat_state())
        elif parsed.path == "/api/system/info":
            self.json({"hostname": "echoflow", "uptime": "mock", "urls": ["http://127.0.0.1:8090", "http://echoflow.local"], "ip": ["127.0.0.1"], "rootDisk": {"mock": True}})
        elif parsed.path == "/api/network/wifi/status":
            self.json({"iface": "wlan0", "state": "mock", "connection": "Local test", "ip": ["127.0.0.1"]})
        elif parsed.path == "/api/network/wifi/scan":
            self.json({"networks": [{"ssid": "EchoFlow-Test", "signal": 92, "security": "WPA2"}]})
        elif parsed.path == "/api/services":
            service = [{"name": "mock", "active": "inactive", "enabled": "disabled"}]
            self.json({"services": {"bluetooth": service, "airplay": service, "kiosk": service}})
        elif parsed.path == "/api/audio/devices":
            self.json({"devices": [{"alsa": "default", "label": "default - Mock ALSA"}, {"alsa": "hw:1,0", "label": "hw:1,0 - Mock USB DAC"}], "current": {"device": "default", "mixer": "software"}})
        elif parsed.path == "/api/albums":
            self.json({"albums": [{"album": item["album"], "art_url": f"/api/art?album={item['album']}"} for item in ALBUMS]})
        elif parsed.path == "/api/artists":
            self.json({"artists": sorted({item["artist"] for item in ALBUMS})})
        elif parsed.path == "/api/tracks":
            album = query.get("album", [None])[0]
            artist = query.get("artist", [None])[0]
            if album:
                tracks = [track for track in tracks if track["album"] == album]
            if artist:
                tracks = [track for track in tracks if track["artist"] == artist]
            self.json({"tracks": tracks})
        elif parsed.path == "/api/status":
            if STATUS["state"] == "play":
                STATUS["elapsed"] = min(STATUS["duration"], STATUS["elapsed"] + 3)
            self.json(STATUS)
        elif parsed.path == "/api/settings":
            self.json({
                "settings": {"music_directory": "/mnt/music", "audio_output": "auto", "animationSpeed": 0.18, "visibleCoverCount": 96, "themeAccent": "#8ea0ff"},
                "config": {"musicDir": "/mnt/music", "ui": {"animationSpeed": 0.18, "visibleCoverCount": 96, "themeAccent": "#8ea0ff"}},
                "scan": {"ok": True, "mock": True},
                "counts": {"albums": len(ALBUMS), "tracks": len(tracks)},
                "outputs": [],
            })
        elif parsed.path == "/api/health":
            self.json({"ok": True, "mock": True, "time": int(time.time())})
        elif parsed.path == "/api/art":
            data = album_art(query.get("album", ["Kind of Blue"])[0])
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        body = read_json(self)
        tracks = all_tracks()
        if parsed.path == "/api/player/play":
            track = next((item for item in tracks if item["file"] == body.get("trackId")), None)
            if track:
                STATUS.update({"state": "play", "elapsed": 0, "duration": track["duration"], "song": track})
            else:
                STATUS["state"] = "play"
        elif parsed.path == "/api/player/pause":
            STATUS["state"] = "pause"
        elif parsed.path == "/api/player/previous":
            STATUS["elapsed"] = 0
        elif parsed.path == "/api/player/next":
            STATUS["elapsed"] = 0
        elif parsed.path == "/api/player/seek":
            STATUS["elapsed"] = max(0, min(STATUS["duration"], int(float(body.get("seconds", 0)))))
        elif parsed.path == "/api/player/volume":
            STATUS["volume"] = max(0, min(100, int(body.get("volume", 0))))
        elif parsed.path == "/api/player/queue":
            album_name = unquote(body.get("albumId", ""))
            album_tracks = [track for track in tracks if track["album"] == album_name]
            if album_tracks and body.get("play"):
                STATUS.update({"state": "play", "elapsed": 0, "duration": album_tracks[0]["duration"], "song": album_tracks[0]})
        elif parsed.path in ("/api/library/rescan", "/api/library/rebuild-cache", "/api/network/wifi/connect", "/api/services/control", "/api/audio/output", "/api/system/control"):
            self.json({"ok": True, "message": "Mock command accepted."})
            return
        elif parsed.path == "/api/play-album":
            album_tracks = [track for track in tracks if track["album"] == body.get("album")]
            if album_tracks:
                STATUS.update({"state": "play", "elapsed": 0, "duration": album_tracks[0]["duration"], "song": album_tracks[0]})
        elif parsed.path == "/api/play-track":
            track = next((item for item in tracks if item["file"] == body.get("file")), None)
            if track:
                STATUS.update({"state": "play", "elapsed": 0, "duration": track["duration"], "song": track})
        elif parsed.path == "/api/pause":
            STATUS["state"] = "pause"
        elif parsed.path == "/api/resume":
            STATUS["state"] = "play"
        elif parsed.path == "/api/toggle":
            STATUS["state"] = "pause" if STATUS["state"] == "play" else "play"
        elif parsed.path == "/api/stop":
            STATUS["state"] = "stop"
            STATUS["elapsed"] = 0
        elif parsed.path == "/api/volume":
            STATUS["volume"] = max(0, min(100, int(body.get("volume", 0))))
        elif parsed.path == "/api/seek":
            STATUS["elapsed"] = max(0, min(STATUS["duration"], int(float(body.get("seconds", 0)))))
        self.json(compat_state() if parsed.path.startswith("/api/player/") else (STATUS if parsed.path != "/api/settings" else {"settings": body, "message": "Mock settings saved."}))


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"EchoFlow mock server: http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()

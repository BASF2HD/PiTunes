#!/usr/bin/env python3
import json
import mimetypes
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


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

        if parsed.path == "/api/albums":
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
            self.json({"settings": {"music_directory": "/mnt/music", "audio_output": "auto"}})
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
        if parsed.path == "/api/play-album":
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
        self.json(STATUS if parsed.path != "/api/settings" else {"settings": body, "message": "Mock settings saved."})


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"EchoFlow mock server: http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()

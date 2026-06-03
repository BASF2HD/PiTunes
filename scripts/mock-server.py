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

DEMO_ALBUMS = [
    ("Abirami", "A. R. Rahman", "#f6d66b", "#c01862"),
    ("Kind of Blue", "Miles Davis", "#2fb7a3", "#162a66"),
    ("Blue Train", "John Coltrane", "#e35d49", "#101820"),
    ("Offline Sessions", "The Local Quartet", "#d8ac55", "#273040"),
    ("Pi After Dark", "EchoFlow Demo Band", "#7d8fce", "#161f3b"),
    ("Velvet Morning", "Nila & The Strings", "#b21f5b", "#f4dfb8"),
    ("Tape Echoes", "Studio 8090", "#f47c48", "#241510"),
    ("Monsoon Drive", "Kaveri Radio", "#4ab2d9", "#0d2a38"),
    ("Signal Path", "Analog Circle", "#a7d46f", "#1a2b16"),
    ("Night Bazaar", "Madras Electric", "#f0a33a", "#29121d"),
    ("Copper Sky", "The Rooftop Five", "#c57345", "#10151d"),
    ("Vinyl Garden", "Green Room", "#82b86c", "#183022"),
    ("Low Tide", "Harbour Lights", "#4e8bd8", "#091827"),
    ("Cinema Road", "Playback Club", "#ffcd55", "#781d28"),
    ("Half Speed", "Reel Machine", "#b4b4bc", "#151515"),
    ("Chorus Line", "The Brights", "#ef6f91", "#24101b"),
    ("Temple Radio", "South Street", "#e0552f", "#f0d8a8"),
    ("Cloudless", "No Net Trio", "#78d7c5", "#192126"),
    ("Dusty Needle", "Mono Press", "#b99362", "#21160f"),
    ("Neon Veena", "Digital Raga", "#8d67ff", "#101028"),
    ("Side A", "Cassette House", "#ff895d", "#20252f"),
    ("River Loop", "Delta Ensemble", "#58a88f", "#071c20"),
    ("Chrome Dreams", "Late Station", "#c9d2de", "#202838"),
    ("Palm Wine", "Coastal Band", "#f3bf4f", "#20321a"),
    ("Red Label", "The Collectors", "#d94242", "#1b1010"),
    ("Mirror Lake", "North Pier", "#7fb0ff", "#101a34"),
    ("Warm Static", "AM Midnight", "#e2b36b", "#352116"),
    ("Tape 4", "Basement Session", "#6f7a89", "#101214"),
    ("Silver Screen", "Matinee Orchestra", "#dad4c5", "#202020"),
    ("EchoFlow Test LP", "Local Library", "#8ea0ff", "#07090d"),
]

ALBUMS = [
    {
        "album": album,
        "artist": artist,
        "color": color,
        "accent": accent,
        "year": str(1980 + (index % 35)),
        "tracks": [
            ("1", f"{album} Theme", 210 + index * 3),
            ("2", "Interlude", 180 + index * 2),
            ("3", "Final Cut", 240 + index * 4),
        ],
    }
    for index, (album, artist, color, accent) in enumerate(DEMO_ALBUMS)
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
        "year": item.get("year", ""),
        "artUrl": f"/api/art?album={quote(item['album'])}&size=128",
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
    accent = album.get("accent", "#111")
    title_size = 42 if len(title) < 13 else 32
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420" viewBox="0 0 420 420">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="{color}"/>
      <stop offset="1" stop-color="{accent}"/>
    </linearGradient>
    <pattern id="p" width="36" height="36" patternUnits="userSpaceOnUse">
      <circle cx="6" cy="6" r="2.5" fill="rgba(255,255,255,.22)"/>
      <path d="M0 36 36 0" stroke="rgba(255,255,255,.08)" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="420" height="420" fill="url(#g)"/>
  <rect width="420" height="420" fill="url(#p)" opacity=".7"/>
  <circle cx="302" cy="134" r="106" fill="rgba(0,0,0,.78)"/>
  <circle cx="302" cy="134" r="34" fill="rgba(255,255,255,.82)"/>
  <rect x="32" y="270" width="356" height="98" rx="0" fill="rgba(255,255,255,.88)"/>
  <text x="48" y="323" font-family="Arial, sans-serif" font-size="{title_size}" font-weight="800" fill="#111">{title}</text>
  <text x="48" y="354" font-family="Arial, sans-serif" font-size="22" fill="#333">{artist}</text>
  <text x="48" y="84" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="rgba(255,255,255,.86)">ECHOFLOW STEREO</text>
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
        mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        if target.suffix in (".html", ".js", ".css"):
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        tracks = all_tracks()

        if parsed.path == "/api/library/albums":
            filter_value = query.get("filter", [""])[0]
            offset = int(query.get("offset", [0])[0])
            limit = int(query.get("limit", [96])[0])
            albums = ALBUMS
            if filter_value.startswith("artist:"):
                artist = filter_value.split(":", 1)[1]
                albums = [album for album in albums if album["artist"] == artist]
            total = len(albums)
            page = albums[offset : offset + limit]
            self.json({
                "albums": [compat_album(item) for item in page],
                "total": total,
                "offset": offset,
                "limit": limit,
            })
        elif parsed.path == "/api/library/scan-status":
            self.json({"running": False, "albumCount": len(ALBUMS), "message": "mock"})
        elif parsed.path.startswith("/api/library/album/") and parsed.path.endswith("/tracks"):
            album_id = parsed.path[len("/api/library/album/") : -len("/tracks")]
            album_name = unquote(album_id)
            rows = [track for track in tracks if track["album"] == album_name]
            self.json({"tracks": [compat_track(track) for track in rows]})
        elif parsed.path == "/api/library/artists":
            artists = {}
            for item in ALBUMS:
                artists[item["artist"]] = artists.get(item["artist"], 0) + 1
            self.json({"artists": [{"name": name, "album_count": count} for name, count in artists.items()]})
        elif parsed.path == "/api/library/genres":
            self.json({"genres": [{"name": "Jazz", "album_count": 2}, {"name": "Local", "album_count": 2}]})
        elif parsed.path == "/api/library/years":
            years = {}
            for item in ALBUMS:
                years[item["year"]] = years.get(item["year"], 0) + 1
            self.json({"years": [{"year": year, "album_count": count} for year, count in years.items()]})
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
            self.json({
                "mode": "mock",
                "ip": "127.0.0.1",
                "hotspot": {"ssid": "EchoFlow", "ip": "172.24.1.1", "active": False},
                "station": {"ssid": "", "configured": False},
                "urls": ["http://127.0.0.1:8090", "http://echoflow.local"],
            })
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
            current = STATUS.get("song") or {}
            idx = next((i for i, t in enumerate(tracks) if t["file"] == current.get("file")), -1)
            if idx > 0:
                track = tracks[idx - 1]
                STATUS.update({"state": "play", "elapsed": 0, "duration": track["duration"], "song": track})
            else:
                STATUS["elapsed"] = max(0, STATUS.get("elapsed", 0) - 15)
        elif parsed.path == "/api/player/next":
            current = STATUS.get("song") or {}
            idx = next((i for i, t in enumerate(tracks) if t["file"] == current.get("file")), -1)
            if 0 <= idx < len(tracks) - 1:
                track = tracks[idx + 1]
                STATUS.update({"state": "play", "elapsed": 0, "duration": track["duration"], "song": track})
            else:
                STATUS["elapsed"] = min(STATUS.get("duration", 0), STATUS.get("elapsed", 0) + 15)
        elif parsed.path == "/api/player/seek":
            STATUS["elapsed"] = max(0, min(STATUS["duration"], int(float(body.get("seconds", 0)))))
        elif parsed.path == "/api/player/volume":
            STATUS["volume"] = max(0, min(100, int(body.get("volume", 0))))
        elif parsed.path == "/api/player/queue":
            album_key = unquote(str(body.get("albumId", "")))
            album_tracks = [
                track
                for track in tracks
                if track["album"] == album_key or quote(track["album"], safe="") == album_key
            ]
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

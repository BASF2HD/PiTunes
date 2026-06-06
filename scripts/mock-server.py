#!/usr/bin/env python3
import json
import mimetypes
import os
import re
import threading
import time
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

try:
    from mutagen import File as MutagenFile
    from mutagen.flac import Picture
except Exception:
    MutagenFile = None
    Picture = None


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
HOST = os.environ.get("ECHOFLOW_MOCK_HOST", "127.0.0.1")
PORT = int(os.environ.get("ECHOFLOW_MOCK_PORT", "8090"))
MOCK_SETTINGS_FILE = Path(os.environ.get("ECHOFLOW_MOCK_SETTINGS_FILE", "/tmp/echoflow-mock-settings.json"))
AUDIO_EXTENSIONS = {".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".aiff", ".alac"}
SKIP_SCAN_DIR_NAMES = {"__macosx", ".spotlight-v100", ".trashes", "@eadir"}

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

MOCK_SCAN = {
    "running": False,
    "progress": 0,
    "message": f"Ready: {len(ALBUMS)} albums",
    "lastError": "",
    "albumCount": len(ALBUMS),
}
MOCK_SCAN_LOCK = threading.Lock()
MOCK_WIFI = {
    "ssid": "",
    "configured": False,
    "connected": False,
    "ip": "",
}
MOCK_HOTSPOT = {
    "active": False,
    "ssid": "EchoFlow",
    "ip": "172.24.1.1",
}
MOCK_SERVICES = {
    "ssh": True,
    "bluetooth": False,
    "airplay": False,
    "kiosk": False,
}

MOCK_SETTINGS = {
    "music_directory": "/mnt/music",
    "storage_source": "local",
    "audio_output": "auto",
    "alsa_device": "default",
    "mixer": "software",
    "album_art": "embedded-first",
    "animationSpeed": 0.18,
    "visibleCoverCount": 96,
    "themeAccent": "#8ea0ff",
}

try:
    MOCK_SETTINGS.update(json.loads(MOCK_SETTINGS_FILE.read_text(encoding="utf-8")))
except (OSError, json.JSONDecodeError):
    pass


def save_mock_settings():
    MOCK_SETTINGS_FILE.write_text(json.dumps(MOCK_SETTINGS, indent=2) + "\n", encoding="utf-8")


def mock_service_state(name):
    active = bool(MOCK_SERVICES.get(name))
    return [{
        "name": "mock",
        "unit": f"mock-{name}.service",
        "active": "active" if active else "inactive",
        "enabled": "enabled" if active else "disabled",
    }]


def audio_mime_type(path):
    overrides = {
        ".aac": "audio/aac",
        ".aiff": "audio/aiff",
        ".alac": "audio/mp4",
        ".flac": "audio/flac",
        ".m4a": "audio/mp4",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg",
        ".wav": "audio/wav",
    }
    return overrides.get(path.suffix.lower()) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"


def all_tracks():
    rows = []
    for album in ALBUMS:
        for index, track_info in enumerate(album["tracks"], start=1):
            if isinstance(track_info, dict):
                rows.append({
                    "file": track_info["file"],
                    "title": track_info["title"],
                    "artist": album["artist"],
                    "album": album["album"],
                    "track": str(track_info.get("track") or index),
                    "duration": int(track_info.get("duration") or 0),
                })
            else:
                track, title, duration = track_info
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


def scan_mock_library(music_directory):
    root = Path(str(music_directory or "")).expanduser()
    if not root.is_dir():
        return []
    albums = {}
    for current_root, dirs, files in os.walk(root):
        dirs[:] = [
            name
            for name in dirs
            if not name.startswith(".") and name.casefold() not in SKIP_SCAN_DIR_NAMES
        ]
        current = Path(current_root)
        audio_files = sorted(
            (name for name in files if (current / name).suffix.lower() in AUDIO_EXTENSIONS),
            key=str.casefold,
        )
        for name in audio_files:
            path = current / name
            try:
                rel = path.relative_to(root)
            except ValueError:
                rel = path
            parts = rel.parts
            album_name = path.parent.name if path.parent != root else root.name
            artist = path.parent.parent.name if path.parent.parent != root.parent and path.parent != root else "Local Library"
            if len(parts) >= 3:
                artist = parts[-3]
            match = re.match(r"^\s*(\d+)[\s._-]+(.+)$", path.stem)
            track_no = match.group(1) if match else str(len(albums.get(album_name, {}).get("tracks", [])) + 1)
            title = match.group(2) if match else path.stem
            album = albums.setdefault(album_name, {
                "album": album_name,
                "artist": artist,
                "color": "#8ea0ff",
                "accent": "#151621",
                "year": "",
                "tracks": [],
            })
            album["tracks"].append({
                "file": rel.as_posix(),
                "title": title,
                "track": track_no,
                "duration": 0,
            })
    return sorted(albums.values(), key=lambda item: item["album"].casefold())


def start_mock_library_scan():
    with MOCK_SCAN_LOCK:
        if MOCK_SCAN["running"]:
            return {"running": True, **MOCK_SCAN}
        MOCK_SCAN.update({
            "running": True,
            "progress": 0,
            "message": "Scanning files",
            "lastError": "",
            "albumCount": len(ALBUMS),
        })

    thread = threading.Thread(target=run_mock_library_scan, name="echoflow-mock-scan", daemon=True)
    thread.start()
    return {"running": True, **MOCK_SCAN}


def run_mock_library_scan():
    global ALBUMS
    try:
        scanned_albums = scan_mock_library(MOCK_SETTINGS["music_directory"])
        if not scanned_albums:
            time.sleep(0.8)
            ALBUMS = []
            with MOCK_SCAN_LOCK:
                MOCK_SCAN.update({
                    "running": False,
                    "progress": 0,
                    "message": "Scan complete",
                    "albumCount": 0,
                    "lastError": "",
                })
            return

        revealed = []
        files_seen = 0
        for album in scanned_albums:
            revealed.append(album)
            files_seen += len(album.get("tracks", []))
            ALBUMS = list(revealed)
            with MOCK_SCAN_LOCK:
                MOCK_SCAN.update({
                    "running": True,
                    "progress": files_seen,
                    "message": f"Scanned {files_seen} files",
                    "albumCount": len(ALBUMS),
                })
            time.sleep(0.08)

        ALBUMS = scanned_albums
        with MOCK_SCAN_LOCK:
            MOCK_SCAN.update({
                "running": False,
                "progress": files_seen,
                "message": "Scan complete",
                "albumCount": len(ALBUMS),
                "lastError": "",
            })
    except Exception as exc:
        with MOCK_SCAN_LOCK:
            MOCK_SCAN.update({
                "running": False,
                "message": "Scan failed",
                "lastError": str(exc),
                "albumCount": len(ALBUMS),
            })


def mock_scan_status():
    with MOCK_SCAN_LOCK:
        return {**MOCK_SCAN, "albumCount": len(ALBUMS)}


def embedded_art_bytes(path):
    mp4_art = embedded_mp4_art_bytes(path)
    if mp4_art:
        return mp4_art
    flac_art = embedded_flac_art_bytes(path)
    if flac_art:
        return flac_art
    id3_art = embedded_id3_art_bytes(path)
    if id3_art:
        return id3_art
    if MutagenFile is None:
        return None
    try:
        audio = MutagenFile(path)
    except Exception:
        return None
    if audio is None:
        return None
    for picture in getattr(audio, "pictures", None) or []:
        data = getattr(picture, "data", None)
        if data:
            return bytes(data), getattr(picture, "mime", "") or "image/jpeg"
    tags = getattr(audio, "tags", None) or {}
    try:
        frames = list(tags.values())
    except Exception:
        frames = []
    for frame in frames:
        data = getattr(frame, "data", None)
        mime = getattr(frame, "mime", "") or "image/jpeg"
        frame_id = getattr(frame, "FrameID", "")
        if data and (frame_id == "APIC" or str(mime).startswith("image/")):
            return bytes(data), mime
    covr = tags.get("covr") if hasattr(tags, "get") else None
    if covr:
        cover = covr[0] if isinstance(covr, list) else covr
        return bytes(cover), "image/jpeg"
    blocks = tags.get("metadata_block_picture") if hasattr(tags, "get") else None
    if blocks and Picture is not None:
        block = blocks[0] if isinstance(blocks, list) else blocks
        try:
            picture = Picture(base64.b64decode(block))
            if picture.data:
                return bytes(picture.data), picture.mime or "image/jpeg"
        except Exception:
            pass
    return None


def embedded_mp4_art_bytes(path):
    if path.suffix.lower() not in {".m4a", ".mp4", ".aac", ".alac"}:
        return None
    try:
        file_size = path.stat().st_size
        with path.open("rb") as fh:
            while fh.tell() + 8 <= file_size:
                atom_start = fh.tell()
                header = fh.read(8)
                if len(header) != 8:
                    return None
                atom_size = int.from_bytes(header[:4], "big")
                atom_type = header[4:8]
                header_size = 8
                if atom_size == 1:
                    extended = fh.read(8)
                    if len(extended) != 8:
                        return None
                    atom_size = int.from_bytes(extended, "big")
                    header_size = 16
                elif atom_size == 0:
                    atom_size = file_size - atom_start
                if atom_size < header_size:
                    return None
                payload_size = atom_size - header_size
                if atom_type == b"moov":
                    return image_from_mp4_atoms(fh.read(payload_size))
                fh.seek(payload_size, 1)
    except OSError:
        return None
    return None


def image_from_mp4_atoms(data, start=0, end=None):
    pos = start
    limit = len(data) if end is None else min(end, len(data))
    while pos + 8 <= limit:
        atom_size = int.from_bytes(data[pos:pos + 4], "big")
        atom_type = data[pos + 4:pos + 8]
        header_size = 8
        if atom_size == 1 and pos + 16 <= limit:
            atom_size = int.from_bytes(data[pos + 8:pos + 16], "big")
            header_size = 16
        elif atom_size == 0:
            atom_size = limit - pos
        if atom_size < header_size or pos + atom_size > limit:
            break
        body_start = pos + header_size
        body_end = pos + atom_size
        if atom_type == b"covr":
            image = image_from_mp4_cover_atom(data[body_start:body_end])
            if image:
                return image
        elif atom_type in {b"moov", b"udta", b"ilst"}:
            image = image_from_mp4_atoms(data, body_start, body_end)
            if image:
                return image
        elif atom_type == b"meta":
            image = image_from_mp4_atoms(data, min(body_start + 4, body_end), body_end)
            if image:
                return image
        pos += atom_size
    return None


def image_from_mp4_cover_atom(data):
    pos = 0
    while pos + 16 <= len(data):
        atom_size = int.from_bytes(data[pos:pos + 4], "big")
        atom_type = data[pos + 4:pos + 8]
        if atom_size < 16 or pos + atom_size > len(data):
            break
        if atom_type == b"data":
            data_type = int.from_bytes(data[pos + 8:pos + 12], "big") & 0xFFFFFF
            image = data[pos + 16:pos + atom_size]
            if image:
                mime = "image/png" if data_type == 14 else "image/jpeg"
                detected = image_from_raw_bytes(image)
                return detected or (bytes(image), mime)
        pos += atom_size
    return None


def embedded_flac_art_bytes(path):
    try:
        with path.open("rb") as fh:
            if fh.read(4) != b"fLaC":
                return None
            while True:
                header = fh.read(4)
                if len(header) != 4:
                    return None
                block_type = header[0] & 0x7F
                is_last = bool(header[0] & 0x80)
                block_size = int.from_bytes(header[1:4], "big")
                block = fh.read(block_size)
                if len(block) != block_size:
                    return None
                if block_type == 6:
                    image = image_from_flac_picture_block(block)
                    if image:
                        return image
                if is_last:
                    return None
    except OSError:
        return None


def image_from_flac_picture_block(block):
    try:
        offset = 4
        mime_len = int.from_bytes(block[offset:offset + 4], "big")
        offset += 4
        mime = block[offset:offset + mime_len].decode("ascii", "replace") or "image/jpeg"
        offset += mime_len
        description_len = int.from_bytes(block[offset:offset + 4], "big")
        offset += 4 + description_len
        offset += 16
        data_len = int.from_bytes(block[offset:offset + 4], "big")
        offset += 4
        data = block[offset:offset + data_len]
    except Exception:
        return None
    if data:
        return bytes(data), mime
    return None


def embedded_id3_art_bytes(path):
    try:
        with path.open("rb") as fh:
            header = fh.read(10)
            if len(header) != 10:
                return None
            if header[:3] == b"ID3":
                return image_from_id3_payload(header[3], fh.read(syncsafe_to_int(header[6:10])))
            if header[:4] == b"RIFF" and header[8:10] == b"WA":
                return embedded_id3_art_from_riff(fh)
    except OSError:
        return None
    return None


def embedded_id3_art_from_riff(fh):
    try:
        fh.seek(12)
        while True:
            header = fh.read(8)
            if len(header) != 8:
                return None
            chunk_id = header[:4]
            chunk_size = int.from_bytes(header[4:8], "little")
            if chunk_id.rstrip() == b"ID3":
                tag_header = fh.read(10)
                if len(tag_header) != 10 or tag_header[:3] != b"ID3":
                    return None
                return image_from_id3_payload(tag_header[3], fh.read(syncsafe_to_int(tag_header[6:10])))
            fh.seek(chunk_size + (chunk_size % 2), 1)
    except OSError:
        return None


def image_from_id3_payload(version, tag):
    offset = 0
    while offset + 10 <= len(tag):
        frame_id = tag[offset:offset + 4]
        if not frame_id.strip(b"\x00"):
            break
        raw_size = tag[offset + 4:offset + 8]
        frame_size = syncsafe_to_int(raw_size) if version == 4 else int.from_bytes(raw_size, "big")
        frame = tag[offset + 10:offset + 10 + frame_size]
        if frame_id == b"APIC":
            image = image_from_apic_frame(frame)
            if image:
                return image
        offset += 10 + max(frame_size, 0)
    return None


def syncsafe_to_int(data):
    value = 0
    for byte in data:
        value = (value << 7) | (byte & 0x7F)
    return value


def image_from_apic_frame(frame):
    return image_from_raw_bytes(frame)


def image_from_raw_bytes(frame):
    signatures = [
        (b"\xff\xd8\xff", "image/jpeg"),
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"GIF87a", "image/gif"),
        (b"GIF89a", "image/gif"),
        (b"RIFF", "image/webp"),
    ]
    for signature, mime in signatures:
        index = frame.find(signature)
        if index >= 0:
            return frame[index:], mime
    return None


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
    fallback = {
        "album": album_name or "EchoFlow",
        "artist": "No albums",
        "color": "#8ea0ff",
        "accent": "#151621",
        "tracks": [],
    }
    album = next((item for item in ALBUMS if item["album"] == album_name), ALBUMS[0] if ALBUMS else fallback)
    if album.get("tracks"):
        first = album["tracks"][0]
        rel = first.get("file") if isinstance(first, dict) else f"{album['album']}/{str(first[0]).zfill(2)} - {first[1]}.mp3"
        embedded = embedded_art_bytes(Path(MOCK_SETTINGS["music_directory"]) / rel)
        if embedded:
            return embedded
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
</svg>""".encode("utf-8"), "image/svg+xml"


def read_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if not length:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def filesystem_roots():
    selected = MOCK_SETTINGS.get("storage_source", "local")
    candidates = [
        ("/Volumes", "local", "Local HDD / SSD", "USB-connected HDD, SSD, or flash drive. EchoFlow scans it automatically."),
        (str(Path.home()), "internal", "Internal Storage", "Music stored on this computer's internal drive."),
    ]
    roots = []
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
        roots.append({"path": key, "kind": kind, "label": label, "description": description, "available": True, "readable": os.access(resolved, os.R_OK), "selected": selected == kind})
    network_selected = selected == "network"
    roots.append({"path": "/mnt/music", "kind": "network", "label": "Network Storage", "description": "Connected NAS share." if network_selected else "Connect a NAS or network share.", "available": True, "readable": network_selected, "selected": network_selected, "action": "configure-network", "status": {"configured": network_selected, "mounted": network_selected, "protocol": "smb", "server": "nas.local" if network_selected else "", "share": "Music" if network_selected else "", "username": ""}})
    return {"roots": roots}


def filesystem_browse(query):
    raw_path = query.get("path", [MOCK_SETTINGS.get("music_directory", "/mnt/music")])[0]
    path = Path(str(raw_path or "/mnt/music")).expanduser()
    try:
        resolved = path.resolve()
    except OSError:
        return {"error": "Folder not found"}, 400
    if not resolved.is_dir():
        return {"error": "Folder not found"}, 400
    if not os.access(resolved, os.R_OK):
        return {"error": "Folder is not readable"}, 403
    try:
        children = sorted((child for child in resolved.iterdir() if child.is_dir()), key=lambda child: child.name.casefold())
    except OSError as exc:
        return {"error": str(exc)}, 403
    entries = [{"name": child.name, "path": str(child), "readable": os.access(child, os.R_OK)} for child in children[:300]]
    parent = str(resolved.parent) if resolved.parent != resolved else ""
    return {"path": str(resolved), "parent": parent, "entries": entries}, 200


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
        mime = audio_mime_type(target)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        if target.suffix in (".html", ".js", ".css"):
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_media_file(self, raw_path):
        root = Path(MOCK_SETTINGS["music_directory"]).expanduser().resolve()
        target = (root / unquote(raw_path or "")).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            self.json({"error": "Path is outside the music directory"}, 400)
            return
        if not target.is_file() or target.suffix.lower() not in AUDIO_EXTENSIONS:
            self.json({"error": "Audio file not found"}, 404)
            return

        file_size = target.stat().st_size
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
                    start = max(0, file_size - int(end_text))
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
        mime = audio_mime_type(target)
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "private, max-age=3600")
        self.send_header("Content-Length", str(content_length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()
        remaining = content_length
        with target.open("rb") as fh:
            fh.seek(start)
            while remaining > 0:
                chunk = fh.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

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
            self.json(mock_scan_status())
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
            wifi_connected = bool(MOCK_WIFI["connected"])
            hotspot_active = bool(MOCK_HOTSPOT["active"])
            self.json({
                "mode": "hotspot" if hotspot_active else "ethernet",
                "ip": MOCK_HOTSPOT["ip"] if hotspot_active else "192.168.1.84",
                "default_route": {"interface": "eth0", "gateway": "192.168.1.1"},
                "ethernet": {"active": True, "connected": True, "interface": "eth0", "link": "up", "ip": "192.168.1.84", "addresses": ["192.168.1.84"], "gateway": "192.168.1.1"},
                "hotspot": {"ssid": MOCK_HOTSPOT["ssid"], "ip": MOCK_HOTSPOT["ip"], "active": hotspot_active},
                "station": {"ssid": MOCK_WIFI["ssid"], "ip": "" if hotspot_active else MOCK_WIFI["ip"], "interface": "wlan0", "link": "down" if hotspot_active else "up" if wifi_connected else "down", "active": wifi_connected and not hotspot_active, "configured": bool(MOCK_WIFI["configured"])},
                "urls": ["http://127.0.0.1:8090", "http://echoflow.local"],
            })
        elif parsed.path == "/api/network/wifi/scan":
            self.json({"networks": [{"ssid": "EchoFlow-Test", "signal": 92, "security": "WPA2"}]})
        elif parsed.path == "/api/storage/network/status":
            connected = MOCK_SETTINGS.get("storage_source") == "network"
            self.json({"configured": connected, "mounted": connected, "protocol": "smb", "server": "nas.local" if connected else "", "share": "Music" if connected else "", "mountPoint": "/mnt/music"})
        elif parsed.path == "/api/services":
            self.json({"services": {name: mock_service_state(name) for name in MOCK_SERVICES}})
        elif parsed.path == "/api/audio/devices":
            self.json({"devices": [{"alsa": "default", "label": "default - Mock ALSA"}, {"alsa": "hw:1,0", "label": "hw:1,0 - Mock USB DAC"}], "current": {"device": "default", "mixer": "software"}})
        elif parsed.path == "/api/filesystem/roots":
            self.json(filesystem_roots())
        elif parsed.path == "/api/filesystem/browse":
            payload, status = filesystem_browse(query)
            self.json(payload, status)
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
                "settings": MOCK_SETTINGS,
                "config": {"musicDir": MOCK_SETTINGS["music_directory"], "ui": {"animationSpeed": 0.18, "visibleCoverCount": MOCK_SETTINGS["visibleCoverCount"], "themeAccent": MOCK_SETTINGS["themeAccent"]}},
                "scan": {"ok": True, "mock": True, **mock_scan_status()},
                "counts": {"albums": len(ALBUMS), "tracks": len(tracks)},
                "outputs": [],
            })
        elif parsed.path == "/api/health":
            self.json({"ok": True, "mock": True, "time": int(time.time())})
        elif parsed.path == "/api/art":
            data, mime = album_art(query.get("album", ["Kind of Blue"])[0])
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        elif parsed.path == "/api/stream":
            self.send_media_file(query.get("file", [""])[0])
        else:
            self.send_static(parsed.path)

    def do_POST(self):
        global ALBUMS
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
        elif parsed.path == "/api/network/wifi/connect":
            ssid = str(body.get("ssid") or "").strip()
            if not ssid:
                self.json({"ok": False, "message": "SSID is required."}, 400)
                return
            MOCK_WIFI.update({"ssid": ssid, "configured": True, "connected": True, "ip": "192.168.1.86"})
            MOCK_HOTSPOT["active"] = False
            self.json({"ok": True, "message": f"Connecting to {ssid}. Hotspot disabled.", "ssid": ssid})
            return
        elif parsed.path == "/api/network/hotspot/start":
            MOCK_HOTSPOT["active"] = True
            MOCK_WIFI["connected"] = False
            self.json({"ok": True, "hotspot": {"ssid": MOCK_HOTSPOT["ssid"], "ip": MOCK_HOTSPOT["ip"]}})
            return
        elif parsed.path == "/api/network/hotspot/stop":
            MOCK_HOTSPOT["active"] = False
            self.json({"ok": True})
            return
        elif parsed.path in ("/api/library/rescan", "/api/library/rebuild-cache", "/api/services/control", "/api/audio/output", "/api/system/control"):
            message = "Mock command accepted."
            if parsed.path == "/api/library/rescan":
                scan = start_mock_library_scan()
                message = f"Mock scan started from {MOCK_SETTINGS['music_directory']}"
                self.json({"ok": True, "message": message, "scan": scan})
                return
            if parsed.path == "/api/services/control":
                service = str(body.get("service") or "").lower()
                action = str(body.get("action") or "").lower()
                if service not in MOCK_SERVICES or action not in ("start", "stop"):
                    self.json({"ok": False, "message": "Unsupported mock service command."}, 400)
                    return
                MOCK_SERVICES[service] = action == "start"
                state = "enabled" if MOCK_SERVICES[service] else "disabled"
                self.json({
                    "ok": True,
                    "message": f"{service} {state}.",
                    "services": {name: mock_service_state(name) for name in MOCK_SERVICES},
                })
                return
            self.json({"ok": True, "message": message})
            return
        elif parsed.path == "/api/storage/network/configure":
            MOCK_SETTINGS.update({"storage_source": "network", "music_directory": "/mnt/music"})
            save_mock_settings()
            scan = start_mock_library_scan()
            self.json({"ok": True, "message": "Network storage connected. Library scan started.", "storage": {"configured": True, "mounted": True, "mountPoint": "/mnt/music"}})
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
        if parsed.path == "/api/settings":
            MOCK_SETTINGS.update({key: value for key, value in body.items() if key in MOCK_SETTINGS})
            save_mock_settings()
            self.json({"settings": MOCK_SETTINGS, "message": "Mock settings saved."})
            return
        self.json(compat_state() if parsed.path.startswith("/api/player/") else STATUS)


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"EchoFlow mock server: http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()

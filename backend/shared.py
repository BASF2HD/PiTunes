import os
from pathlib import Path


class ApiError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message
        super().__init__(message)


MPD_HOST = os.environ.get("MPD_HOST", "127.0.0.1")
MPD_PORT = int(os.environ.get("MPD_PORT", "6600"))
LISTEN_HOST = os.environ.get("ECHOFLOW_API_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("ECHOFLOW_API_PORT", "8080"))
MUSIC_DIR = Path(os.environ.get("MUSIC_DIR", "/mnt/music"))
CONFIG_DIR = Path(os.environ.get("ECHOFLOW_CONFIG_DIR", "/etc/echoflow"))
CACHE_DIR = Path(os.environ.get("ECHOFLOW_CACHE_DIR", "/var/cache/echoflow"))
ART_CACHE_DIR = CACHE_DIR / "art"
SETTINGS_FILE = CONFIG_DIR / "settings.json"


def mpd_quote(value):
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def parse_mpd_lines(lines):
    entries = []
    current = {}
    for line in lines:
        if not line or line == "OK" or line.startswith("ACK"):
            continue
        if ": " not in line:
            continue
        key, value = line.split(": ", 1)
        if key == "file" and current:
            entries.append(current)
            current = {}
        if key in current:
            existing = current[key]
            if isinstance(existing, list):
                existing.append(value)
            else:
                current[key] = [existing, value]
        else:
            current[key] = value
    if current:
        entries.append(current)
    return entries

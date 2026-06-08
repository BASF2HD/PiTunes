"""Remote radio station favicon fetch and disk cache."""

from __future__ import annotations

import hashlib
import threading
import time
import urllib.request
from pathlib import Path

from shared import ART_CACHE_DIR

CACHE_TTL_SECONDS = 7 * 86400
_USER_AGENT = "Mozilla/5.0 (compatible; PiTunes/1.0)"


def cache_path(remote_url: str) -> Path:
    digest = hashlib.sha256(remote_url.encode("utf-8")).hexdigest()[:32]
    return ART_CACHE_DIR / "radio-icons" / digest


def cache_valid(path: Path) -> bool:
    if not path.exists() or path.stat().st_size == 0:
        return False
    return (time.time() - path.stat().st_mtime) < CACHE_TTL_SECONDS


def prefetch(remote_url: str, timeout: float = 10) -> bool:
    url = str(remote_url or "").strip()
    if not url.startswith(("http://", "https://")):
        return False
    cached = cache_path(url)
    if cache_valid(cached):
        return True
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": _USER_AGENT, "Accept": "image/*,*/*;q=0.8"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read(600000)
            if not data:
                return False
            ctype = (resp.headers.get("Content-Type") or "image/png").split(";")[0].strip()
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(data)
        cached.with_suffix(cached.suffix + ".meta").write_text(ctype or "image/png", encoding="utf-8")
        return True
    except Exception:
        return False


def prefetch_async(remote_url: str) -> None:
    url = str(remote_url or "").strip()
    if not url.startswith(("http://", "https://")):
        return
    cached = cache_path(url)
    if cache_valid(cached):
        return

    def worker() -> None:
        prefetch(url)

    threading.Thread(target=worker, daemon=True, name="radio-icon-prefetch").start()


def resolve_cached_file(remote_url: str) -> Path | None:
    url = str(remote_url or "").strip()
    if not url.startswith(("http://", "https://")):
        return None
    cached = cache_path(url)
    if cache_valid(cached):
        return cached
    prefetch_async(url)
    return None

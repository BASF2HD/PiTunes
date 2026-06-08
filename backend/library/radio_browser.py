"""Radio Browser API proxy for station search."""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from typing import Any

_USER_AGENT = "PiTunes/1.0 (+https://github.com/BASF2HD/PiTunes)"
_API_BASES = (
    "https://de1.api.radio-browser.info",
    "https://fi1.api.radio-browser.info",
    "https://nl1.api.radio-browser.info",
)
_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_CACHE_TTL = 300


def _fetch_json(path: str, params: dict[str, str] | None = None) -> list[dict[str, Any]]:
    params = params or {}
    query = urllib.parse.urlencode({key: value for key, value in params.items() if value})
    url = f"{path}?{query}" if query else path
    last_error = "radio search failed"
    for base in _API_BASES:
        try:
            request = urllib.request.Request(
                f"{base}{url}",
                headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=12) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if isinstance(payload, list):
                return payload
        except Exception as exc:
            last_error = str(exc)
    raise RuntimeError(last_error)


def _normalize_result(item: dict[str, Any]) -> dict[str, Any] | None:
    url = str(item.get("url_resolved") or item.get("url") or "").strip()
    name = str(item.get("name") or "").strip()
    if not url or not name:
        return None
    tags = str(item.get("tags") or "").replace(";", ", ")
    language = str(item.get("language") or "").replace(";", ", ")
    subtitle = tags or language or "Internet radio"
    return {
        "externalUuid": str(item.get("stationuuid") or ""),
        "name": name,
        "url": url,
        "streamUrl": url,
        "homepage": str(item.get("homepage") or ""),
        "country": str(item.get("countrycode") or item.get("country") or ""),
        "tags": tags,
        "genre": subtitle,
        "language": language,
        "bitrate": int(item.get("bitrate") or 0),
        "codec": str(item.get("codec") or ""),
        "artUrl": str(item.get("favicon") or ""),
        "favicon": str(item.get("favicon") or ""),
        "source": "radio-browser",
        "favourite": False,
        "clickcount": int(item.get("clickcount") or 0),
    }


def _merge_results(merged: dict[str, dict[str, Any]], raw: list[dict[str, Any]]) -> None:
    for item in raw:
        station = _normalize_result(item)
        if not station:
            continue
        key = station.get("externalUuid") or f"{station['name']}|{station['url']}"
        existing = merged.get(key)
        if not existing or station.get("clickcount", 0) > existing.get("clickcount", 0):
            merged[key] = station


def search_stations(
    query: str = "",
    country: str = "",
    tag: str = "",
    limit: int = 40,
    offset: int = 0,
) -> list[dict[str, Any]]:
    limit = max(1, min(80, int(limit or 40)))
    offset = max(0, int(offset or 0))
    cache_key = f"{query}|{country}|{tag}|{limit}|{offset}"
    cached = _CACHE.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    base_params: dict[str, str] = {
        "limit": str(limit),
        "offset": str(offset),
        "hidebroken": "true",
        "order": "clickcount",
        "reverse": "true",
    }
    if country.strip():
        base_params["countrycode"] = country.strip().upper()

    merged: dict[str, dict[str, Any]] = {}
    q = query.strip()
    tag_q = tag.strip()

    if tag_q:
        _merge_results(merged, _fetch_json("/json/stations/search", {**base_params, "tag": tag_q}))

    if q and offset > 0:
        raw = _fetch_json("/json/stations/search", {**base_params, "name": q})
        results = []
        for item in raw:
            station = _normalize_result(item)
            if station:
                results.append(station)
        return results[:limit]

    if q:
        page_params = {**base_params, "offset": "0"}
        _merge_results(merged, _fetch_json("/json/stations/search", {**page_params, "name": q}))
        _merge_results(merged, _fetch_json("/json/stations/search", {**page_params, "language": q}))
        _merge_results(merged, _fetch_json("/json/stations/search", {**page_params, "tag": q}))
        encoded = urllib.parse.quote(q, safe="")
        try:
            _merge_results(
                merged,
                _fetch_json(
                    f"/json/stations/bytag/{encoded}",
                    {key: value for key, value in base_params.items()},
                ),
            )
        except Exception:
            pass

    if not q and not tag_q:
        _merge_results(merged, _fetch_json("/json/stations/search", base_params))

    results = sorted(
        merged.values(),
        key=lambda station: station.get("clickcount", 0),
        reverse=True,
    )[:limit]
    if results:
        _CACHE[cache_key] = (now, results)
    return results

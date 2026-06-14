"""ALSA device discovery and audio output routing for PiTunes."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
HATS_FILE = PROJECT_ROOT / "config" / "dac-hats.json"
APPLY_SCRIPT = PROJECT_ROOT / "scripts" / "apply-audio-output.sh"

VALID_ROUTES = frozenset({"usb-dac", "dac-hat", "hdmi", "headphones"})

# Kernel/ALSA identifiers mapped to short labels when device text is too technical.
CARD_ALIASES = {
    "snd_rpi_hifiberry_dac": "HiFiBerry DAC",
    "snd_rpi_hifiberry_dacplus": "HiFiBerry DAC+",
    "snd_rpi_hifiberry_dacpluspro": "HiFiBerry DAC+ Pro",
    "snd_rpi_hifiberry_dacplushd": "HiFiBerry DAC+ HD",
    "snd_rpi_hifiberry_dac8x": "HiFiBerry DAC8x",
    "snd_rpi_hifiberry_amp": "HiFiBerry Amp",
    "snd_rpi_hifiberry_amp3": "HiFiBerry Amp3",
    "snd_rpi_hifiberry_amp4pro": "HiFiBerry Amp4 Pro",
    "snd_rpi_hifiberry_digi": "HiFiBerry Digi+",
    "snd_rpi_hifiberry_digipro": "HiFiBerry Digi+ Pro",
    "snd_rpi_googlevoicehat_soundcard": "Google Voice HAT",
    "bcm2835_headphones": "3.5 mm Headphones",
    "bcm2835 headphones": "3.5 mm Headphones",
    "vc4_hdmi": "HDMI",
    "vc4-hdmi": "HDMI",
    "sndrpihifiberry": "HiFiBerry DAC+",
}

DEVICE_ALIASES = {
    "bcm2835 headphones": "3.5 mm Headphones",
    "vc4-hdmi": "HDMI",
    "mai pcm": "HDMI",
}


def _clean_device_name(name: str) -> str:
    cleaned = name.strip()
    if "[" in cleaned:
        cleaned = cleaned.split("[", 1)[0].strip()
    cleaned = re.sub(r"\s+HiFi\s+\S+(?:-hifi-\d+)?\s*$", "", cleaned, flags=re.I).strip()
    cleaned = re.sub(r"\s+\S+-hifi-\d+\s*$", "", cleaned, flags=re.I).strip()
    return cleaned


def _friendly_device_label(short_name: str, card_id: str, device_desc: str, *, multi_card: bool, card: int) -> str:
    cleaned = _clean_device_name(device_desc)
    lowered = cleaned.lower()
    for needle, label in DEVICE_ALIASES.items():
        if needle in lowered:
            cleaned = label
            break

    card_key = (card_id or short_name or "").strip().lower().replace(" ", "_")
    if not cleaned or re.fullmatch(r"[a-z0-9_]+", cleaned.replace(" ", "").replace("-", "")):
        cleaned = CARD_ALIASES.get(card_key, CARD_ALIASES.get((short_name or "").strip().lower(), cleaned or card_id or short_name or "ALSA device"))

    if multi_card:
        return f"{cleaned} (card {card})"
    return cleaned


def _run_aplay_list() -> str:
    try:
        proc = subprocess.run(
            ["aplay", "-l"],
            capture_output=True,
            text=True,
            timeout=3.0,
            check=False,
        )
    except Exception:
        return ""
    return proc.stdout or ""


def list_alsa_devices() -> list[dict[str, Any]]:
    output = _run_aplay_list()
    devices: list[dict[str, Any]] = []
    pattern = re.compile(
        r"^card (\d+): ([^,]+?)(?: \[([^\]]*)\])?, device (\d+): (.+)$",
        re.I,
    )
    for line in output.splitlines():
        match = pattern.match(line.strip())
        if not match:
            continue
        card, short_name, card_id, device, device_desc = match.groups()
        devices.append(
            {
                "alsa": f"plughw:{card},{device}",
                "label": "",
                "card": int(card),
                "device": int(device),
                "short_name": (short_name or "").strip(),
                "card_id": (card_id or "").strip(),
                "device_desc": (device_desc or "").strip(),
            }
        )
    multi_card = len(devices) > 1
    for entry in devices:
        entry["label"] = _friendly_device_label(
            entry.pop("short_name"),
            entry.pop("card_id"),
            entry.pop("device_desc"),
            multi_card=multi_card,
            card=entry["card"],
        )
    if not devices:
        devices.append({"alsa": "default", "label": "default - ALSA default output", "card": -1, "device": 0})
    return devices


def load_dac_hats() -> list[dict[str, Any]]:
    try:
        data = json.loads(HATS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    hats = data.get("hats") or []
    return [
        {
            "id": hat.get("id", ""),
            "label": hat.get("label", hat.get("id", "")),
            "overlay": hat.get("overlay", ""),
            "mixer": hat.get("mixer", "hardware"),
        }
        for hat in hats
        if hat.get("id")
    ]


def normalize_route(route: str | None) -> str:
    value = (route or "").strip().lower()
    if value in ("", "auto", "default"):
        return "hdmi"
    if value == "browser":
        return "browser"
    if value in VALID_ROUTES:
        return value
    return "hdmi"


def audio_devices_payload(settings: dict[str, Any]) -> dict[str, Any]:
    route = normalize_route(settings.get("audio_output"))
    return {
        "devices": list_alsa_devices(),
        "hats": load_dac_hats(),
        "routes": [
            {"id": "hdmi", "label": "HDMI"},
            {"id": "headphones", "label": "3.5 mm Headphones"},
            {"id": "usb-dac", "label": "USB DAC"},
            {"id": "dac-hat", "label": "DAC HAT (I2S)"},
        ],
        "current": {
            "route": route,
            "device": settings.get("alsa_device") or "default",
            "mixer": settings.get("mixer") or "software",
            "dac_hat": settings.get("dac_hat") or "",
        },
    }


def apply_audio_output(settings: dict[str, Any], body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    route = normalize_route(body.get("output") or body.get("audio_output") or settings.get("audio_output"))
    if route == "browser":
        return {"ok": True, "message": "Browser output is handled on this device only.", "reboot_required": False}

    dac_hat = str(body.get("dac_hat") or settings.get("dac_hat") or "").strip()
    alsa_device = str(body.get("alsa") or body.get("alsa_device") or settings.get("alsa_device") or "default").strip()
    mixer = str(body.get("mixer") or settings.get("mixer") or "software").strip().lower()
    if mixer not in ("software", "hardware", "none"):
        mixer = "software"

    if route == "dac-hat" and not dac_hat:
        raise ValueError("Select a DAC HAT model before applying this output route.")

    if not APPLY_SCRIPT.is_file():
        raise RuntimeError("Audio apply script is missing on this system.")

    try:
        proc = subprocess.run(
            [
                "sudo",
                "systemd-run",
                "--wait",
                "--pipe",
                "--collect",
                "--unit=pitunes-audio-apply",
                "/bin/bash",
                str(APPLY_SCRIPT),
                route,
                dac_hat,
                alsa_device,
                mixer,
            ],
            capture_output=True,
            text=True,
            timeout=30.0,
            check=False,
        )
    except Exception as exc:
        raise RuntimeError(f"Failed to apply audio output: {exc}") from exc

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode != 0:
        raise RuntimeError(stderr or stdout or "Audio output apply failed.")

    result: dict[str, Any] = {"ok": True, "message": f"Audio output set to {route}.", "reboot_required": False}
    if stdout:
        try:
            result.update(json.loads(stdout.splitlines()[-1]))
        except json.JSONDecodeError:
            result["message"] = stdout
    if result.get("reboot_required"):
        result["message"] = f"{result.get('message', 'Audio updated.')} Reboot the Pi to enable the DAC HAT."
    return result

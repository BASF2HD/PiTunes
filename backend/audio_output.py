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
        r"^card (\d+): ([^,]+?)(?: \[([^\]]*)\])?, device (\d+):",
        re.I,
    )
    for line in output.splitlines():
        match = pattern.match(line.strip())
        if not match:
            continue
        card, short_name, long_name, device = match.groups()
        label_name = (long_name or short_name or "ALSA").strip()
        devices.append(
            {
                "alsa": f"plughw:{card},{device}",
                "label": f"Card {card}: {label_name}",
                "card": int(card),
                "device": int(device),
            }
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

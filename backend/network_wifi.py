"""WiFi station + Moode-style hotspot helpers for EchoFlow API."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

CONFIG_DIR = Path("/etc/echoflow")
HOTSPOT_CONFIG = CONFIG_DIR / "wifi-hotspot.conf"
WIFI_SCRIPT = Path("/opt/echoflow/scripts/wifi-hotspot.sh")
SETUP_WIFI_SCRIPT = Path("/opt/echoflow/scripts/setup-wifi.sh")
STATE_FILE = Path("/run/echoflow/wifi-hotspot.state")


def _read_hotspot_config() -> dict:
    values: dict[str, str] = {}
    if not HOTSPOT_CONFIG.exists():
        return {
            "ap_ssid": "EchoFlow",
            "ap_password": "echoflowaudio",
            "ap_ip": "172.24.1.1",
            "country_code": "GB",
        }
    for line in HOTSPOT_CONFIG.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        values[key.strip().lower()] = val.strip()
    return {
        "ap_ssid": values.get("ap_ssid", "EchoFlow"),
        "ap_password": values.get("ap_password", "echoflowaudio"),
        "ap_ip": values.get("ap_ip", "172.24.1.1"),
        "country_code": values.get("country_code", "GB"),
        "auto_hotspot": values.get("auto_hotspot", "1"),
    }


def _run(cmd: list[str], timeout: int = 45) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def hotspot_active() -> bool:
    return STATE_FILE.exists() and STATE_FILE.read_text(encoding="utf-8").strip() == "active"


def wifi_status() -> dict:
    cfg = _read_hotspot_config()
    mode = "unknown"
    ip = ""
    connected_ssid = ""

    if WIFI_SCRIPT.exists():
        proc = _run(["/bin/bash", str(WIFI_SCRIPT), "status"], timeout=15)
        for line in (proc.stdout or "").splitlines():
            if "=" in line:
                key, val = line.split("=", 1)
                if key == "mode":
                    mode = val.strip()
                elif key == "ip":
                    ip = val.strip()
                elif key == "ssid" and val.strip():
                    connected_ssid = val.strip()

    if hotspot_active():
        mode = "hotspot"
        ip = cfg["ap_ip"]

    if mode == "station" and not connected_ssid:
        connected_ssid = _connected_ssid()

    return {
        "mode": mode,
        "ip": ip,
        "hotspot": {
            "ssid": cfg["ap_ssid"],
            "ip": cfg["ap_ip"],
            "active": mode == "hotspot",
            "password_hint": "Set in /etc/echoflow/wifi-hotspot.conf or Raspberry Pi Imager",
        },
        "station": {
            "ssid": connected_ssid,
            "configured": _wpa_configured(),
        },
        "urls": [
            f"http://{cfg['ap_ip']}",
            "http://echoflow.local",
        ],
    }


def _wpa_configured() -> bool:
    path = Path("/etc/wpa_supplicant/wpa_supplicant.conf")
    if not path.exists():
        return False
    return "ssid=" in path.read_text(encoding="utf-8", errors="ignore")


def _connected_ssid() -> str:
    proc = _run(["/sbin/wpa_cli", "-i", "wlan0", "status"], timeout=5)
    if proc.returncode != 0:
        return ""
    for line in (proc.stdout or "").splitlines():
        if line.startswith("ssid="):
            return line.split("=", 1)[1].strip()
    return ""


def wifi_scan() -> dict:
    hotspot = hotspot_active()
    commands = []
    if hotspot:
        commands.append(["sudo", "-n", "/sbin/iw", "dev", "wlan0", "scan", "ap-force"])
    commands.append(["sudo", "-n", "/sbin/iw", "dev", "wlan0", "scan"])

    proc = None
    errors = []
    for command in commands:
        proc = _run(command, timeout=25)
        if proc.returncode == 0:
            break
        errors.append((proc.stderr or proc.stdout or "scan failed").strip())
    if not proc or proc.returncode != 0:
        message = next((error for error in errors if error), "scan failed")
        if hotspot:
            message = f"{message}. This WiFi adapter cannot scan while hosting the hotspot; enter the SSID manually."
        return {"networks": [], "error": message}

    items = _parse_iw_scan(proc.stdout or "")
    response = {"networks": items[:40]}
    if hotspot:
        response["message"] = "Networks scanned while the EchoFlow hotspot remains active."
    return response


def _parse_iw_scan(output: str) -> list[dict]:
    by_ssid: dict[str, dict] = {}
    current: dict | None = None

    def commit() -> None:
        if not current or not current.get("ssid"):
            return
        ssid = str(current["ssid"])
        previous = by_ssid.get(ssid)
        if not previous or int(current.get("signal", -100)) > int(previous.get("signal", -100)):
            by_ssid[ssid] = dict(current)

    for line in output.splitlines():
        line = line.strip()
        if line.startswith("BSS "):
            commit()
            current = {"ssid": "", "signal": -100, "security": "open"}
            continue
        if current is None:
            continue
        if line.startswith("SSID:"):
            match = re.search(r"SSID:\s*(.*)", line)
            current["ssid"] = match.group(1).strip() if match else ""
        elif re.search(r"signal:", line, re.I):
            match = re.search(r"signal:\s*(-?\d+(?:\.\d+)?)", line, re.I)
            if match:
                current["signal"] = int(float(match.group(1)))
        elif line.startswith("RSN:"):
            current["security"] = "WPA2/WPA3"
        elif line.startswith("WPA:"):
            current["security"] = "WPA"
        elif line.startswith("capability:") and "Privacy" in line and current["security"] == "open":
            current["security"] = "secured"

    commit()
    items = sorted(by_ssid.values(), key=lambda n: n.get("signal", -100), reverse=True)
    return items


def wifi_connect(ssid: str, password: str, country: str = "GB") -> dict:
    if not ssid:
        raise ValueError("ssid is required")
    if WIFI_SCRIPT.exists():
        _run(["sudo", "-n", "/bin/bash", str(WIFI_SCRIPT), "stop"], timeout=30)
    if SETUP_WIFI_SCRIPT.exists():
        proc = _run(
            ["sudo", "-n", "/bin/bash", str(SETUP_WIFI_SCRIPT), ssid, password, country],
            timeout=60,
        )
        if proc.returncode != 0:
            raise RuntimeError((proc.stderr or proc.stdout or "WiFi connect failed").strip())
    else:
        raise RuntimeError("setup-wifi.sh not installed")
    if WIFI_SCRIPT.exists():
        _run(["sudo", "-n", "/bin/bash", str(WIFI_SCRIPT), "restart-station"], timeout=30)
    return {"ok": True, "message": f"Connecting to {ssid}. Hotspot disabled.", "ssid": ssid}


def hotspot_start() -> dict:
    proc = _run(["sudo", "-n", "/bin/bash", str(WIFI_SCRIPT), "start"], timeout=60)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "hotspot start failed").strip())
    return {"ok": True, "hotspot": _read_hotspot_config()}


def hotspot_stop() -> dict:
    proc = _run(["sudo", "-n", "/bin/bash", str(WIFI_SCRIPT), "stop"], timeout=30)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "hotspot stop failed").strip())
    return {"ok": True}

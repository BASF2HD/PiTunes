"""WiFi station + Moode-style hotspot helpers for EchoFlow API."""

from __future__ import annotations

import json
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
            "wlan_interface": "wlan0",
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
        "wlan_interface": values.get("wlan_interface", "wlan0"),
    }


def _run(cmd: list[str], timeout: int = 45) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except OSError as exc:
        return subprocess.CompletedProcess(cmd, 127, "", str(exc))


def hotspot_active() -> bool:
    return STATE_FILE.exists() and STATE_FILE.read_text(encoding="utf-8").strip() == "active"


def _interface_statuses() -> dict[str, dict]:
    proc = _run(["/sbin/ip", "-j", "-4", "addr", "show"], timeout=5)
    if proc.returncode != 0:
        return {}
    try:
        entries = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        return {}

    statuses = {}
    for entry in entries:
        interface = str(entry.get("ifname") or "")
        if not interface:
            continue
        addresses = [
            str(address.get("local"))
            for address in entry.get("addr_info", [])
            if address.get("family") == "inet"
            and address.get("local")
            and not str(address.get("local")).startswith("169.254.")
        ]
        statuses[interface] = {
            "interface": interface,
            "link": str(entry.get("operstate") or "UNKNOWN").lower(),
            "ip": addresses[0] if addresses else "",
            "addresses": addresses,
        }
    return statuses


def _default_route() -> dict:
    proc = _run(["/sbin/ip", "-j", "-4", "route", "show", "default"], timeout=5)
    if proc.returncode != 0:
        return {"interface": "", "gateway": ""}
    try:
        routes = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        return {"interface": "", "gateway": ""}
    route = routes[0] if routes else {}
    return {
        "interface": str(route.get("dev") or ""),
        "gateway": str(route.get("gateway") or ""),
    }


def _ethernet_status(interfaces: dict[str, dict], default_route: dict) -> dict:
    candidates = [
        status
        for name, status in interfaces.items()
        if name.startswith(("eth", "en"))
    ]
    candidates.sort(
        key=lambda status: (
            status["interface"] != default_route.get("interface"),
            not bool(status["ip"]),
            status["interface"],
        )
    )
    selected = candidates[0] if candidates else {"interface": "", "link": "unavailable", "ip": "", "addresses": []}
    return {
        **selected,
        "connected": selected["link"] == "up",
        "active": bool(selected["ip"]),
        "gateway": default_route.get("gateway", "") if selected["interface"] == default_route.get("interface") else "",
    }


def wifi_status() -> dict:
    cfg = _read_hotspot_config()
    interfaces = _interface_statuses()
    default_route = _default_route()
    ethernet = _ethernet_status(interfaces, default_route)
    wlan_interface = cfg["wlan_interface"]
    wlan = interfaces.get(wlan_interface, {"interface": wlan_interface, "link": "unavailable", "ip": "", "addresses": []})
    hotspot_is_active = hotspot_active()
    station_is_active = bool(wlan["ip"]) and not hotspot_is_active
    connected_ssid = _connected_ssid(wlan_interface) if station_is_active else ""

    if default_route["interface"] == ethernet["interface"] and ethernet["active"]:
        mode, ip = "ethernet", ethernet["ip"]
    elif default_route["interface"] == wlan_interface and station_is_active:
        mode, ip = "station", wlan["ip"]
    elif hotspot_is_active:
        mode, ip = "hotspot", cfg["ap_ip"]
    elif ethernet["active"]:
        mode, ip = "ethernet", ethernet["ip"]
    elif station_is_active:
        mode, ip = "station", wlan["ip"]
    else:
        mode, ip = "off", ""

    return {
        "mode": mode,
        "ip": ip,
        "default_route": default_route,
        "ethernet": ethernet,
        "hotspot": {
            "ssid": cfg["ap_ssid"],
            "ip": cfg["ap_ip"],
            "interface": wlan_interface,
            "active": hotspot_is_active,
            "password_hint": "Set in /etc/echoflow/wifi-hotspot.conf or Raspberry Pi Imager",
        },
        "station": {
            "ssid": connected_ssid,
            "ip": wlan["ip"] if station_is_active else "",
            "interface": wlan_interface,
            "link": wlan["link"],
            "active": station_is_active,
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


def _connected_ssid(interface: str = "wlan0") -> str:
    proc = _run(["/sbin/wpa_cli", "-i", interface, "status"], timeout=5)
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

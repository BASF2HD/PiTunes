"""WiFi station + Moode-style hotspot helpers for EchoFlow API."""

from __future__ import annotations

import json
import re
import subprocess
import threading
import time
from pathlib import Path

CONFIG_DIR = Path("/etc/echoflow")
HOTSPOT_CONFIG = CONFIG_DIR / "wifi-hotspot.conf"
WIFI_SCRIPT = Path("/opt/echoflow/scripts/wifi-hotspot.sh")
SETUP_WIFI_SCRIPT = Path("/opt/echoflow/scripts/setup-wifi.sh")
STATE_FILE = Path("/run/echoflow/wifi-hotspot.state")
CONNECT_STATE_FILE = Path("/run/echoflow/wifi-connect.json")
SCAN_CACHE_FILE = Path("/var/cache/echoflow/wifi-scan.json")
SCAN_CACHE_MAX_AGE = 120
SCAN_RETRY_DELAY = 8
_SCAN_LOCK = threading.Lock()
_CONNECT_LOCK = threading.Lock()
_SCAN_CACHE: dict = {"networks": [], "scanned_at": 0.0}
_LAST_SCAN_ATTEMPT = 0.0


def _read_hotspot_config() -> dict:
    values: dict[str, str] = {}
    if not HOTSPOT_CONFIG.exists():
        return {
            "ap_ssid": "EchoFlow",
            "ap_password": "echoflowaudio",
            "ap_ip": "172.24.1.1",
            "country_code": "GB",
            "wlan_interface": "wlan0",
            "ap_connection": "EchoFlow-Hotspot",
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
        "ap_connection": values.get("ap_connection", "EchoFlow-Hotspot"),
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


def _write_connect_state(status: str, message: str, ssid: str = "", ip: str = "") -> dict:
    state = {
        "status": status,
        "message": message,
        "ssid": ssid,
        "ip": ip,
        "updated_at": time.time(),
    }
    try:
        CONNECT_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = CONNECT_STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(state), encoding="utf-8")
        tmp.replace(CONNECT_STATE_FILE)
    except OSError:
        pass
    return state


def _read_connect_state() -> dict:
    try:
        state = json.loads(CONNECT_STATE_FILE.read_text(encoding="utf-8"))
        if isinstance(state, dict):
            return state
    except (OSError, json.JSONDecodeError):
        pass
    return {"status": "idle", "message": "", "ssid": "", "ip": "", "updated_at": 0}


def hotspot_active() -> bool:
    cfg = _read_hotspot_config()
    proc = _run(
        ["/usr/bin/nmcli", "-g", "GENERAL.CONNECTION", "device", "show", cfg["wlan_interface"]],
        timeout=5,
    )
    return proc.returncode == 0 and (proc.stdout or "").strip() == cfg["ap_connection"]


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
    connection_state = _read_connect_state()
    if station_is_active:
        connected_message = f"Connected to {connected_ssid or 'WiFi'} at {wlan['ip']}."
        if (
            connection_state.get("status") != "connected"
            or connection_state.get("ssid") != connected_ssid
            or connection_state.get("ip") != wlan["ip"]
        ):
            connection_state = _write_connect_state(
                "connected",
                connected_message,
                connected_ssid,
                wlan["ip"],
            )

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
        "connection": connection_state,
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
    proc = _run(["/usr/bin/nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"], timeout=5)
    return proc.returncode == 0 and any(
        line.endswith(":802-11-wireless") and not line.startswith(f"{_read_hotspot_config()['ap_connection']}:")
        for line in (proc.stdout or "").splitlines()
    )


def _connected_ssid(interface: str = "wlan0") -> str:
    proc = _run(["/usr/bin/nmcli", "-g", "GENERAL.CONNECTION", "device", "show", interface], timeout=5)
    connection = (proc.stdout or "").strip() if proc.returncode == 0 else ""
    if connection and connection != "--":
        proc = _run(["/usr/bin/nmcli", "-g", "802-11-wireless.ssid", "connection", "show", connection], timeout=5)
        ssid = (proc.stdout or "").strip() if proc.returncode == 0 else ""
        if ssid:
            return ssid
    proc = _run(["/sbin/wpa_cli", "-i", interface, "status"], timeout=5)
    if proc.returncode == 0:
        for line in (proc.stdout or "").splitlines():
            if line.startswith("ssid="):
                return line.split("=", 1)[1].strip()
    proc = _run(["/sbin/iw", "dev", interface, "link"], timeout=5)
    if proc.returncode == 0:
        for line in (proc.stdout or "").splitlines():
            line = line.strip()
            if line.startswith("SSID:"):
                return line.split(":", 1)[1].strip()
    return ""


def _read_scan_cache() -> dict:
    global _SCAN_CACHE
    if _SCAN_CACHE.get("networks"):
        return dict(_SCAN_CACHE)
    try:
        cached = json.loads(SCAN_CACHE_FILE.read_text(encoding="utf-8"))
        if isinstance(cached.get("networks"), list):
            _SCAN_CACHE = cached
    except (OSError, json.JSONDecodeError, AttributeError):
        pass
    return dict(_SCAN_CACHE)


def _write_scan_cache(networks: list[dict]) -> dict:
    global _SCAN_CACHE
    cached = {"networks": networks[:40], "scanned_at": time.time()}
    _SCAN_CACHE = cached
    try:
        SCAN_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = SCAN_CACHE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(cached), encoding="utf-8")
        tmp.replace(SCAN_CACHE_FILE)
    except OSError:
        pass
    return dict(cached)


def _cached_scan_response(message: str = "", error: str = "") -> dict:
    cached = _read_scan_cache()
    networks = cached.get("networks") or []
    response = {
        "networks": networks,
        "cached": True,
        "scanned_at": cached.get("scanned_at") or 0,
    }
    if message:
        response["message"] = message
    if error and not networks:
        response["error"] = error
    elif error:
        response["warning"] = error
    return response


def _background_wifi_scan() -> None:
    try:
        _wifi_scan_locked()
    finally:
        _SCAN_LOCK.release()


def _start_background_wifi_scan() -> bool:
    if _SCAN_LOCK.locked() or time.time() - _LAST_SCAN_ATTEMPT < SCAN_RETRY_DELAY:
        return True
    if not _SCAN_LOCK.acquire(blocking=False):
        return True
    thread = threading.Thread(target=_background_wifi_scan, name="echoflow-wifi-scan", daemon=True)
    thread.start()
    return True


def wifi_scan(cached_only: bool = False) -> dict:
    if cached_only:
        cached = _read_scan_cache()
        cache_age = time.time() - float(cached.get("scanned_at") or 0)
        stale = not cached.get("networks") or cache_age > SCAN_CACHE_MAX_AGE
        response = _cached_scan_response("Showing the latest device scan." if cached.get("networks") else "Scanning WiFi networks...")
        if stale:
            response["scanning"] = _start_background_wifi_scan()
        return response
    if not _SCAN_LOCK.acquire(blocking=False):
        return _cached_scan_response("WiFi scan already running. Showing the latest device scan.")

    try:
        return _wifi_scan_locked()
    finally:
        _SCAN_LOCK.release()


def _wifi_scan_locked() -> dict:
    global _LAST_SCAN_ATTEMPT
    _LAST_SCAN_ATTEMPT = time.time()
    proc = _run(["sudo", "-n", "/bin/bash", str(WIFI_SCRIPT), "scan"], timeout=35)
    if proc.returncode != 0:
        message = (proc.stderr or proc.stdout or "scan failed").strip()
        return _cached_scan_response("Showing the latest device scan.", message)

    output = proc.stdout or ""
    items = _parse_iw_scan(output) if re.search(r"(?m)^BSS\s", output) else _parse_nmcli_scan(output)
    if not items:
        cached = _read_scan_cache()
        cache_age = time.time() - float(cached.get("scanned_at") or 0)
        if cached.get("networks") and cache_age <= SCAN_CACHE_MAX_AGE:
            return _cached_scan_response("No networks returned by this refresh. Showing the latest device scan.")

    cached = _write_scan_cache(items)
    response = {**cached, "cached": False}
    if hotspot_active():
        response["message"] = "Networks scanned while the EchoFlow hotspot remains active."
    return response


def _parse_nmcli_scan(output: str) -> list[dict]:
    by_ssid: dict[str, dict] = {}
    current: dict[str, str | int] = {}

    def commit() -> None:
        ssid = str(current.get("ssid") or "").strip()
        if not ssid:
            current.clear()
            return
        signal = int(current.get("signal") or 0)
        item = {
            "ssid": ssid,
            "signal": signal,
            "security": str(current.get("security") or "open").strip() or "open",
        }
        previous = by_ssid.get(ssid)
        if not previous or signal > int(previous.get("signal") or 0):
            by_ssid[ssid] = item
        current.clear()

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line:
            commit()
        elif line.startswith("SSID:"):
            if current.get("ssid"):
                commit()
            current["ssid"] = line.split(":", 1)[1].strip()
        elif line.startswith("SIGNAL:"):
            value = line.split(":", 1)[1].strip()
            current["signal"] = int(value) if value.isdigit() else 0
        elif line.startswith("SECURITY:"):
            current["security"] = line.split(":", 1)[1].strip()
    commit()
    return sorted(by_ssid.values(), key=lambda item: int(item.get("signal") or 0), reverse=True)


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
                dbm = float(match.group(1))
                current["signal_dbm"] = int(dbm)
                current["signal"] = max(0, min(100, int(2 * (dbm + 100))))
        elif line.startswith("RSN:"):
            current["security"] = "WPA2/WPA3"
        elif line.startswith("WPA:"):
            current["security"] = "WPA"
        elif line.startswith("capability:") and "Privacy" in line and current["security"] == "open":
            current["security"] = "secured"

    commit()
    items = sorted(by_ssid.values(), key=lambda n: n.get("signal", -100), reverse=True)
    return items


def _wifi_connect_worker(ssid: str, password: str, country: str, restore_hotspot: bool) -> None:
    try:
        # Let the hotspot client receive the API acknowledgement before wlan0 changes mode.
        time.sleep(5)
        _write_connect_state("connecting", f"Switching from the EchoFlow hotspot to {ssid}.", ssid)
        proc = _run(
            ["sudo", "-n", "/bin/bash", str(SETUP_WIFI_SCRIPT), ssid, password, country],
            timeout=80,
        )
        cfg = _read_hotspot_config()
        ip = ""
        for _ in range(10):
            interfaces = _interface_statuses()
            wlan = interfaces.get(cfg["wlan_interface"], {})
            ip = str(wlan.get("ip") or "")
            if ip:
                break
            time.sleep(1)
        connected_ssid = _connected_ssid(cfg["wlan_interface"])
        if proc.returncode == 0 and ip:
            _write_connect_state("connected", f"Connected to {connected_ssid or ssid} at {ip}.", connected_ssid or ssid, ip)
            return

        raw_detail = (proc.stderr or proc.stdout or "WiFi connection failed").strip() or "WiFi connection failed"
        detail = raw_detail.splitlines()[-1]
        if restore_hotspot and WIFI_SCRIPT.exists():
            _run(["sudo", "-n", "/bin/bash", str(WIFI_SCRIPT), "start"], timeout=45)
        suffix = " EchoFlow hotspot restored." if restore_hotspot else ""
        _write_connect_state("failed", f"{detail}{suffix}", ssid)
    except Exception as exc:
        if restore_hotspot and WIFI_SCRIPT.exists():
            _run(["sudo", "-n", "/bin/bash", str(WIFI_SCRIPT), "start"], timeout=45)
        suffix = " EchoFlow hotspot restored." if restore_hotspot else ""
        _write_connect_state("failed", f"{exc}{suffix}", ssid)
    finally:
        _CONNECT_LOCK.release()


def wifi_connect(ssid: str, password: str, country: str = "GB") -> dict:
    if not ssid:
        raise ValueError("ssid is required")
    if not SETUP_WIFI_SCRIPT.exists():
        raise RuntimeError("setup-wifi.sh not installed")
    if not _CONNECT_LOCK.acquire(blocking=False):
        raise RuntimeError("A WiFi connection attempt is already running")

    restore_hotspot = hotspot_active()
    message = f"Credentials saved for {ssid}. EchoFlow will switch networks in 5 seconds. Open http://echoflow.local after it joins your WiFi."
    if restore_hotspot:
        message = f"{message} The EchoFlow hotspot returns automatically if connection fails."
    state = _write_connect_state("queued", message, ssid)
    thread = threading.Thread(
        target=_wifi_connect_worker,
        args=(ssid, password, country, restore_hotspot),
        name="echoflow-wifi-connect",
        daemon=True,
    )
    thread.start()
    return {"ok": True, "accepted": True, "message": message, "ssid": ssid, "connection": state}


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

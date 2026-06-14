"""System information for Settings → About This System."""

from __future__ import annotations

import json
import platform
import re
import socket
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

DEFAULT_VERSION = "1.3.0"
GITHUB_REPOSITORY = "BASF2HD/PiTunes"
UPDATE_CHANNEL = "stable"
INSTALL_DIR = Path("/opt/pitunes")
INSTALL_COMMIT_FILE = "config/.install-commit"
UPDATE_SCRIPT = "scripts/pitunes-update.sh"
UPDATE_SERVICE = "pitunes-update.service"
UPDATE_SERVICE_FILE = Path("/etc/systemd/system") / UPDATE_SERVICE
SYSTEM_UPDATE_SCRIPT = "scripts/pitunes-system-update.sh"
SYSTEM_UPDATE_SERVICE = "pitunes-system-update.service"
SYSTEM_UPDATE_SERVICE_FILE = Path("/etc/systemd/system") / SYSTEM_UPDATE_SERVICE
SYSTEM_UPDATE_CAPABILITY_FILE = Path("/etc/pitunes/system-update.json")
UPDATE_STATUS_FILE = Path("/var/lib/pitunes/update-status.json")
UPDATE_LOG_FILE = Path("/var/log/pitunes-update.log")
SYSTEM_UPDATE_LOG_FILE = Path("/var/lib/pitunes-system/logs/pitunes-system-update.log")
SYSTEMCTL_BIN = "/usr/bin/systemctl"

_last_update_status: dict[str, Any] | None = None


def _run(args: list[str], *, timeout: int = 45, cwd: str | Path | None = None) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            cwd=str(cwd) if cwd else None,
        )
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, "", "command timed out")
    except OSError as exc:
        return subprocess.CompletedProcess(args, 127, "", str(exc))


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""


def _uptime_human() -> str:
    raw = _read_text(Path("/proc/uptime")).split()
    if not raw:
        return ""
    seconds = int(float(raw[0]))
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    parts.append(f"{minutes}m")
    return " ".join(parts)


def _ip_addresses() -> list[str]:
    result = _run(["hostname", "-I"], timeout=5)
    if result.returncode == 0 and result.stdout.strip():
        return [part for part in result.stdout.strip().split() if part]
    try:
        return [socket.gethostbyname(socket.gethostname())]
    except OSError:
        return []


def _disk_usage() -> dict[str, Any]:
    result = _run(["df", "-h", "/"], timeout=5)
    if result.returncode != 0:
        return {}
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    if len(lines) < 2:
        return {}
    parts = lines[-1].split()
    if len(parts) < 6:
        return {}
    return {
        "filesystem": parts[0],
        "size": parts[1],
        "used": parts[2],
        "available": parts[3],
        "usePercent": parts[4],
        "mount": parts[5],
    }


def _memory_usage() -> dict[str, str]:
    result = _run(["free", "-h"], timeout=5)
    if result.returncode != 0:
        return {}
    for line in result.stdout.splitlines():
        if line.lower().startswith("mem:"):
            parts = line.split()
            if len(parts) >= 3:
                return {"total": parts[1], "used": parts[2], "available": parts[3] if len(parts) > 3 else ""}
    return {}


def _os_release() -> dict[str, str]:
    data: dict[str, str] = {}
    for line in _read_text(Path("/etc/os-release")).splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"')
    return data


def _board_model() -> str:
    model = _read_text(Path("/proc/device-tree/model")).replace("\x00", "")
    if model:
        return model
    cpuinfo = _read_text(Path("/proc/cpuinfo"))
    match = re.search(r"^Model\s*:\s*(.+)$", cpuinfo, re.MULTILINE)
    return match.group(1).strip() if match else ""


def _cpu_temperature() -> str:
    result = _run(["vcgencmd", "measure_temp"], timeout=5)
    if result.returncode == 0:
        return result.stdout.strip().replace("temp=", "")
    thermal = Path("/sys/class/thermal/thermal_zone0/temp")
    try:
        value = int(thermal.read_text(encoding="utf-8").strip())
        return f"{value / 1000:.1f}C"
    except (OSError, ValueError):
        return ""


def _git_dir(base: Path) -> Path | None:
    return base if (base / ".git").exists() else None


def _load_version_file(base: Path) -> dict[str, Any]:
    path = base / "config" / "version.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {"version": DEFAULT_VERSION, "channel": "stable"}


def pitunes_version_info(base: Path | None = None) -> dict[str, Any]:
    base = base or INSTALL_DIR
    version_data = _load_version_file(base)
    return {
        "name": "PiTunes",
        "version": str(version_data.get("version") or DEFAULT_VERSION),
        "channel": str(version_data.get("channel") or "stable"),
        "commit": _short_sha(_full_sha(base)),
        "branch": UPDATE_CHANNEL,
        "installPath": str(base),
    }


def _full_sha(base: Path) -> str:
    repo = _git_dir(base)
    if repo:
        result = _run(["git", "-C", str(repo), "rev-parse", "HEAD"], timeout=8)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    commit = _read_text(base / INSTALL_COMMIT_FILE)
    return commit if len(commit) >= 7 else ""


def _short_sha(sha: str) -> str:
    sha = str(sha or "").strip()
    return sha[:7] if len(sha) >= 7 else sha


def _version_parts(version: str) -> tuple[int, ...]:
    match = re.fullmatch(r"v?(\d+(?:\.\d+){1,3})", str(version or "").strip())
    if not match:
        return ()
    return tuple(int(part) for part in match.group(1).split("."))


def _version_is_newer(candidate: str, current: str) -> bool:
    candidate_parts = _version_parts(candidate)
    current_parts = _version_parts(current)
    if not candidate_parts or not current_parts:
        return False
    width = max(len(candidate_parts), len(current_parts))
    return candidate_parts + (0,) * (width - len(candidate_parts)) > current_parts + (0,) * (width - len(current_parts))


def _update_script(base: Path) -> Path:
    return base / UPDATE_SCRIPT


def _is_installed_app(base: Path) -> bool:
    try:
        return base.resolve() == INSTALL_DIR.resolve()
    except OSError:
        return base == INSTALL_DIR


def _update_supported(base: Path, current_full: str) -> bool:
    return bool(current_full and _is_installed_app(base) and _update_script(base).exists() and UPDATE_SERVICE_FILE.exists())


def _system_update_supported(base: Path, current_full: str) -> bool:
    try:
        capability = json.loads(SYSTEM_UPDATE_CAPABILITY_FILE.read_text(encoding="utf-8"))
    except Exception:
        return False
    if not isinstance(capability, dict):
        return False
    required_paths = [
        Path(str(capability.get("persistentMount") or "")),
        Path(str(capability.get("controlMount") or "")),
        Path(str(capability.get("publicKey") or "")),
        Path(str(capability.get("autobootFile") or "")),
    ]
    slots = capability.get("slots")
    capability_valid = (
        capability.get("schemaVersion") == 1
        and capability.get("product") == "PiTunes"
        and capability.get("strategy") == "rpi-tryboot-ab"
        and isinstance(slots, dict)
        and isinstance(slots.get("A"), dict)
        and isinstance(slots.get("B"), dict)
        and all(str(path).startswith("/") and path.exists() for path in required_paths)
    )
    return bool(
        capability_valid
        and current_full
        and _is_installed_app(base)
        and (base / SYSTEM_UPDATE_SCRIPT).exists()
        and SYSTEM_UPDATE_SERVICE_FILE.exists()
        and SYSTEM_UPDATE_CAPABILITY_FILE.exists()
    )


def _read_update_state() -> dict[str, Any]:
    try:
        data = json.loads(UPDATE_STATUS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _tail_text(path: Path, lines: int = 120) -> str:
    result = _run(["tail", "-n", str(lines), str(path)], timeout=5)
    if result.returncode == 0:
        return result.stdout
    return ""


def update_log(lines: int = 160) -> dict[str, Any]:
    lines = max(20, min(400, int(lines or 160)))
    status = _read_update_state()
    path = SYSTEM_UPDATE_LOG_FILE if status.get("updateType") == "system" else UPDATE_LOG_FILE
    return {
        "path": str(path),
        "lines": lines,
        "log": _tail_text(path, lines),
        "status": status,
    }


def _running_update_status(base: Path, current_version: str) -> dict[str, Any] | None:
    data = _read_update_state()
    if data.get("state") != "running":
        return None
    current_full = _full_sha(base)
    return {
        "supported": True,
        "available": False,
        "applying": True,
        "current": data.get("current") or _short_sha(current_full),
        "latest": data.get("latest") or "",
        "currentVersion": current_version,
        "latestVersion": data.get("latestVersion") or current_version,
        "message": data.get("message") or "Installing update...",
        "updateType": data.get("updateType") or "app",
        "branch": UPDATE_CHANNEL,
        "checkedAt": int(data.get("updatedAt") or time.time()),
    }


def _github_json(path: str) -> dict[str, Any]:
    result = _run(
        [
            "curl",
            "-fsSL",
            "-H",
            "Accept: application/vnd.github+json",
            f"https://api.github.com/repos/{GITHUB_REPOSITORY}/{path.lstrip('/')}",
        ],
        timeout=20,
    )
    if result.returncode == 0 and result.stdout.strip():
        try:
            data = json.loads(result.stdout)
            return data if isinstance(data, dict) else {}
        except Exception:
            pass
    return {}


def _url_json(url: str) -> dict[str, Any]:
    result = _run(["curl", "-fsSL", url], timeout=20)
    if result.returncode == 0 and result.stdout.strip():
        try:
            data = json.loads(result.stdout)
            return data if isinstance(data, dict) else {}
        except Exception:
            pass
    return {}


def _release_update_type(release: dict[str, Any], version: str) -> str:
    for asset in release.get("assets") or []:
        if not isinstance(asset, dict) or asset.get("name") != "pitunes-release.json":
            continue
        descriptor = _url_json(str(asset.get("browser_download_url") or ""))
        if (
            descriptor.get("schemaVersion") == 1
            and descriptor.get("product") == "PiTunes"
            and str(descriptor.get("version") or "") == version
            and descriptor.get("updateType") in {"app", "system", "image"}
        ):
            return str(descriptor["updateType"])
        return "invalid"
    return "app"


def _remote_release() -> dict[str, str]:
    release = _github_json("releases/latest")
    tag = str(release.get("tag_name") or "").strip()
    if not tag or release.get("draft") or release.get("prerelease"):
        return {}
    commit = _github_json(f"commits/{quote(tag, safe='')}")
    sha = str(commit.get("sha") or "").strip()
    version = tag[1:] if tag.startswith("v") else tag
    if not sha or not _version_parts(version):
        return {}
    return {"sha": sha, "tag": tag, "version": version, "updateType": _release_update_type(release, version)}


def _release_support(base: Path, current_full: str, update_type: str) -> tuple[bool, bool]:
    if update_type == "app":
        return _update_supported(base, current_full), False
    if update_type == "system":
        supported = _system_update_supported(base, current_full)
        return supported, not supported
    if update_type == "image":
        return False, True
    return False, False


def check_update(base: Path | None = None) -> dict[str, Any]:
    global _last_update_status
    base = base or INSTALL_DIR
    version_data = _load_version_file(base)
    current_version = str(version_data.get("version") or DEFAULT_VERSION)
    current_full = _full_sha(base)
    checked_at = int(time.time())
    running = _running_update_status(base, current_version)
    if running:
        _last_update_status = running
        return running

    if not current_full:
        status = {
            "supported": False,
            "available": False,
            "applying": False,
            "current": "",
            "latest": "",
            "currentVersion": current_version,
            "latestVersion": current_version,
            "message": "Software updates are not available for this installation.",
            "branch": UPDATE_CHANNEL,
            "checkedAt": checked_at,
        }
        _last_update_status = status
        return status

    if not _update_supported(base, current_full) and not _system_update_supported(base, current_full):
        status = {
            "supported": False,
            "available": False,
            "applying": False,
            "current": _short_sha(current_full),
            "latest": "",
            "currentVersion": current_version,
            "latestVersion": current_version,
            "message": "Software updater is not installed for this host.",
            "branch": UPDATE_CHANNEL,
            "checkedAt": checked_at,
        }
        _last_update_status = status
        return status

    release = _remote_release()
    if not release:
        status = {
            "supported": True,
            "available": False,
            "applying": False,
            "current": _short_sha(current_full),
            "latest": "",
            "currentVersion": current_version,
            "latestVersion": current_version,
            "message": "Could not find a stable PiTunes release. Check your network connection.",
            "branch": UPDATE_CHANNEL,
            "checkedAt": checked_at,
        }
        _last_update_status = status
        return status

    latest_full = release["sha"]
    latest_version = release["version"]
    update_type = release.get("updateType") or "app"
    supported, requires_image = _release_support(base, current_full, update_type)
    available = supported and current_full != latest_full and _version_is_newer(latest_version, current_version)
    current_short = _short_sha(current_full)
    latest_short = _short_sha(latest_full)
    if update_type == "invalid":
        message = "The latest release has an invalid update descriptor."
    elif requires_image:
        message = f"PiTunes {latest_version} requires a new tested SD-card image."
    elif available and update_type == "system":
        message = f"PiTunes system update {latest_version} is available."
    elif available:
        message = f"PiTunes app update {latest_version} is available."
    else:
        message = "PiTunes is up to date."

    status = {
        "supported": supported,
        "available": available,
        "applying": False,
        "current": current_short,
        "latest": latest_short,
        "currentVersion": current_version,
        "latestVersion": latest_version,
        "message": message,
        "updateType": update_type,
        "requiresImage": requires_image,
        "branch": UPDATE_CHANNEL,
        "checkedAt": checked_at,
    }
    _last_update_status = status
    return status


def apply_update(base: Path | None = None) -> dict[str, Any]:
    global _last_update_status
    base = base or INSTALL_DIR
    version_data = _load_version_file(base)
    current_version = str(version_data.get("version") or DEFAULT_VERSION)
    running = _running_update_status(base, current_version)
    if running:
        return {"ok": True, "message": running["message"], "applying": True}

    current_full = _full_sha(base)
    if not current_full:
        return {
            "ok": False,
            "message": "Automatic install is not available for this installation.",
        }

    if not _update_supported(base, current_full) and not _system_update_supported(base, current_full):
        return {
            "ok": False,
            "message": "Software updater is not installed for this host.",
        }

    release = _remote_release()
    if not release:
        return {
            "ok": False,
            "message": "Could not find a stable PiTunes release. Check your network connection.",
        }
    latest_full = release["sha"]
    latest_version = release["version"]
    update_type = release.get("updateType") or "app"
    supported, requires_image = _release_support(base, current_full, update_type)
    if requires_image:
        return {
            "ok": False,
            "message": f"PiTunes {latest_version} requires a new tested SD-card image.",
            "requiresImage": True,
            "updateType": update_type,
        }
    if not supported:
        return {
            "ok": False,
            "message": "This release cannot be installed automatically on this system.",
            "updateType": update_type,
        }
    if latest_full == current_full or not _version_is_newer(latest_version, current_version):
        _last_update_status = None
        return {
            "ok": True,
            "message": "PiTunes is already up to date.",
            "current": _short_sha(current_full),
        }

    _last_update_status = None
    service = SYSTEM_UPDATE_SERVICE if update_type == "system" else UPDATE_SERVICE
    allowed = _run(["sudo", "-n", "-l", SYSTEMCTL_BIN, "start", service], timeout=8)
    if allowed.returncode != 0:
        return {
            "ok": False,
            "message": "Updater permission is not installed. Re-run the PiTunes installer.",
        }
    try:
        subprocess.Popen(
            ["sudo", "-n", SYSTEMCTL_BIN, "start", service],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as exc:
        return {"ok": False, "message": f"Could not start updater: {exc}"}
    return {
        "ok": True,
        "message": (
            "System update started. PiTunes will reboot and validate the new system automatically."
            if update_type == "system"
            else "App update started. PiTunes will restart when it is finished."
        ),
        "current": _short_sha(current_full),
        "latest": _short_sha(latest_full),
        "latestVersion": latest_version,
        "updateType": update_type,
        "applying": True,
    }


def get_update_status(base: Path | None = None) -> dict[str, Any]:
    base = base or INSTALL_DIR
    version_data = _load_version_file(base)
    current_version = str(version_data.get("version") or DEFAULT_VERSION)
    running = _running_update_status(base, current_version)
    if running:
        return running
    if _last_update_status:
        return dict(_last_update_status)
    state = _read_update_state()
    current_full = _full_sha(base)
    message = "Tap Check for Updates." if current_full else "Software updates are not available for this installation."
    if state.get("state") == "failed" and state.get("message"):
        message = str(state["message"])
    elif state.get("state") == "succeeded" and state.get("message"):
        message = str(state["message"])
        if state.get("current"):
            current_full = str(state.get("current") or current_full)
    return {
        "supported": _update_supported(base, current_full) or _system_update_supported(base, current_full),
        "available": False,
        "applying": False,
        "current": _short_sha(current_full) if current_full else "",
        "latest": "",
        "currentVersion": current_version,
        "latestVersion": current_version,
        "message": message,
        "updateType": str(state.get("updateType") or "app"),
        "requiresImage": False,
        "branch": UPDATE_CHANNEL,
        "checkedAt": 0,
    }


def get_info(base: Path | None = None) -> dict[str, Any]:
    base = base or INSTALL_DIR
    os_data = _os_release()
    ips = _ip_addresses()
    hostname = socket.gethostname()
    return {
        "hostname": hostname,
        "uptime": _uptime_human(),
        "urls": [f"http://{hostname}.local", *[f"http://{ip}" for ip in ips]],
        "ip": ips,
        "rootDisk": _disk_usage(),
        "memory": _memory_usage(),
        "os": {
            "name": os_data.get("PRETTY_NAME") or os_data.get("NAME") or platform.system(),
            "id": os_data.get("ID", ""),
            "version": os_data.get("VERSION_ID", ""),
        },
        "kernel": platform.release(),
        "architecture": platform.machine(),
        "board": _board_model(),
        "temperature": _cpu_temperature(),
        "python": platform.python_version(),
        "apiVersion": "1.2",
        "pitunes": pitunes_version_info(base),
        "time": int(time.time()),
    }

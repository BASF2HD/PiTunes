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

DEFAULT_VERSION = "1.2.0"
INSTALL_DIR = Path("/opt/pitunes")


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


def _git_short_sha(base: Path) -> str:
    repo = _git_dir(base)
    if not repo:
        return ""
    result = _run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"], timeout=8)
    return result.stdout.strip() if result.returncode == 0 else ""


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
        "commit": _git_short_sha(base),
        "branch": "main",
        "installPath": str(base),
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

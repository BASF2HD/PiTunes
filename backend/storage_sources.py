"""Persistent NAS configuration and mounting helpers."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

CONFIG_FILE = Path("/etc/echoflow/network-storage.json")
MOUNT_SCRIPT = Path("/opt/echoflow/scripts/mount-music-drive.sh")
MOUNT_POINT = Path("/mnt/music")
SYSTEMCTL = Path("/usr/bin/systemctl")


def _run(command: list[str], timeout: int = 60) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except OSError as exc:
        return subprocess.CompletedProcess(command, 127, "", str(exc))


def _config() -> dict:
    try:
        payload = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        payload = {}
    return {
        "protocol": payload.get("protocol", "smb"),
        "server": payload.get("server", ""),
        "share": payload.get("share", ""),
        "username": payload.get("username", ""),
        "password": payload.get("password", ""),
    }


def network_storage_status() -> dict:
    config = _config()
    proc = _run(["/usr/bin/findmnt", "-n", "-o", "FSTYPE,SOURCE", "--target", str(MOUNT_POINT)], timeout=5)
    mount_details = (proc.stdout or "").strip()
    mounted = proc.returncode == 0 and mount_details.split(" ", 1)[0] in {"cifs", "nfs", "nfs4"}
    return {
        "configured": bool(config["server"] and config["share"]),
        "mounted": mounted,
        "mountDetails": mount_details,
        "protocol": config["protocol"],
        "server": config["server"],
        "share": config["share"],
        "username": config["username"],
        "mountPoint": str(MOUNT_POINT),
    }


def network_storage_configure(body: dict) -> dict:
    current = _config()
    protocol = str(body.get("protocol") or "smb").lower()
    server = str(body.get("server") or "").strip()
    share = str(body.get("share") or "").strip().strip("/")
    username = str(body.get("username") or "").strip()
    password = str(body.get("password") or current.get("password") or "")
    if protocol not in {"smb", "nfs"}:
        raise ValueError("Protocol must be SMB or NFS")
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", server):
        raise ValueError("Enter a valid NAS hostname or IP address")
    if not share or "\n" in share:
        raise ValueError("Enter the NAS share name or exported folder")

    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(
        json.dumps({"protocol": protocol, "server": server, "share": share, "username": username, "password": password}, indent=2) + "\n",
        encoding="utf-8",
    )
    CONFIG_FILE.chmod(0o600)
    proc = _run(["sudo", "-n", str(SYSTEMCTL), "restart", "echoflow-mount.service"], timeout=90)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "Could not mount network storage").strip())
    status = network_storage_status()
    if not status["mounted"]:
        raise RuntimeError("NAS details were saved, but the network share could not be mounted")
    return {"ok": True, "message": "Network storage connected. Library scan started.", "storage": status}


def mount_selected_storage() -> None:
    proc = _run(["sudo", "-n", str(SYSTEMCTL), "restart", "echoflow-mount.service"], timeout=90)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "Could not activate music storage").strip())

"""Exercise a finished PC image with USB boot media and disposable QEMU overlays."""

import argparse
import json
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import wave


TRACK = "OfflineCheck"
OPTIONAL = ("bluetooth", "airplay", "ssh")


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def wait_for(description, check, timeout=180):
    print(f"Checking {description}", flush=True)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(2)
    raise RuntimeError(f"Timed out waiting for {description}")


def music_disk(work):
    library = work / "library"
    album = library / TRACK
    album.mkdir(parents=True)
    with wave.open(str(album / f"{TRACK}.wav"), "wb") as wav:
        wav.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
        wav.writeframes(bytes(8000 * 2 * 30))
    disk = work / "music.img"
    run("truncate", "-s", "32M", disk)
    run("mkfs.ext4", "-q", "-F", "-L", "TEST_MUSIC", "-d", library, disk)
    return disk


def display_fault_disk(work, image):
    disk = work / "display-fault.img"
    run("cp", "--sparse=always", "--reflink=auto", image, disk)
    root = work / "fault-root"
    root.mkdir()
    config = work / "99-ci-display-fault.conf"
    config.write_text("[Seat:*]\nxserver-command=/bin/false\n", encoding="ascii")
    loop = run("sudo", "losetup", "--find", "--show", "--partscan", disk,
               capture_output=True, text=True).stdout.strip()
    try:
        run("sudo", "udevadm", "settle")
        run("sudo", "mount", f"{loop}p2", root)
        try:
            assert (root / "etc/pitunes-pc-image").is_file()
            run("sudo", "install", "-m", "0644", config, root / "etc/lightdm/lightdm.conf.d" / config.name)
        finally:
            run("sudo", "umount", root)
    finally:
        run("sudo", "losetup", "-d", loop)
    return disk


class Guest:
    def __init__(self, arch, work, image, music, evidence, name, *, uefi=False, lan=False, save_overlay=False):
        self.evidence = evidence
        self.name = name
        self.overlay = work / f"{name}.qcow2"
        self.qmp = work / "qmp.sock"
        self.port = 18987
        self.save_overlay = save_overlay
        run("qemu-img", "create", "-q", "-f", "qcow2", "-F", "raw", "-b", image, self.overlay)
        args = ["qemu-system-x86_64", "-machine", "q35" if uefi else "pc",
                "-accel", "tcg,thread=multi", "-smp", "2", "-m", "2048",
                "-cpu", "coreduo" if arch == "i386" else "Nehalem",
                "-no-reboot", "-monitor", "none", "-display", "none",
                "-vga", "std",
                "-serial", f"file:{evidence / (name + '.serial.log')}",
                "-qmp", f"unix:{self.qmp},server=on,wait=off"]
        if uefi:
            suffix = "32" if arch == "i386" else ""
            fw = Path("/usr/share/OVMF")
            code = fw / f"OVMF{suffix}_CODE_4M.fd"
            variables = shutil.copyfile(fw / f"OVMF{suffix}_VARS_4M.fd", work / "vars.fd")
            args += ["-drive", f"if=pflash,format=raw,readonly=on,file={code}",
                     "-drive", f"if=pflash,format=raw,file={variables}"]
        else:
            internal = work / "internal.img"
            internal.touch()
            run("truncate", "-s", "32M", internal)
            args += ["-drive", f"if=ide,format=raw,snapshot=on,file={internal}"]
        args += ["-device", "qemu-xhci",
                 "-drive", f"if=none,id=system,format=qcow2,file={self.overlay}",
                 "-device", "usb-storage,drive=system,bootindex=1",
                 "-drive", f"if=none,id=music,format=raw,snapshot=on,file={music}",
                 "-device", "usb-storage,drive=music",
                 "-audiodev", "none,id=sink",
                 "-device", "intel-hda", "-device", "hda-duplex,audiodev=sink",
                 "-nic", f"user,model=e1000,restrict=on,hostfwd=tcp:127.0.0.1:{self.port}-:80" if lan else "none"]
        self.stderr = (evidence / f"{name}.qemu.log").open("wb")
        self.process = subprocess.Popen(args, stdout=self.stderr, stderr=subprocess.STDOUT)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        if self.process.poll() is None:
            self.command("system_powerdown" if self.save_overlay else "quit", optional=True)
            try:
                self.process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                self.process.wait(timeout=10)
        self.stderr.close()
        self.qmp.unlink(missing_ok=True)

    def command(self, name, optional=False, **arguments):
        try:
            with socket.socket(socket.AF_UNIX) as client:
                client.settimeout(5)
                client.connect(str(self.qmp))
                with client.makefile("rwb") as stream:
                    json.loads(stream.readline())
                    for command in ({"execute": "qmp_capabilities"}, {"execute": name, "arguments": arguments}):
                        stream.write(json.dumps(command).encode() + b"\n")
                        stream.flush()
                        while True:
                            response = json.loads(stream.readline())
                            if "return" in response:
                                break
                            if "error" in response:
                                raise RuntimeError(response["error"])
            return True
        except (OSError, ValueError, RuntimeError):
            if optional:
                return False
            raise

    def api(self, endpoint, payload=None, *, timeout=10):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/{endpoint}",
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except (OSError, urllib.error.URLError, ValueError):
            return {}

    def offline_track_visible(self):
        path = self.evidence / f"{self.name}.ppm"
        if not self.command("screendump", optional=True, filename=str(path)):
            return False
        text = run("tesseract", path, "stdout", "--psm", "11", capture_output=True, text=True).stdout
        if "something went wrong while displaying this webpage" in " ".join(text.lower().split()):
            raise RuntimeError(f"Chromium renderer crashed ({path})")
        return TRACK.lower() in re.sub(r"[^a-z]", "", text.lower())


def verify_uefi(guest):
    tracks = wait_for("UEFI boot and local USB scan", lambda: guest.api("library/tracks?limit=10").get("tracks"), timeout=300)
    track = next(track for track in tracks if track["title"] == TRACK)
    services = wait_for("service status after UEFI boot",
                        lambda: guest.api("services", timeout=35).get("services"), timeout=120)
    for name in OPTIONAL:
        assert services[name][0]["active"] == "inactive", name
        assert services[name][0]["enabled"] == "disabled", name
    assert guest.api("player/play", {"file": track["file"], "continuous": False}), "Could not start USB playback"
    def playing():
        status = guest.api("status")
        return status.get("state") == "play" and status.get("elapsed", 0) >= 2
    wait_for("native MPD playback from the USB", playing, timeout=25)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("arch", choices=("amd64", "i386"))
    parser.add_argument("image", type=Path)
    parser.add_argument("evidence", type=Path)
    args = parser.parse_args()
    image = args.image.resolve(strict=True)
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pc-smoke-") as temporary:
        work = Path(temporary)
        music = music_disk(work)
        with Guest(args.arch, work, image, music, evidence, "bios-offline") as guest:
            wait_for("BIOS kiosk and a rendered USB album with no network hardware", guest.offline_track_visible, timeout=420)
        with Guest(args.arch, work, image, music, evidence, "uefi-lan", uefi=True, lan=True) as guest:
            verify_uefi(guest)
        fault_disk = display_fault_disk(work, image)
        with Guest(args.arch, work, fault_disk, music, evidence, "uefi-display-fault",
                   uefi=True, lan=True, save_overlay=True) as guest:
            wait_for("backend readiness with Xorg failing", lambda: guest.api("health").get("ok"))
            def display_failed():
                services = guest.api("services", timeout=35).get("services", {})
                kiosk = services.get("kiosk", [{}])[0]
                return any(component["unit"] == "lightdm.service" and component["active"] == "failed"
                           for component in kiosk.get("components", ()))
            wait_for("bounded LightDM failure", display_failed)
            time.sleep(4)
            assert guest.api("health").get("ok"), "The API stopped after the display failed"
            overlay = guest.overlay
        fat = work / "efi.img"
        run("qemu-img", "dd", "-f", "qcow2", "bs=512", "skip=2048", "count=262144",
            f"if={overlay}", f"of={fat}")
        report = evidence / "pitunes-display.log"
        run("mcopy", "-i", fat, "::pitunes-display.log", report)
        assert "LightDM journal" in report.read_text(), "Display report is incomplete"
    print(f"Passed BIOS offline, UEFI USB playback, and display-failure checks ({args.arch}).", flush=True)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build and paint PiTunes framebuffer boot splash (white logo on black, no Plymouth)."""

from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BOOT_SRC = ROOT / "config" / "brand" / "pitunes-logo-source.png"
OUT_DIR = ROOT / "config" / "boot"

ICON_SPLIT_X = 356
CONTENT_PAD = 24

# Common Pi HDMI / official display sizes
PRESET_SIZES = (
    (1920, 1080),
    (1280, 720),
    (1280, 800),
    (1024, 600),
    (800, 480),
    (720, 480),
)


def _is_logo_pixel(r: int, g: int, b: int, a: int) -> bool:
    return a > 128 and min(r, g, b) > 250


def _content_bounds(img: Image.Image) -> tuple[int, int, int, int]:
    pixels = img.load()
    width, height = img.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if _is_logo_pixel(r, g, b, a):
                xs.append(x)
                ys.append(y)
    if not xs:
        return 0, 0, width, height
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def _boot_logo_rgba() -> Image.Image:
    src = Image.open(BOOT_SRC).convert("RGBA")
    crop = _content_bounds(src)
    left, top, right, bottom = crop
    logo = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
    src_pixels = src.load()
    logo_pixels = logo.load()
    for y in range(top, bottom):
        for x in range(left, right):
            r, g, b, a = src_pixels[x, y]
            if _is_logo_pixel(r, g, b, a):
                logo_pixels[x - left, y - top] = (255, 255, 255, 255)
    return logo


def _compose_frame(width: int, height: int, logo: Image.Image) -> Image.Image:
    frame = Image.new("RGBA", (width, height), (0, 0, 0, 255))
    max_logo_w = int(width * 0.62)
    max_logo_h = int(height * 0.22)
    scale = min(max_logo_w / logo.width, max_logo_h / logo.height, 1.0)
    if scale < 1.0:
        logo = logo.resize(
            (max(1, round(logo.width * scale)), max(1, round(logo.height * scale))),
            Image.LANCZOS,
        )
    offset = ((width - logo.width) // 2, (height - logo.height) // 2)
    frame.paste(logo, offset, logo)
    return frame


def _to_bgra32(frame: Image.Image) -> bytes:
    rgba = frame.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    out = bytearray(width * height * 4)
    index = 0
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            out[index : index + 4] = bytes((b, g, r, a))
            index += 4
    return bytes(out)


def _to_rgb565(frame: Image.Image) -> bytes:
    rgb = frame.convert("RGB")
    pixels = rgb.load()
    width, height = rgb.size
    out = bytearray(width * height * 2)
    index = 0
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            value = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
            out[index : index + 2] = struct.pack("<H", value)
            index += 2
    return bytes(out)


def build_presets() -> None:
    if not BOOT_SRC.exists():
        raise SystemExit(f"Missing boot logo source: {BOOT_SRC}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    logo = _boot_logo_rgba()
    for width, height in PRESET_SIZES:
        frame = _compose_frame(width, height, logo)
        raw32 = OUT_DIR / f"splash-{width}x{height}-32.raw"
        raw16 = OUT_DIR / f"splash-{width}x{height}-16.raw"
        raw32.write_bytes(_to_bgra32(frame))
        raw16.write_bytes(_to_rgb565(frame))
        print(f"Wrote {raw32.name} and {raw16.name}")


def _fb_geometry() -> tuple[int, int, int]:
    fb0 = Path("/sys/class/graphics/fb0")
    if not fb0.exists():
        raise SystemExit("Framebuffer /sys/class/graphics/fb0 not found")
    size = (fb0 / "virtual_size").read_text(encoding="ascii").strip()
    width, height = (int(part) for part in size.split(","))
    bpp = int((fb0 / "bits_per_pixel").read_text(encoding="ascii").strip())
    return width, height, bpp


def _pick_preset(width: int, height: int) -> tuple[int, int] | None:
    if (width, height) in PRESET_SIZES:
        return width, height
    best = None
    best_delta = 10**9
    for preset_w, preset_h in PRESET_SIZES:
        delta = abs(preset_w - width) + abs(preset_h - height)
        if delta < best_delta:
            best = (preset_w, preset_h)
            best_delta = delta
    return best


def paint_framebuffer(boot_dir: Path) -> None:
    fb_path = Path("/dev/fb0")
    if not fb_path.exists():
        raise SystemExit("Framebuffer /dev/fb0 not found")
    width, height, bpp = _fb_geometry()
    preset = _pick_preset(width, height)
    if preset:
        preset_w, preset_h = preset
        suffix = "16" if bpp == 16 else "32"
        candidate = boot_dir / f"splash-{preset_w}x{preset_h}-{suffix}.raw"
        if candidate.exists() and preset_w == width and preset_h == height:
            fb_path.write_bytes(candidate.read_bytes())
            print(f"Painted {candidate.name} to /dev/fb0")
            return

    if not BOOT_SRC.exists():
        fb_path.write_bytes(b"\x00" * (width * height * (bpp // 8)))
        print("Painted black framebuffer (no logo source)")
        return

    logo = _boot_logo_rgba()
    frame = _compose_frame(width, height, logo)
    payload = _to_rgb565(frame) if bpp == 16 else _to_bgra32(frame)
    fb_path.write_bytes(payload)
    print(f"Painted runtime {width}x{height}@{bpp}bpp framebuffer")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", help="Write preset raw images to config/boot/")
    parser.add_argument("--paint", action="store_true", help="Paint /dev/fb0 on a running Pi")
    parser.add_argument(
        "--boot-dir",
        type=Path,
        default=OUT_DIR,
        help="Directory containing splash-*.raw presets",
    )
    args = parser.parse_args()
    if args.build:
        build_presets()
        return
    if args.paint:
        paint_framebuffer(args.boot_dir)
        return
    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()

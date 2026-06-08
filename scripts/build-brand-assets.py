#!/usr/bin/env python3
"""Generate PiTunes logo, favicon, boot splash, and GitHub assets from brand sources."""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BOOT_SRC = ROOT / "config" / "brand" / "pitunes-logo-source.png"
BRANDED_SRC = ROOT / "config" / "brand" / "pitunes-logo-branded.png"
FRONTEND = ROOT / "frontend" / "assets"
PLYMOUTH = ROOT / "config" / "plymouth" / "pitunes"  # legacy; boot uses config/boot/*.raw via build-boot-fb-splash.py
DOCS = ROOT / "docs" / "assets"

ICON_SPLIT_X = 356
CONTENT_PAD = 24

# Light gray from branded reference (~#d1d1d1)
APPLE_GRAY_LIGHT = (209, 209, 209)
WHITE = (255, 255, 255)


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


def _crop_content(img: Image.Image, pad: int = CONTENT_PAD) -> Image.Image:
    left, top, right, bottom = _content_bounds(img)
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(img.width, right + pad)
    bottom = min(img.height, bottom + pad)
    return img.crop((left, top, right, bottom))


def _crop_icon(img: Image.Image) -> Image.Image:
    left, top, right, bottom = _content_bounds(img)
    icon_right = min(ICON_SPLIT_X, right)
    pad = CONTENT_PAD
    return img.crop(
        (
            max(0, left - pad),
            max(0, top - pad),
            min(img.width, icon_right + pad),
            min(img.height, bottom + pad),
        )
    )


def _extract_white_transparent(img: Image.Image) -> Image.Image:
    """White logo marks only — no background (for boot splash)."""
    src = img.convert("RGBA")
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    pixels = src.load()
    out_pixels = out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = pixels[x, y]
            if _is_logo_pixel(r, g, b, a):
                out_pixels[x, y] = (255, 255, 255, 255)
    return out


def _fit_width(img: Image.Image, width: int) -> Image.Image:
    if img.width <= width:
        return img.copy()
    height = max(1, round(img.height * width / img.width))
    return img.resize((width, height), Image.LANCZOS)


def _pad_horizontal_rgb(img: Image.Image, pad_x: int, background: tuple[int, int, int]) -> Image.Image:
    rgb = img.convert("RGB")
    canvas = Image.new("RGB", (rgb.width + pad_x * 2, rgb.height), background)
    canvas.paste(rgb, (pad_x, 0))
    return canvas


def _square_icon_from_branded(icon_rgb: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGB", (size, size), APPLE_GRAY_LIGHT)
    scale = min(size / icon_rgb.width, size / icon_rgb.height) * 0.88
    resized = icon_rgb.resize(
        (max(1, round(icon_rgb.width * scale)), max(1, round(icon_rgb.height * scale))),
        Image.LANCZOS,
    )
    offset = ((size - resized.width) // 2, (size - resized.height) // 2)
    canvas.paste(resized, offset)
    return canvas


def _write_svg_from_png(img: Image.Image, svg_path: Path, label: str = "PiTunes") -> None:
    buf = BytesIO()
    img.save(buf, format="PNG")
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    width, height = img.size
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'role="img" aria-label="{label}">\n'
        f'  <image width="{width}" height="{height}" href="data:image/png;base64,{data}"/>\n'
        "</svg>\n"
    )
    svg_path.write_text(svg, encoding="utf-8")


def _write_favicon_ico(sizes: dict[int, Path], out_path: Path) -> None:
    images = [Image.open(path).convert("RGBA") for path in sizes.values()]
    images[0].save(
        out_path,
        format="ICO",
        sizes=[(size, size) for size in sorted(sizes)],
        append_images=images[1:],
    )


def _social_preview(logo: Image.Image, out_path: Path) -> None:
    canvas = Image.new("RGB", (1280, 640), APPLE_GRAY_LIGHT)
    fitted = _fit_width(logo.convert("RGB"), 760)
    offset = ((1280 - fitted.width) // 2, (640 - fitted.height) // 2)
    canvas.paste(fitted, offset)
    canvas.save(out_path, "PNG")


def main() -> None:
    if not BOOT_SRC.exists():
        raise SystemExit(f"Missing boot source logo: {BOOT_SRC}")
    if not BRANDED_SRC.exists():
        raise SystemExit(f"Missing branded logo: {BRANDED_SRC}")

    boot_src = Image.open(BOOT_SRC).convert("RGBA")
    branded_src = Image.open(BRANDED_SRC).convert("RGBA")

    boot_logo = _fit_width(_extract_white_transparent(_crop_content(boot_src)), 720)
    branded_logo = _pad_horizontal_rgb(_crop_content(branded_src), pad_x=48, background=APPLE_GRAY_LIGHT)
    branded_icon = _crop_icon(branded_src).convert("RGB")

    DOCS.mkdir(parents=True, exist_ok=True)

    boot_logo.save(PLYMOUTH / "pitunes-logo.png", "PNG")
    branded_logo.save(DOCS / "pitunes-logo.png", "PNG")
    _fit_width(branded_logo, 720).save(FRONTEND / "pitunes-logo.png", "PNG")

    icon_512 = _square_icon_from_branded(branded_icon, 512)
    icon_512.save(FRONTEND / "pitunes-icon-512.png", "PNG")
    icon_192 = _square_icon_from_branded(branded_icon, 192)
    icon_192.save(FRONTEND / "pitunes-icon-192.png", "PNG")
    icon_32 = _square_icon_from_branded(branded_icon, 32)
    icon_32.save(FRONTEND / "favicon-32.png", "PNG")
    icon_16 = _square_icon_from_branded(branded_icon, 16)
    icon_16.save(FRONTEND / "favicon-16.png", "PNG")

    favicon_ico = FRONTEND / "favicon.ico"
    _write_favicon_ico(
        {16: FRONTEND / "favicon-16.png", 32: FRONTEND / "favicon-32.png"},
        favicon_ico,
    )
    (ROOT / "frontend" / "favicon.ico").write_bytes(favicon_ico.read_bytes())
    _write_svg_from_png(icon_512, FRONTEND / "favicon.svg", label="PiTunes icon")
    _write_svg_from_png(boot_logo, PLYMOUTH / "pitunes-logo.svg", label="PiTunes")

    _social_preview(branded_logo, DOCS / "pitunes-social-preview.png")
    _social_preview(branded_logo, ROOT / ".github" / "social-preview.png")

    print("Brand assets generated:")
    for path in [
        PLYMOUTH / "pitunes-logo.png",
        FRONTEND / "favicon.ico",
        FRONTEND / "favicon.svg",
        DOCS / "pitunes-logo.png",
        DOCS / "pitunes-social-preview.png",
        ROOT / ".github" / "social-preview.png",
    ]:
        print(f"  {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

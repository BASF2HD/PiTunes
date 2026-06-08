#!/usr/bin/env python3
"""Generate PiTunes logo, favicon, boot splash, and GitHub assets from the master PNG."""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "config" / "brand" / "pitunes-logo-source.png"
FRONTEND = ROOT / "frontend" / "assets"
PLYMOUTH = ROOT / "config" / "plymouth" / "pitunes"
DOCS = ROOT / "docs" / "assets"

ICON_SPLIT_X = 356
CONTENT_PAD = 24
# Apple-style dark gray (not pure black) — matches boot splash and README
APPLE_GRAY = (29, 29, 31)


def _content_bounds(img: Image.Image) -> tuple[int, int, int, int]:
    pixels = img.load()
    width, height = img.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a > 128 and (r + g + b) > 200:
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


def _on_apple_gray(img: Image.Image) -> Image.Image:
    """Composite white logo marks onto Apple gray instead of source black."""
    src = img.convert("RGBA")
    out = Image.new("RGBA", src.size, (*APPLE_GRAY, 255))
    pixels = src.load()
    logo = Image.new("RGBA", src.size, (0, 0, 0, 0))
    logo_pixels = logo.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = pixels[x, y]
            if a > 128 and (r + g + b) > 200:
                logo_pixels[x, y] = (255, 255, 255, 255)
    out.paste(logo, (0, 0), logo)
    return out


def _fit_width(img: Image.Image, width: int) -> Image.Image:
    if img.width <= width:
        return img.copy()
    height = max(1, round(img.height * width / img.width))
    return img.resize((width, height), Image.LANCZOS)


def _square_icon(img: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (*APPLE_GRAY, 255))
    scale = min(size / img.width, size / img.height) * 0.88
    resized = img.resize(
        (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
        Image.LANCZOS,
    )
    offset = ((size - resized.width) // 2, (size - resized.height) // 2)
    canvas.paste(resized, offset, resized)
    return canvas


def _write_svg_icon(img: Image.Image, svg_path: Path, label: str = "PiTunes") -> None:
    buf = BytesIO()
    img.save(buf, format="PNG")
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    size = img.size[0]
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'role="img" aria-label="{label}">\n'
        f'  <image width="{size}" height="{size}" href="data:image/png;base64,{data}"/>\n'
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
    canvas = Image.new("RGB", (1280, 640), APPLE_GRAY)
    fitted = _fit_width(logo, 760)
    offset = ((1280 - fitted.width) // 2, (640 - fitted.height) // 2)
    canvas.paste(fitted, offset)
    canvas.save(out_path, "PNG")


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing source logo: {SRC}")

    src = Image.open(SRC).convert("RGBA")
    logo = _on_apple_gray(_crop_content(src))
    icon = _on_apple_gray(_crop_icon(src))

    DOCS.mkdir(parents=True, exist_ok=True)

    boot_logo = _fit_width(logo, 720)
    boot_logo.save(PLYMOUTH / "pitunes-logo.png", "PNG")
    logo.save(FRONTEND / "pitunes-logo.png", "PNG")
    logo.save(DOCS / "pitunes-logo.png", "PNG")

    icon_512 = _square_icon(icon, 512)
    icon_512.save(FRONTEND / "pitunes-icon-512.png", "PNG")
    icon_192 = _square_icon(icon, 192)
    icon_192.save(FRONTEND / "pitunes-icon-192.png", "PNG")
    icon_32 = _square_icon(icon, 32)
    icon_32.save(FRONTEND / "favicon-32.png", "PNG")
    icon_16 = _square_icon(icon, 16)
    icon_16.save(FRONTEND / "favicon-16.png", "PNG")

    favicon_ico = FRONTEND / "favicon.ico"
    _write_favicon_ico(
        {16: FRONTEND / "favicon-16.png", 32: FRONTEND / "favicon-32.png"},
        favicon_ico,
    )
    (ROOT / "frontend" / "favicon.ico").write_bytes(favicon_ico.read_bytes())
    _write_svg_icon(icon_512, FRONTEND / "favicon.svg")
    _write_svg_icon(boot_logo.convert("RGBA"), PLYMOUTH / "pitunes-logo.svg", label="PiTunes")

    _social_preview(logo, DOCS / "pitunes-social-preview.png")
    _social_preview(logo, ROOT / ".github" / "social-preview.png")

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

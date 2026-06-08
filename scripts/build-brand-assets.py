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

# Apple system grays
APPLE_GRAY_LIGHT = (245, 245, 247)  # #f5f5f7 — README / GitHub (clearly light gray)
APPLE_GRAY_BOOT = (72, 72, 74)  # #48484a — boot splash (visible gray, white logo)
APPLE_INK = (29, 29, 31)  # #1d1d1f — logo marks on light backgrounds
WHITE = (255, 255, 255)


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


def _composite_logo(img: Image.Image, background: tuple[int, int, int], mark: tuple[int, int, int]) -> Image.Image:
    """Render source white marks as `mark` on `background` (opaque RGB)."""
    src = img.convert("RGBA")
    out = Image.new("RGB", src.size, background)
    pixels = src.load()
    layer = Image.new("RGBA", src.size, (0, 0, 0, 0))
    layer_pixels = layer.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = pixels[x, y]
            if a > 128 and (r + g + b) > 200:
                layer_pixels[x, y] = (*mark, 255)
    out.paste(layer, (0, 0), layer)
    return out


def _fit_width(img: Image.Image, width: int) -> Image.Image:
    if img.width <= width:
        return img.copy()
    height = max(1, round(img.height * width / img.width))
    return img.resize((width, height), Image.LANCZOS)


def _pad_horizontal(img: Image.Image, pad_x: int, background: tuple[int, int, int]) -> Image.Image:
    canvas = Image.new("RGB", (img.width + pad_x * 2, img.height), background)
    canvas.paste(img, (pad_x, 0))
    return canvas


def _square_icon(img: Image.Image, size: int, background: tuple[int, int, int]) -> Image.Image:
    rgba = img.convert("RGBA")
    canvas = Image.new("RGBA", (size, size), (*background, 255))
    scale = min(size / rgba.width, size / rgba.height) * 0.88
    resized = rgba.resize(
        (max(1, round(rgba.width * scale)), max(1, round(rgba.height * scale))),
        Image.LANCZOS,
    )
    offset = ((size - resized.width) // 2, (size - resized.height) // 2)
    canvas.paste(resized, offset, resized)
    return canvas.convert("RGB")


def _write_svg_icon(img: Image.Image, svg_path: Path, label: str = "PiTunes") -> None:
    buf = BytesIO()
    img.convert("RGB").save(buf, format="PNG")
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


def _social_preview(logo: Image.Image, out_path: Path, background: tuple[int, int, int]) -> None:
    canvas = Image.new("RGB", (1280, 640), background)
    fitted = _fit_width(logo, 760)
    offset = ((1280 - fitted.width) // 2, (640 - fitted.height) // 2)
    canvas.paste(fitted, offset)
    canvas.save(out_path, "PNG")


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing source logo: {SRC}")

    src = Image.open(SRC).convert("RGBA")
    crop = _crop_content(src)
    icon_crop = _crop_icon(src)

    logo_light = _pad_horizontal(
        _composite_logo(crop, APPLE_GRAY_LIGHT, APPLE_INK),
        pad_x=48,
        background=APPLE_GRAY_LIGHT,
    )
    logo_boot = _composite_logo(crop, APPLE_GRAY_BOOT, WHITE)
    icon_boot = _composite_logo(icon_crop, APPLE_GRAY_BOOT, WHITE)

    DOCS.mkdir(parents=True, exist_ok=True)

    boot_logo = _fit_width(logo_boot, 720)
    boot_logo.save(PLYMOUTH / "pitunes-logo.png", "PNG")
    logo_light.save(DOCS / "pitunes-logo.png", "PNG")
    _fit_width(logo_light, 720).save(FRONTEND / "pitunes-logo.png", "PNG")

    icon_512 = _square_icon(icon_boot, 512, APPLE_GRAY_BOOT)
    icon_512.save(FRONTEND / "pitunes-icon-512.png", "PNG")
    icon_192 = _square_icon(icon_boot, 192, APPLE_GRAY_BOOT)
    icon_192.save(FRONTEND / "pitunes-icon-192.png", "PNG")
    icon_32 = _square_icon(icon_boot, 32, APPLE_GRAY_BOOT)
    icon_32.save(FRONTEND / "favicon-32.png", "PNG")
    icon_16 = _square_icon(icon_boot, 16, APPLE_GRAY_BOOT)
    icon_16.save(FRONTEND / "favicon-16.png", "PNG")

    favicon_ico = FRONTEND / "favicon.ico"
    _write_favicon_ico(
        {16: FRONTEND / "favicon-16.png", 32: FRONTEND / "favicon-32.png"},
        favicon_ico,
    )
    (ROOT / "frontend" / "favicon.ico").write_bytes(favicon_ico.read_bytes())
    _write_svg_icon(icon_512, FRONTEND / "favicon.svg")
    _write_svg_icon(boot_logo, PLYMOUTH / "pitunes-logo.svg", label="PiTunes")

    _social_preview(logo_light, DOCS / "pitunes-social-preview.png", APPLE_GRAY_LIGHT)
    _social_preview(logo_light, ROOT / ".github" / "social-preview.png", APPLE_GRAY_LIGHT)

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

#!/usr/bin/env python3
import base64
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "frontend" / "assets"
SRC = ASSETS / "radio-no-logo-source.png"
OUT_PNG = ASSETS / "radio-no-logo.png"
OUT_SVG = ASSETS / "radio-no-logo.svg"
SIZE = 420
ICON = 300


def main() -> None:
    icon = Image.open(SRC).convert("RGBA")
    canvas = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
    icon = icon.resize((ICON, ICON), Image.LANCZOS)
    offset = (SIZE - ICON) // 2
    canvas.paste(icon, (offset, offset), icon)
    canvas.save(OUT_PNG, "PNG")

    buf = BytesIO()
    canvas.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420" '
        'viewBox="0 0 420 420" role="img" aria-label="Radio">\n'
        '  <rect width="420" height="420" fill="#ffffff"/>\n'
        f'  <image width="420" height="420" preserveAspectRatio="xMidYMid meet" '
        f'href="data:image/png;base64,{b64}"/>\n'
        "</svg>\n"
    )
    OUT_SVG.write_text(svg, encoding="utf-8")
    print(f"Wrote {OUT_PNG.name} and {OUT_SVG.name}")


if __name__ == "__main__":
    main()

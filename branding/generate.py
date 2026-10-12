"""Generates k3dlamp's brand assets into branding/overlay/.

The overlay mirrors paths in a Headlamp checkout; branding/apply.sh copies
it over Headlamp's own logos and icons during the build.

The bitswalk mark is traced from source/bitswalk-avatar.png, the org's
GitHub avatar: a 128-unit grid of rectangles with no anti-aliasing. The
script checks the traced geometry against that image pixel for pixel. The
wordmark is set in Overpass Regular, the only weight Headlamp bundles for
its UI, and converted to outlines so it renders the same everywhere.

    python generate.py <path to Overpass latin.woff2>

The font sits at frontend/src/assets/fonts/overpass/latin.woff2 in a
Headlamp checkout. Requires pillow, fonttools and brotli.
"""

import io
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
OVERLAY = HERE / "overlay"

RED = "#DB162F"
WHITE = "#FFFFFF"
INK_ON_LIGHT = "#202020"  # Headlamp's light navbar text colour
INK_ON_DARK = "#FAF9F8"  # Headlamp's dark navbar text colour
WORDMARK = "k3dlamp"

GRID = 128
# The "b": a stem, a bar, a leg stepping down to the left, then bits.
GLYPH_RECTS = [
    (32, 24, 16, 32),
    (32, 56, 64, 16),
    (80, 72, 16, 16),
    (76, 88, 20, 6),
    (70, 94, 26, 6),
    (64, 100, 32, 4),
]
BITS = [(x, 88) for x in (46, 52, 58, 64, 70)] + [
    (x, 94) for x in (40, 46, 52, 58, 64)
] + [(x, 100) for x in (34, 40, 46, 52, 58)]
GLYPH_RECTS += [(x, y, 4, 4) for x, y in BITS]


def check_trace():
    """Fails unless the traced glyph is exactly the avatar's cut-out."""
    source = Image.open(HERE / "source" / "bitswalk-avatar.png").convert("RGBA")
    assert source.size == (GRID, GRID), source.size
    traced = Image.new("1", (GRID, GRID), 0)
    draw = ImageDraw.Draw(traced)
    for x, y, w, h in GLYPH_RECTS:
        draw.rectangle([x, y, x + w - 1, y + h - 1], fill=1)
    alpha = source.getchannel("A")
    for y in range(GRID):
        for x in range(GRID):
            cut = alpha.getpixel((x, y)) < 128
            if cut != bool(traced.getpixel((x, y))):
                sys.exit(f"trace differs from the avatar at ({x}, {y})")


def glyph_path():
    return "".join(f"M{x} {y}h{w}v{h}h{-w}z" for x, y, w, h in GLYPH_RECTS)


def mark_svg():
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {GRID} {GRID}" '
        f'width="32" height="32" role="img" aria-label="{WORDMARK}">'
        f"<title>{WORDMARK}</title>"
        f'<rect width="{GRID}" height="{GRID}" fill="{RED}"/>'
        f'<path fill="{WHITE}" d="{glyph_path()}"/></svg>\n'
    )


def mask_svg():
    """Single-colour silhouette for Safari's pinned-tab mask icon."""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {GRID} {GRID}">'
        f'<path fill-rule="evenodd" d="M0 0h{GRID}v{GRID}h-{GRID}z{glyph_path()}"/></svg>\n'
    )


def wordmark_path(font_file, height):
    """Outlines WORDMARK so its ascenders and descenders span `height` units."""
    font = TTFont(font_file)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    names = [cmap[ord(c)] for c in WORDMARK]

    bounds = BoundsPen(glyphs)
    advance = 0
    for name in names:
        glyphs[name].draw(TransformPen(bounds, (1, 0, 0, 1, advance, 0)))
        advance += glyphs[name].width
    x_min, y_min, x_max, y_max = bounds.bounds
    scale = height / (y_max - y_min)

    pen = SVGPathPen(glyphs)
    # Flip y, scale, and move the ink box to (0, 0).
    transform = (scale, 0, 0, -scale, -x_min * scale, y_max * scale)
    offset = 0
    for name in names:
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, 1, offset, 0)))
        offset += glyphs[name].width
    path = pen.getCommands()
    return path, transform, (x_max - x_min) * scale


def logo_svg(font_file, ink):
    """Mark plus wordmark, 32 units tall like Headlamp's AppLogo."""
    height, gap, text_height = 32, 9, 26
    path, (a, b, c, d, e, f), width = wordmark_path(font_file, text_height)
    top = (height - text_height) / 2
    total = height + gap + width
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total:.2f} {height}" '
        f'width="{total:.2f}" height="{height}" role="img" aria-label="{WORDMARK}">'
        f"<title>{WORDMARK}</title>"
        f'<g transform="scale({height / GRID})">'
        f'<rect width="{GRID}" height="{GRID}" fill="{RED}"/>'
        f'<path fill="{WHITE}" d="{glyph_path()}"/></g>'
        f'<path fill="{ink}" transform="matrix({a:.5f} {b} {c} {d:.5f} '
        f'{e + height + gap:.3f} {f + top:.3f})" d="{path}"/></svg>\n'
    )


def render(size, glyph_only=False, mode="RGBA"):
    """Rasterises the mark at `size` pixels, supersampled for clean edges."""
    big = size * 16
    unit = big / GRID
    if glyph_only:
        canvas = Image.new("LA", (big, big), (0, 0))
        fill = (0, 255)
    else:
        canvas = Image.new("RGBA", (big, big), RED)
        fill = WHITE
    draw = ImageDraw.Draw(canvas)
    for x, y, w, h in GLYPH_RECTS:
        draw.rectangle(
            [round(x * unit), round(y * unit), round((x + w) * unit) - 1, round((y + h) * unit) - 1],
            fill=fill,
        )
    return canvas.resize((size, size), Image.LANCZOS).convert(mode)


def write(relative, data):
    path = OVERLAY / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        path.write_text(data)
    elif isinstance(data, Image.Image):
        data.save(path)
    else:
        path.write_bytes(data)
    print(f"wrote {relative}")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    font_file = sys.argv[1]
    check_trace()

    resources = "frontend/src/resources"
    write(f"{resources}/icon-light.svg", mark_svg())
    write(f"{resources}/icon-dark.svg", mark_svg())
    # AppLogo shows logo-light on dark navbars and logo-dark on light ones.
    write(f"{resources}/logo-light.svg", logo_svg(font_file, INK_ON_DARK))
    write(f"{resources}/logo-dark.svg", logo_svg(font_file, INK_ON_LIGHT))

    public = "frontend/public"
    write(f"{public}/logo-light.svg", logo_svg(font_file, INK_ON_DARK))
    write(f"{public}/safari-pinned-tab.svg", mask_svg())
    for name, size in [
        ("android-chrome-192x192.png", 192),
        ("android-chrome-512x512.png", 512),
        ("apple-touch-icon.png", 180),
        ("favicon-16x16.png", 16),
        ("favicon-32x32.png", 32),
        ("mstile-150x150.png", 270),
    ]:
        write(f"{public}/{name}", render(size))

    ico = io.BytesIO()
    render(256).save(ico, format="ICO", sizes=[(s, s) for s in (16, 32, 64, 128, 256)])
    write(f"{public}/favicon.ico", ico.getvalue())
    ico = io.BytesIO()
    render(256).save(ico, format="ICO", sizes=[(256, 256)])
    write(f"{public}/icon.ico", ico.getvalue())
    icns = io.BytesIO()
    render(1024).save(icns, format="ICNS")
    write(f"{public}/icon.icns", icns.getvalue())

    write("app/assets/tray-icon.png", render(22))
    write("app/assets/tray-icon@2x.png", render(44))
    # macOS template icons: the glyph alone, as black with alpha.
    write("app/assets/tray-iconTemplate.png", render(16, glyph_only=True, mode="LA"))
    write("app/assets/tray-iconTemplate@2x.png", render(32, glyph_only=True, mode="LA"))


if __name__ == "__main__":
    main()

"""A thin layer over a reportlab canvas: top-left coordinates in points, a
record of every named field (page, box, text, font) and per-field overrides,
which is how an in-place edit of the content stream is produced."""
from __future__ import annotations

import io
import os

import reportlab
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
_RL = os.path.join(os.path.dirname(reportlab.__file__), "fonts")

FONTS = {
    "Sans": ("LiberationSans", os.path.join(HERE, "fonts", "LiberationSans-Regular.ttf")),
    "Sans-B": ("LiberationSans-Bold", os.path.join(HERE, "fonts", "LiberationSans-Bold.ttf")),
    "Sans-I": ("LiberationSans-Italic", os.path.join(HERE, "fonts", "LiberationSans-Italic.ttf")),
    "Serif": ("LiberationSerif", os.path.join(HERE, "fonts", "LiberationSerif-Regular.ttf")),
    "Serif-B": ("LiberationSerif-Bold", os.path.join(HERE, "fonts", "LiberationSerif-Bold.ttf")),
    "Serif-I": ("LiberationSerif-Italic", os.path.join(HERE, "fonts", "LiberationSerif-Italic.ttf")),
    "Mono": ("LiberationMono", os.path.join(HERE, "fonts", "LiberationMono-Regular.ttf")),
    "Mono-B": ("LiberationMono-Bold", os.path.join(HERE, "fonts", "LiberationMono-Bold.ttf")),
    "Vera": ("BitstreamVeraSans", os.path.join(_RL, "Vera.ttf")),
    "Vera-B": ("BitstreamVeraSans-Bold", os.path.join(_RL, "VeraBd.ttf")),
}
FONT_FILES = {k: v[1] for k, v in FONTS.items()}

A4 = (595.0, 842.0)
INK = (0.10, 0.10, 0.11)
GREY = (0.42, 0.43, 0.46)
WHITE = (1, 1, 1)


def register():
    for key, (name, path) in FONTS.items():
        if name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(name, path))


def width(s: str, font: str, size: float) -> float:
    register()
    return pdfmetrics.stringWidth(s, FONTS[font][0], size)


def hexc(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))


class Sheet:
    def __init__(self, size=A4, overrides: dict | None = None, watermark=True, wm_color=(0.905, 0.91, 0.925)):
        register()
        self.buf = io.BytesIO()
        self.W, self.H = size
        self.c = canvas.Canvas(self.buf, pagesize=size, invariant=1, pageCompression=1)
        self.page = 1
        self.fields: dict[str, dict] = {}
        self.over = overrides or {}
        self.wm = watermark
        self.wm_color = wm_color
        if watermark:
            self.watermark()

    # -- drawing ---------------------------------------------------------------
    def watermark(self):
        c = self.c
        c.saveState()
        c.setFillColorRGB(*self.wm_color)
        c.translate(self.W / 2, self.H / 2)
        c.rotate(38)
        size = min(self.W, self.H) * 0.19
        c.setFont(FONTS["Sans-B"][0], size)
        c.drawCentredString(0, -size * 0.35, "SPECIMEN")
        c.restoreState()

    def text(self, x, y, s, font="Sans", size=9.0, color=INK, align="l", field=None, bg=WHITE, charspace=0.0):
        """Draws `s` with its baseline at y (from the top). `align`: l, r or c about x."""
        s = str(s)
        dy = 0.0
        if field and field in self.over:
            o = self.over[field]
            s = o.get("text", s)
            font = o.get("font", font)
            size = size + o.get("dsize", 0.0)
            dy = o.get("dy", 0.0)
            charspace = o.get("charspace", charspace)
            color = o.get("color", color)
        w = width(s, font, size) + charspace * max(0, len(s) - 1)
        x0 = x if align == "l" else (x - w if align == "r" else x - w / 2)
        c = self.c
        c.setFillColorRGB(*color)
        t = c.beginText(x0, self.H - (y + dy))
        t.setFont(FONTS[font][0], size)
        if charspace:
            t.setCharSpace(charspace)
        t.textOut(s)
        c.drawText(t)
        if field:
            self.fields[field] = {
                "page": self.page,
                "text": s,
                "font": font,
                "size": size,
                "color": color,
                "bg": bg,
                "align": align,
                "anchor": x,
                "baseline": y + dy,
                "pt": [x0, y + dy - 0.76 * size, x0 + w, y + dy + 0.24 * size],
                "box": [
                    round(max(0, (x0 - 0.5) / self.W), 5),
                    round(max(0, (y + dy - 0.80 * size) / self.H), 5),
                    round(min(1, (x0 + w + 0.5) / self.W), 5),
                    round(min(1, (y + dy + 0.26 * size) / self.H), 5),
                ],
            }
        return w

    def rect(self, x, y, w, h, fill=None, stroke=None, lw=0.6, radius=0.0):
        c = self.c
        if fill:
            c.setFillColorRGB(*fill)
        if stroke:
            c.setStrokeColorRGB(*stroke)
            c.setLineWidth(lw)
        if radius:
            c.roundRect(x, self.H - y - h, w, h, radius, stroke=1 if stroke else 0, fill=1 if fill else 0)
        else:
            c.rect(x, self.H - y - h, w, h, stroke=1 if stroke else 0, fill=1 if fill else 0)

    def line(self, x0, y0, x1, y1, color=INK, lw=0.6, dash=None):
        c = self.c
        c.setStrokeColorRGB(*color)
        c.setLineWidth(lw)
        c.setDash(dash or [])
        c.line(x0, self.H - y0, x1, self.H - y1)
        c.setDash([])

    def circle(self, x, y, r, fill=None, stroke=None, lw=0.6):
        c = self.c
        if fill:
            c.setFillColorRGB(*fill)
        if stroke:
            c.setStrokeColorRGB(*stroke)
            c.setLineWidth(lw)
        c.circle(x, self.H - y, r, stroke=1 if stroke else 0, fill=1 if fill else 0)

    def poly(self, pts, fill=None, stroke=None, lw=0.6, close=True, curve=False):
        c = self.c
        p = c.beginPath()
        p.moveTo(pts[0][0], self.H - pts[0][1])
        if curve:
            for i in range(1, len(pts) - 2, 3):
                (a, b), (d, e), (f, g) = pts[i], pts[i + 1], pts[i + 2]
                p.curveTo(a, self.H - b, d, self.H - e, f, self.H - g)
        else:
            for x, y in pts[1:]:
                p.lineTo(x, self.H - y)
        if close:
            p.close()
        if fill:
            c.setFillColorRGB(*fill)
        if stroke:
            c.setStrokeColorRGB(*stroke)
            c.setLineWidth(lw)
        c.drawPath(p, stroke=1 if stroke else 0, fill=1 if fill else 0)

    def new_page(self):
        self.c.showPage()
        self.page += 1
        if self.wm:
            self.watermark()

    def finish(self) -> bytes:
        self.c.showPage()
        self.c.save()
        return self.buf.getvalue()

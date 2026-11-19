"""Text runs and painted shapes of a PDF page, in paint order (pdfminer.six).

A run is a stretch of characters drawn together: same font, size, colour and
baseline, no gap. Coordinates are 0..1 of the page, origin top-left; sizes,
baselines and character positions are also kept in points."""
from __future__ import annotations

import math
import re

from pdfminer.converter import PDFPageAggregator
from pdfminer.layout import LTChar, LTCurve, LTImage, LTLine, LTRect
from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
from pdfminer.pdfpage import PDFPage
from pdfminer.pdftypes import dict_value, resolve1
from pdfminer.psparser import literal_name

_SUBSET = re.compile(r"^[A-Z]{6}\+")


class _Device(PDFPageAggregator):
    def __init__(self, rsrcmgr):
        super().__init__(rsrcmgr, laparams=None)
        self.items: list = []
        self.alpha = 1.0
        self._render = 0
        self._charspace = 0.0

    def _tag(self, start):
        for o in self.cur_item._objs[start:]:
            if not hasattr(o, "l_seq"):
                o.l_seq = len(self.items)
                o.l_alpha = self.alpha
                self.items.append(o)

    def render_string(self, textstate, seq, ncs, graphicstate):
        self._render = textstate.render
        self._charspace = textstate.charspace
        super().render_string(textstate, seq, ncs, graphicstate)

    def render_char(self, matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate):
        n = len(self.cur_item._objs)
        adv = super().render_char(matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate)
        for o in self.cur_item._objs[n:]:
            o.l_fontsize = fontsize
            o.l_rise = rise
            o.l_render = self._render
            o.l_charspace = self._charspace
        self._tag(n)
        return adv

    def paint_path(self, gstate, stroke, fill, evenodd, path):
        n = len(self.cur_item._objs)
        super().paint_path(gstate, stroke, fill, evenodd, path)
        self._tag(n)

    def render_image(self, name, stream):
        n = len(self.cur_item._objs)
        super().render_image(name, stream)
        self._tag(n)


class _Interp(PDFPageInterpreter):
    def init_resources(self, resources):
        super().init_resources(resources)
        try:
            self._gs = dict_value(dict_value(resources).get("ExtGState", {})) if resources else {}
        except Exception:
            self._gs = {}

    def do_gs(self, name):
        try:
            d = dict_value(self._gs.get(literal_name(name), {}))
            ca = d.get("ca")
            if ca is not None:
                self.device.alpha = float(resolve1(ca))
        except Exception:
            pass

    def do_q(self):
        super().do_q()
        self.__dict__.setdefault("_astack", []).append(self.device.alpha)

    def do_Q(self):
        super().do_Q()
        st = self.__dict__.setdefault("_astack", [])
        if st:
            self.device.alpha = st.pop()


def _rgb(ncs, color) -> list[int]:
    try:
        if color is None:
            return [0, 0, 0]
        if isinstance(color, (int, float)):
            v = [float(color)] * 3
        else:
            c = [float(x) for x in color]
            if len(c) == 1:
                v = c * 3
            elif len(c) == 3:
                v = c
            elif len(c) == 4:
                k = c[3]
                v = [(1 - c[0]) * (1 - k), (1 - c[1]) * (1 - k), (1 - c[2]) * (1 - k)]
            else:
                v = [0, 0, 0]
        return [int(round(max(0.0, min(1.0, x)) * 255)) for x in v]
    except Exception:
        return [0, 0, 0]


def font_name(raw: str) -> str:
    return _SUBSET.sub("", raw or "")


def extract(pdf_path: str, max_pages: int = 20) -> list[dict]:
    """One dict per page: {page, width, height (pt), runs, shapes}."""
    pages = []
    rsrc = PDFResourceManager()
    with open(pdf_path, "rb") as f:
        for n, page in enumerate(PDFPage.get_pages(f), start=1):
            if n > max_pages:
                break
            dev = _Device(rsrc)
            _Interp(rsrc, dev).process_page(page)
            lt = dev.get_result()
            W, H = float(lt.width), float(lt.height)
            x_off, y_off = float(lt.x0), float(lt.y0)
            pages.append(_page(n, W, H, x_off, y_off, dev.items))
    return pages


def _page(n, W, H, xo, yo, items) -> dict:
    def nb(x0, y0, x1, y1):
        return [
            round(min(1, max(0, (x0 - xo) / W)), 5),
            round(min(1, max(0, 1 - (y1 - yo) / H)), 5),
            round(min(1, max(0, (x1 - xo) / W)), 5),
            round(min(1, max(0, 1 - (y0 - yo) / H)), 5),
        ]

    runs, shapes = [], []
    cur = None

    def flush():
        nonlocal cur
        if cur and cur["text"].strip():
            chars = cur.pop("_chars")
            vis = [c for c in chars if c[0].strip()]
            x0 = min(c[1] for c in vis)
            x1 = max(c[2] for c in vis)
            y0 = min(c[3] for c in vis)
            y1 = max(c[4] for c in vis)
            lead = len(cur["text"]) - len(cur["text"].lstrip())
            trail = len(cur["text"].rstrip())
            chars = chars[lead:trail]
            cur["text"] = cur["text"].strip()
            cur["x0"], cur["y0"], cur["x1"], cur["y1"] = nb(x0, y0, x1, y1)
            cur["box"] = [cur["x0"], cur["y0"], cur["x1"], cur["y1"]]
            cur["x0pt"], cur["x1pt"] = round(x0 - xo, 3), round(x1 - xo, 3)
            cur["baseline"] = round(1 - (cur["baselinePt"] - yo) / H, 5)
            cur["baselinePt"] = round(cur["baselinePt"] - yo, 3)
            cur["chars"] = [[c[0], round(c[1] - xo, 2), round(c[2] - xo, 2)] for c in chars]
            cur["i"] = len(runs)
            cur.pop("_m")
            runs.append(cur)
        cur = None

    for o in items:
        if isinstance(o, LTChar):
            a, b, c, d, e, f = o.matrix
            fs = getattr(o, "l_fontsize", o.size)
            size = abs(fs) * math.hypot(c, d)
            base = f + getattr(o, "l_rise", 0) * d
            color = _rgb(o.ncs, o.graphicstate.ncolor)
            fname = font_name(o.fontname)
            rot = not (abs(b) < 1e-3 and abs(c) < 1e-3 and a > 0 and d > 0)
            m = (round(a, 4), round(b, 4), round(c, 4), round(d, 4))
            ch = o.get_text()
            if (
                cur is not None
                and cur["fontRaw"] == o.fontname
                and abs(cur["size"] - size) < 0.01
                and cur["color"] == color
                and cur["_m"] == m
                and (rot or abs(cur["baselinePt"] - base) < 0.02)
                and (rot or -0.5 * size < o.x0 - cur["_chars"][-1][2] < 0.6 * size)
            ):
                cur["text"] += ch
                cur["_chars"].append((ch, o.x0, o.x1, o.y0, o.y1))
                cur["seq1"] = o.l_seq
            else:
                flush()
                cur = {
                    "text": ch,
                    "font": fname,
                    "fontRaw": o.fontname,
                    "size": round(size, 3),
                    "baselinePt": base,
                    "color": color,
                    "alpha": round(getattr(o, "l_alpha", 1.0), 3),
                    "render": int(getattr(o, "l_render", 0) or 0),
                    "charspace": round(float(getattr(o, "l_charspace", 0) or 0), 4),
                    "rotated": rot,
                    "seq": o.l_seq,
                    "seq1": o.l_seq,
                    "_chars": [(ch, o.x0, o.x1, o.y0, o.y1)],
                    "_m": m,
                }
        else:
            flush()
            kind = None
            if isinstance(o, LTImage):
                kind, fill, color = "image", True, [128, 128, 128]
            elif isinstance(o, (LTRect, LTCurve)) and not isinstance(o, LTLine):
                fill = bool(o.fill)
                color = _rgb(None, o.non_stroking_color)
                kind = "rect" if isinstance(o, LTRect) else "path"
                if kind == "path" and fill:
                    pts = getattr(o, "pts", None) or []
                    area = 0.0
                    for i in range(len(pts)):
                        (xa, ya), (xb, yb) = pts[i], pts[(i + 1) % len(pts)]
                        area += xa * yb - xb * ya
                    bb = max(1e-6, (o.x1 - o.x0) * (o.y1 - o.y0))
                    if abs(area) / 2 >= 0.9 * bb:
                        kind = "rect"
            if kind:
                shapes.append(
                    {
                        "kind": kind,
                        "fill": fill,
                        "color": color,
                        "alpha": round(getattr(o, "l_alpha", 1.0), 3),
                        "box": nb(o.x0, o.y0, o.x1, o.y1),
                        "seq": o.l_seq,
                    }
                )
    flush()
    return {"page": n, "width": round(W, 3), "height": round(H, 3), "runs": runs, "shapes": shapes}

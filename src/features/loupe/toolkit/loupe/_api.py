"""The helpers the Examiner's own code imports (`import loupe`)."""
from __future__ import annotations

import json
import math
import os

import numpy as np
from PIL import Image

from . import _ctx, contract


def doc_path() -> str:
    """Path of the Document under examination."""
    return _ctx.doc()["file"]


def fmt() -> str:
    """'pdf' or 'image'."""
    return _ctx.doc()["format"]


def page_count() -> int:
    return len(_ctx.doc()["pages"])


def _check_page(n: int) -> int:
    n = int(n)
    if not 1 <= n <= page_count():
        raise ValueError(f"Page {n} is out of range: the Document has {page_count()} page(s).")
    return n


def page_image(n: int = 1) -> Image.Image:
    """Page n (1-based) as an RGB PIL image: the rendered page of a PDF, the pixels of an image Document."""
    n = _check_page(n)

    def load():
        d = _ctx.doc()
        a = d.get("analysis", {}).get(str(n))
        rel = a["path"] if (a and d["format"] == "image") else f"pages/p{n}.jpg"
        im = Image.open(os.path.join(_ctx.work(), rel))
        im.load()
        return im.convert("RGB")

    return _ctx.cached(("page", n), load).copy()


def page_array(n: int = 1) -> np.ndarray:
    """Page n as a uint8 array (h, w, 3), RGB."""
    return np.asarray(page_image(n))


def _page_data(n: int) -> dict:
    n = _check_page(n)

    def load():
        p = os.path.join(_ctx.work(), "runs", f"p{n}.json")
        if not os.path.exists(p):
            return {"page": n, "runs": [], "shapes": []}
        with open(p) as f:
            return json.load(f)

    return _ctx.cached(("runs", n), load)


def text_runs(n: int = 1) -> list[dict]:
    """Text runs of PDF page n in paint order. Each: text, font, size (pt),
    x0, y0, x1, y1 and box (0..1), baseline (0..1) and baselinePt, color
    [r, g, b], alpha, rotated, seq, chars [[char, x0pt, x1pt]...]. Empty for an image."""
    return _page_data(n)["runs"]


def shapes(n: int = 1) -> list[dict]:
    """Filled shapes and images of PDF page n in paint order: kind, fill, color, alpha, box, seq."""
    return _page_data(n)["shapes"]


def page_text(n: int = 1) -> str:
    """The text layer of page n, line by line, top to bottom."""
    runs = [r for r in text_runs(n) if not r["rotated"]]
    runs.sort(key=lambda r: (round(r["baselinePt"] / 3), r["x0"]))
    lines, cur, last = [], [], None
    for r in sorted(runs, key=lambda r: (-r["baselinePt"], r["x0"])):
        if last is not None and abs(r["baselinePt"] - last) > 2.5:
            lines.append("  ".join(x["text"] for x in sorted(cur, key=lambda x: x["x0"])))
            cur = []
        cur.append(r)
        last = r["baselinePt"]
    if cur:
        lines.append("  ".join(x["text"] for x in sorted(cur, key=lambda x: x["x0"])))
    return "\n".join(lines)


def pdf():
    """The Document as a pikepdf.Pdf (PDF only)."""
    if fmt() != "pdf":
        raise RuntimeError("The Document is an image, not a PDF.")
    import pikepdf

    return pikepdf.open(doc_path())


def to_px(box, n: int = 1) -> tuple[int, int, int, int]:
    """A 0..1 box as integer pixels (x0, y0, x1, y1) of page_image(n)."""
    im = page_image(n)
    W, H = im.size
    x0, y0, x1, y1 = box
    return (
        max(0, int(math.floor(x0 * W))),
        max(0, int(math.floor(y0 * H))),
        min(W, int(math.ceil(x1 * W))),
        min(H, int(math.ceil(y1 * H))),
    )


def to_box(px_rect, n: int = 1) -> list[float]:
    """A pixel rectangle (x0, y0, x1, y1) of page_image(n) as a 0..1 box."""
    W, H = page_image(n).size
    x0, y0, x1, y1 = px_rect
    return clean_box([x0 / W, y0 / H, x1 / W, y1 / H])


def clean_box(box):
    if box is None:
        return None
    x0, y0, x1, y1 = [min(1.0, max(0.0, float(v))) for v in box]
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    if x1 - x0 < 1e-4:
        x0, x1 = max(0.0, x0 - 1e-3), min(1.0, x1 + 1e-3)
    if y1 - y0 < 1e-4:
        y0, y1 = max(0.0, y0 - 1e-3), min(1.0, y1 + 1e-3)
    return [round(x0, 5), round(y0, 5), round(x1, 5), round(y1, 5)]


def measurement(metric, value, page, box=None, detail="", facts=None, layer=None, layer_kind=None, check=None) -> dict:
    """Builds one Measurement in the contract's shape, refusing anything it would refuse."""
    if metric not in contract.METRICS:
        raise ValueError(f"Unknown metric {metric!r}. Metrics: {', '.join(contract.METRICS)}")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("A Measurement's value must be a finite number.")
    page = int(page)
    if not 0 <= page <= 200:
        raise ValueError("page is 1-based, or 0 for the whole Document.")
    detail = " ".join(str(detail).split())[:400] or f"{metric} = {value:g}"
    m = {"metric": metric, "value": round(value, 4), "page": page, "box": clean_box(box), "detail": detail}
    if facts:
        out = {}
        for k, v in facts.items():
            if isinstance(v, bool):
                v = int(v)
            if isinstance(v, (int, float, np.integer, np.floating)):
                v = float(v)
                if not math.isfinite(v):
                    continue
                v = round(v, 4)
            else:
                v = str(v)[:200]
            out[str(k)[:40]] = v
        if out:
            m["facts"] = out
    if layer:
        if layer_kind not in contract.LAYER_KINDS:
            raise ValueError("layer_kind is 'heatmap', 'marks' or 'compare'.")
        m["layer"] = layer
        m["layerKind"] = layer_kind
    if check:
        if check not in contract.CHECKS:
            raise ValueError(f"Unknown check {check!r}.")
        m["check"] = check
    return m


def report(metric, value, page, box=None, detail="", facts=None, layer=None, layer_kind=None) -> dict:
    """Appends one Measurement to $LOUPE_OUT/reports.jsonl. `metric` must be one
    of the fixed Metrics; `page` is 1-based (0 = whole Document); `box` is
    [x0, y0, x1, y1] in 0..1, origin top-left."""
    m = measurement(metric, value, page, box, detail, facts, layer, layer_kind)
    with open(os.path.join(_ctx.out_dir(), "reports.jsonl"), "a") as f:
        f.write(json.dumps(m) + "\n")
    return m

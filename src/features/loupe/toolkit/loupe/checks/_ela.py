from __future__ import annotations

import cv2
import numpy as np

from .. import _ctx, _pix

EPS = 0.3
FLOOR = 0.5
TRY = (95, 85, 70)


def _resave(y: np.ndarray, q: int) -> np.ndarray:
    ok, enc = cv2.imencode(".jpg", np.clip(y + 0.5, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, int(q)])
    return np.abs(y - cv2.imdecode(enc, cv2.IMREAD_GRAYSCALE).astype(np.float32))


def native(n: int):
    """For a file that is not a JPEG now (a PNG, a screenshot): the JPEG quality
    its pixels still sit on, if they were a JPEG before. None otherwise."""

    def make():
        if _pix.image(n)["jpeg"]:
            return None
        y = _pix.image(n)["y"]
        h, w = (min(y.shape[0], 768) // 8) * 8, (min(y.shape[1], 768) // 8) * 8
        crop = y[:h, :w]
        def level(q):  # over the blocks that carry something: blank paper sits on every grid
            b = _pix.bmean(_resave(crop, q), 8)
            return float(np.mean(b[busy])) if busy.any() else 0.0

        g = _pix.bmean(_pix.blocks(n)["grad"][:h, :w], 8)
        busy = g >= max(1.0, float(np.percentile(g, 80)))
        errs = {q: level(q) for q in range(57, 98)}
        # A grid shows as a dip: far less error at one quality than three steps either side of it.
        dips = {q: errs[q] / max(1e-6, min(errs[q - 3], errs[q + 3])) for q in range(60, 95)}
        q = min(dips, key=dips.get)
        return q if dips[q] < 0.6 and min(errs[q - 3], errs[q + 3]) > 0.3 else None

    return _ctx.cached(("native", n), make)


def deviation(n: int, q: int, ink: bool):
    def make():
        e = _resave(_pix.image(n)["y"], q)
        dev, page = _pix.paper_dev(n, e, EPS)
        if ink:  # where the page sits on a JPEG grid, print that does not is as telling as paper that does not
            band = _pix.structure(n)["edgeband"]
            lv = _pix.local(e, band, need=30)
            ok = ~np.isnan(lv)
            d2 = _pix.class_dev(np.nan_to_num(lv), [ok], EPS, min_blocks=40)
            dev = np.where(np.isnan(d2), dev, np.where(np.isnan(dev), d2, np.where(np.abs(d2) > np.abs(dev), d2, dev)))
        return dev, page

    return _ctx.cached(("ela_dev", n, q, ink), make)


def run(pages, box=None, kind=None, editors=None):
    out = []
    for n in pages:
        nat = native(n)
        best = None
        for q in ((nat,) if nat else TRY):
            dev, page = deviation(n, q, bool(nat))
            if box:
                hit = _pix.in_box(dev, box, _pix.image(n)["y"].shape, _pix.G)
                top = hit[0] if hit else 0.0
            else:
                top = _pix.regions(dev, FLOOR, 4)[0][0][0]
            if best is None or top > best[0]:
                best = (top, q, dev, page)
        _, q, dev, page = best
        if not nat and page < 0.2:
            out.append(_pix.measurement("image.ela_ratio", 1.0, n, box, f"The paper carries no grain (error level {page:.2f}) and the pixels sit on no earlier JPEG grid, so a re-save changes every part alike.", {"quality": q, "native": 0}))
            continue

        def say(v, sign, cnt, q=q, page=page):
            pre = f"The page's pixels sit on a JPEG grid of quality {q}; this region does not: re-saved at that quality it changes" if nat else f"Re-saved at quality {q}, this region changes"
            return f"{pre} {v:.1f}x {'more' if sign > 0 else 'less'} than the same kind of area across the page (page level {page:.2f}; {cnt} samples)."

        out += _pix.ratio_check("ela", "image.ela_ratio", n, dev, FLOOR, box, say, extra={"quality": q, "native": 1 if nat else 0}, b=_pix.G, min_blocks=4)
    return out

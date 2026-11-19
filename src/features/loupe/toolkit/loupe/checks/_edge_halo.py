from __future__ import annotations

import cv2
import numpy as np

from .. import _ctx, _pix

FLOOR = 0.3


def deviation(n: int):
    """The halo is the soft skirt between ink and paper. Its width, in pixels, is
    the stroke's contrast over the steepest slope at its edge; a scanner, a lens
    and a font renderer each leave their own. Returned as log(width / page's)."""

    def make():
        y = _pix.image(n)["y"]
        bl = _pix.blocks(n)
        g = bl["grad"] * 4
        paper = cv2.dilate(cv2.GaussianBlur(y, (0, 0), 0.8), np.ones((15, 15), np.uint8))
        depth = np.maximum(paper - y, 0)
        k = np.ones((17, 17), np.uint8)
        peak = cv2.dilate(g, k)[_pix.G // 2 :: _pix.G, _pix.G // 2 :: _pix.G]
        contrast = cv2.dilate(depth, k)[_pix.G // 2 :: _pix.G, _pix.G // 2 :: _pix.G]
        inkn = _pix.local(bl["edge"].astype(np.float32), np.ones_like(bl["edge"]), need=1)
        ok = (contrast > 60) & (inkn > 0.06)
        width = contrast / np.maximum(peak, 1)
        dev = _pix.class_dev(width, [ok], 0.05, min_blocks=40)
        return dev, float(np.median(width[ok])) if ok.sum() else 0.0

    return _ctx.cached(("halo", n), make)


def run(pages, box=None, kind=None, editors=None):
    out = []
    for n in pages:
        dev, page = deviation(n)

        def say(v, sign, cnt, page=page):
            return f"The halo round the characters here is {v:.2f}x {'wider' if sign > 0 else 'tighter'} than round characters across the page (page halo {page:.2f} px; {cnt} samples): these edges were not made the way the page's were."

        out += _pix.ratio_check("edge_halo", "image.edge_halo", n, dev, FLOOR, box, say, scale=1.0, extra={"pageHalo": page}, b=_pix.G, min_blocks=6)
    return out

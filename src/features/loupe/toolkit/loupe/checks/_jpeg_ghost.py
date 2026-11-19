from __future__ import annotations

import cv2
import numpy as np

from .. import _ctx, _layers, _pix
from .._api import measurement
from . import _ela, _noise

FLOOR = 0.12
FULL = 0.5
QS = (50, 60, 70, 80, 90)
MIN_GRAIN = 0.8


def distance(n: int):
    """How far the paper's error-level curve across re-save qualities is, at each
    place, from the curve of the same kind of paper on the page (0..1). Grain
    carries the history: a page without grain has none to read."""

    def make():
        if _noise.grain(n) < MIN_GRAIN:
            return None
        y = _pix.image(n)["y"]
        st = _pix.structure(n)
        lv = np.stack([_pix.local(_ela._resave(y, q), st["flat"]) for q in QS])
        ok = ~np.isnan(lv[0])
        prof = lv / (np.max(np.nan_to_num(lv), axis=0) + 0.3)
        near = _pix.grid(st["nearink"])
        out = np.full(ok.shape, np.nan, np.float32)
        for c in (ok & ~near, ok & near):
            if c.sum() < 40:
                continue
            ref = np.median(prof[:, c], axis=1)
            out[c] = np.abs(prof[:, c] - ref[:, None]).max(axis=0)
        return out

    return _ctx.cached(("ghost", n), make)


def run(pages, box=None, kind=None, editors=None):
    out = []
    for n in pages:
        dist = distance(n)
        shape = _pix.image(n)["y"].shape
        if dist is None:
            out.append(measurement("image.jpeg_ghost", 0, n, box, "The page has no grain, so its paper keeps no compression history to compare."))
            continue
        if box:
            hit = _pix.in_box(dist, box, shape, _pix.G)
            v = min(1.0, hit[0] / FULL) if hit else 0.0
            out.append(measurement("image.jpeg_ghost", v, n, box, f"The compression history of this region differs from the page's by {v:.2f} on a 0 to 1 scale ({hit[2] if hit else 0} samples of paper)."))
            continue
        regs, sm = _pix.regions(dist, FLOOR, 6)
        hot = [r for r in regs if r[3] > 0]
        layer = None
        if hot:
            layer = _layers.heat_layer(f"jpeg_ghost-p{n}", _pix.heat_map(sm, FLOOR, FULL, hot), n)
        for v, _, bb, cnt in regs:
            score = min(1.0, v / FULL)
            out.append(measurement("image.jpeg_ghost", score, n, _pix.nbox(bb, shape, _pix.G),
                                   f"Across re-saves at qualities 50 to 90 this region's error curve departs from the page's by {score:.2f} on a 0 to 1 scale ({cnt} samples): it was compressed differently before." if cnt else f"No region's compression history stands out; the largest departure is {score:.2f}.",
                                   {"samples": cnt}, layer if cnt else None, "heatmap" if cnt and layer else None))
    return out

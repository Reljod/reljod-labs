from __future__ import annotations

import cv2
import numpy as np

from .. import _ctx, _pix

EPS = 0.3
FLOOR = 0.5
MIN_GRAIN = 0.5


def residual(n: int) -> np.ndarray:
    """|pixel - its smoothed neighbourhood|: the grain, where there is no print."""
    return _ctx.cached(("residual", n), lambda: np.abs(_pix.image(n)["y"] - cv2.GaussianBlur(_pix.image(n)["y"], (0, 0), 1.5)) * 1.2533)


def deviation(n: int):
    return _ctx.cached(("noise_dev", n), lambda: _pix.paper_dev(n, residual(n), EPS))


def grain(n: int) -> float:
    return deviation(n)[1]


def run(pages, box=None, kind=None, editors=None):
    out = []
    for n in pages:
        dev, page = deviation(n)
        if page < MIN_GRAIN:
            out.append(_pix.measurement("image.noise_ratio", 1.0, n, box, f"The page has no grain (noise {page:.2f} grey levels on open paper): it is digital, so there is no noise to compare.", {"pageGrain": page}))
            continue

        def say(v, sign, cnt, page=page):
            return f"The paper here is {v:.1f}x {'noisier' if sign > 0 else 'quieter'} than the same kind of paper across the page (page grain {page:.2f} grey levels; {cnt} samples)."

        out += _pix.ratio_check("noise", "image.noise_ratio", n, dev, FLOOR, box, say, extra={"pageGrain": page}, b=_pix.G, min_blocks=4)
    return out

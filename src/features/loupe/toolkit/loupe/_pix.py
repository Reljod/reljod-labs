"""What the pixel Checks share: the analysis image, 16 px blocks, their class
(paper or ink, so like is compared with like), and region finding."""
from __future__ import annotations

import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

from . import _api, _ctx, _layers
from ._api import measurement

B = 16
QUALITIES = (50, 55, 60, 65, 70, 75, 80, 85, 90, 95)


def image(n: int) -> dict:
    """The pixels the Checks measure: the original pixels of an image Document,
    the embedded scan of a raster PDF page, else the rendered page."""

    def make():
        d = _ctx.doc()
        a = d.get("analysis", {}).get(str(n))
        rel = a["path"] if a else f"pages/p{n}.jpg"
        im = Image.open(os.path.join(_ctx.work(), rel))
        rgb = np.asarray(im.convert("RGB"))
        y = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
        return {"rgb": rgb, "y": y, "jpeg": bool(a["jpeg"]) if a else True}

    return _ctx.cached(("pix", n), make)


def bmean(a: np.ndarray, b: int = B) -> np.ndarray:
    h, w = (a.shape[0] // b) * b, (a.shape[1] // b) * b
    return a[:h, :w].reshape(h // b, b, w // b, b).mean(axis=(1, 3))


def blocks(n: int) -> dict:
    """Per-block structure: `ink` (share of pixels on or next to an edge), `paper` and `text` classes."""

    def make():
        y = image(n)["y"]
        g = cv2.GaussianBlur(y, (0, 0), 1.0)
        grad = np.hypot(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1)) / 4
        edge = grad > 14
        near = cv2.dilate(edge.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        ink = bmean(near.astype(np.float32))
        return {"grad": grad, "edge": edge, "near": near, "ink": ink, "paper": ink < 0.02, "text": ink >= 0.10, "gmean": bmean(grad)}

    return _ctx.cached(("blocks", n), make)


def stack(n: int) -> np.ndarray:
    """Error level per block at each quality in QUALITIES: mean |Y - Y re-saved at q|."""

    def make():
        y = image(n)["y"]
        y8 = np.clip(y + 0.5, 0, 255).astype(np.uint8)
        out = []
        for q in QUALITIES:
            ok, enc = cv2.imencode(".jpg", y8, [cv2.IMWRITE_JPEG_QUALITY, q])
            out.append(bmean(np.abs(y - cv2.imdecode(enc, cv2.IMREAD_GRAYSCALE).astype(np.float32))))
        return np.stack(out)

    return _ctx.cached(("stack", n), make)


def class_dev(level: np.ndarray, classes: list[np.ndarray], eps: float, valid=None, min_blocks: int = 24) -> np.ndarray:
    """log(level / the median level of the block's own class); NaN where a block has no class."""
    dev = np.full(level.shape, np.nan, np.float32)
    for c in classes:
        m = c if valid is None else (c & valid)
        if m.sum() < min_blocks:
            continue
        ref = float(np.median(level[m]))
        dev[m] = np.log((level[m] + eps) / (ref + eps))
    return dev


def smooth(dev: np.ndarray) -> np.ndarray:
    v = np.nan_to_num(dev)
    ok = (~np.isnan(dev)).astype(np.float32)
    k = np.ones((3, 3), np.float32)
    num = cv2.filter2D(v, -1, k, borderType=cv2.BORDER_CONSTANT)
    den = cv2.filter2D(ok, -1, k, borderType=cv2.BORDER_CONSTANT)
    out = np.where(den >= 3, num / np.maximum(den, 1), 0)
    return out.astype(np.float32)


def regions(dev: np.ndarray, floor: float, min_blocks: int = 4, top: int = 6):
    """Connected groups of blocks whose smoothed |dev| passes `floor`:
    [(value = the group's peak smoothed |dev|, sign, (bx0, by0, bx1, by1), n)], strongest first.
    With none, the single strongest 3x3 neighbourhood."""
    sm = smooth(dev)
    lab, count = ndimage.label(np.abs(sm) > floor, structure=np.ones((3, 3)))
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        m = (lab[sl] == i) & ~np.isnan(dev[sl])
        if m.sum() < min_blocks:
            continue
        part = np.where(lab[sl] == i, sm[sl], 0)
        iy, ix = np.unravel_index(int(np.argmax(np.abs(part))), part.shape)
        out.append((float(abs(part[iy, ix])), 1 if part[iy, ix] >= 0 else -1, (sl[1].start, sl[0].start, sl[1].stop, sl[0].stop), int(m.sum())))
    out.sort(key=lambda r: -r[0])
    if not out:
        # Nothing forms a region. The strongest spot is reported, at no more than the region floor: a spot is not a region.
        iy, ix = np.unravel_index(int(np.argmax(np.abs(sm))), sm.shape)
        out = [(float(min(abs(sm[iy, ix]), floor)), 1 if sm[iy, ix] >= 0 else -1, (max(0, ix - 1), max(0, iy - 1), min(sm.shape[1], ix + 2), min(sm.shape[0], iy + 2)), 0)]
    return out[:top], sm


def nbox(bb, shape, b: int = B):
    H, W = shape
    return [bb[0] * b / W, bb[1] * b / H, min(1.0, bb[2] * b / W), min(1.0, bb[3] * b / H)]


def in_box(dev: np.ndarray, box, shape, b: int = B):
    """Peak smoothed |dev| and its sign over the blocks a 0..1 box touches (None when no block there has a class)."""
    H, W = shape
    x0, y0 = int(box[0] * W // b), int(box[1] * H // b)
    x1, y1 = int(np.ceil(box[2] * W / b)), int(np.ceil(box[3] * H / b))
    sub = dev[y0 : max(y1, y0 + 1), x0 : max(x1, x0 + 1)]
    cnt = int((~np.isnan(sub)).sum())
    if cnt == 0:
        return None
    part = smooth(dev)[y0 : max(y1, y0 + 1), x0 : max(x1, x0 + 1)]
    iy, ix = np.unravel_index(int(np.argmax(np.abs(part))), part.shape)
    return float(abs(part[iy, ix])), (1 if part[iy, ix] >= 0 else -1), cnt


def ratio_check(check: str, metric: str, n: int, dev: np.ndarray, floor: float, box, say, scale: float = 1.6, extra=None, b: int = B, min_blocks: int = 4):
    """Turns a per-block log-ratio map into ratio Measurements (value = max(r, 1/r)) and a heat layer."""
    shape = image(n)["y"].shape
    out = []
    if box:
        hit = in_box(dev, box, shape, b)
        if hit is None:
            return [measurement(metric, 1.0, n, box, "No comparable blocks in this region: nothing to measure against the page.", {"blocks": 0})]
        v, sign, cnt = hit
        return [measurement(metric, float(np.exp(v)), n, box, say(float(np.exp(v)), sign, cnt), {"direction": "above" if sign > 0 else "below", "blocks": cnt, **(extra or {})})]
    regs, sm = regions(dev, floor, min_blocks)
    hot = [r for r in regs if r[3] > 0]
    layer = None
    if hot:
        layer = _layers.heat_layer(f"{check}-p{n}", heat_map(np.abs(sm), floor, scale, hot), n)
    for v, sign, bb, cnt in regs:
        out.append(measurement(metric, float(np.exp(v)), n, nbox(bb, shape, b), say(float(np.exp(v)), sign, cnt), {"direction": "above" if sign > 0 else "below", "blocks": cnt, **(extra or {})},
                               layer if cnt else None, "heatmap" if cnt and layer else None))
    return out


G = 8  # the grid dense statistics are sampled on


BINS = ((2, 3), (3, 4), (4, 6), (6, 12), (12, 1e9))  # px from the nearest print


def structure(n: int) -> dict:
    """`dist`: pixels to the nearest print (any edge); `flat`: 4 px or more from it;
    `nearink`: within 12 px; `edgeband`: on or beside a strong edge."""

    def make():
        bl = blocks(n)
        dist = cv2.distanceTransform((bl["grad"] <= 9).astype(np.uint8), cv2.DIST_L2, 3)
        return {"dist": dist, "flat": dist >= 4, "nearink": dist < 12, "edgeband": cv2.dilate(bl["edge"].astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)}

    return _ctx.cached(("structure", n), make)


def local(values: np.ndarray, mask: np.ndarray, win: int = 17, need: int = 60, counts: bool = False):
    """Mean of `values` over the masked pixels of a win x win window, sampled every G px; NaN where fewer than `need` pixels."""
    m = mask.astype(np.float32)
    num = cv2.boxFilter(values * m, -1, (win, win), normalize=False)[G // 2 :: G, G // 2 :: G]
    den = cv2.boxFilter(m, -1, (win, win), normalize=False)[G // 2 :: G, G // 2 :: G]
    out = np.where(den >= need, num / np.maximum(den, 1), np.nan).astype(np.float32)
    return (out, den) if counts else out


def grid(mask: np.ndarray) -> np.ndarray:
    return mask[G // 2 :: G, G // 2 :: G]


def paper_dev(n: int, values: np.ndarray, eps: float, win: int = 9) -> tuple[np.ndarray, float]:
    """A per-pixel value measured on paper against the page, like with like: paper
    2 px from print is compared with paper 2 px from print elsewhere, open paper
    with open paper. Returns log(local / page) on the G grid, and the page level on open paper."""
    dist = structure(n)["dist"]
    num = den = None
    page = 0.0
    open_dev = None
    for lo, hi in BINS:
        m = (dist >= lo) & (dist < hi)
        lv, cnt = local(values, m, win, need=3, counts=True)
        ok = ~np.isnan(lv)
        if ok.sum() < 40:
            continue
        ref = float(np.median(lv[ok]))
        d = np.where(ok, np.log((np.nan_to_num(lv) + eps) / (ref + eps)), 0.0)
        if lo >= 12:
            page = ref
            open_dev = np.where(ok & (cnt >= 16), d, 0.0)
        d = d * cnt * ok
        num = d if num is None else num + d
        den = cnt * ok if den is None else den + cnt * ok
    if num is None:
        return np.full(grid(dist).shape, np.nan, np.float32), 0.0
    dev = np.where(den >= 16, num / np.maximum(den, 1), np.nan).astype(np.float32)
    # Paper beside print is noisier wherever the print is denser, so "more than the page" is only believed on open paper.
    cap = open_dev if open_dev is not None else 0.0
    dev = np.where(dev > 0, np.minimum(dev, np.maximum(cap, 0.0)), dev)
    return dev.astype(np.float32), page


def heat_map(strength: np.ndarray, floor: float, full: float, hot) -> np.ndarray:
    """0..1 intensity for a heat layer: only the regions found, filled across the print they surround."""
    heat = np.clip((strength - 0.5 * floor) / (full - 0.5 * floor), 0, 1).astype(np.float32)
    heat = cv2.morphologyEx(heat, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    keep = np.zeros_like(heat)
    for _, _, bb, _ in hot:
        keep[bb[1] : bb[3], bb[0] : bb[2]] = 1
    return np.clip(heat * 1.25, 0, 1) * cv2.dilate(keep, np.ones((5, 5), np.uint8))

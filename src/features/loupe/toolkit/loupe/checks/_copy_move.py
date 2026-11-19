from __future__ import annotations

import cv2
import numpy as np

from .. import _layers, _pix
from .._api import measurement
from . import _noise

WIN = 7
MIN_GRAIN = 0.8
SAME = 0.6


def _pairs(n: int, grain: float):
    """Keypoint pairs that look alike AND carry the same grain. Two prints of a
    character differ by the page's grain twice over; a copy differs only by what
    the last save did to it. `rel` is that difference over the page's."""
    y = _pix.image(n)["y"]
    H, W = y.shape
    y8 = np.clip(y, 0, 255).astype(np.uint8)
    sift = cv2.SIFT_create(nfeatures=6000, contrastThreshold=0.03)
    kps, des = sift.detectAndCompute(y8, None)
    if des is None or len(kps) < 4:
        return [], 0
    pts = np.array([k.pt for k in kps], np.float32)
    # The band a re-save keeps: finer grain is rewritten by every JPEG save, coarser is shading.
    res = cv2.GaussianBlur(y, (0, 0), 1.0) - cv2.GaussianBlur(y, (0, 0), 3.0)
    flat = _pix.structure(n)["dist"] >= 8
    grain = 1.4826 * float(np.median(np.abs(res[flat]))) if flat.sum() > 500 else grain
    matches = cv2.BFMatcher(cv2.NORM_L2).knnMatch(des, des, k=5)
    seen, good = set(), []
    for ms in matches:
        for m in ms[1:]:
            if m.distance > 180:
                break
            a, b = pts[m.queryIdx], pts[m.trainIdx]
            dx, dy = int(round(b[0] - a[0])), int(round(b[1] - a[1]))
            if abs(dx) + abs(dy) < 10:
                continue
            ax, ay = int(round(a[0])), int(round(a[1]))
            key = (ax // 3, ay // 3, dx, dy)
            if key in seen or ((ax + dx) // 3, (ay + dy) // 3, -dx, -dy) in seen:
                continue
            seen.add(key)
            x0, y0, x1, y1 = ax - WIN, ay - WIN, ax + WIN, ay + WIN
            if x0 < 0 or y0 < 0 or x1 > W or y1 > H or x0 + dx < 0 or y0 + dy < 0 or x1 + dx > W or y1 + dy > H:
                continue
            diff = res[y0:y1, x0:x1] - res[y0 + dy : y1 + dy, x0 + dx : x1 + dx]
            rel = float(np.sqrt((diff * diff).mean())) / (1.4142 * grain)
            if rel < SAME:
                good.append((ax, ay, dx, dy, rel))
    return good, len(kps)


def run(pages, box=None, kind=None, editors=None):
    out = []
    for n in pages:
        y = _pix.image(n)["y"]
        H, W = y.shape
        grain = _noise.grain(n)
        if grain < MIN_GRAIN:
            out.append(measurement("image.copy_move", 0, n, box, f"The page has no grain to tell a copy from repeated print (noise {grain:.2f} grey levels), so nothing can be measured.", {"grain": grain}))
            continue
        good, nk = _pairs(n, grain)
        clusters: dict = {}
        for ax, ay, dx, dy, _ in good:
            key = next((k for k in clusters if abs(k[0] - dx) <= 1 and abs(k[1] - dy) <= 1), (dx, dy))
            clusters.setdefault(key, []).append((ax, ay))
        found = []
        for (dx, dy), pts in clusters.items():
            if len(pts) < 2:
                continue
            mask = np.zeros((H, W), np.uint8)
            for ax, ay in pts:
                mask[ay - WIN : ay + WIN, ax - WIN : ax + WIN] = 1
            pct = 100.0 * float(mask.sum()) / (H * W)
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            a = [min(xs) - WIN, min(ys) - WIN, max(xs) + WIN, max(ys) + WIN]
            b = [a[0] + dx, a[1] + dy, a[2] + dx, a[3] + dy]
            found.append((pct, a, b, len(pts), dx, dy))
        found.sort(key=lambda f: -f[0])
        if box:
            bx = [box[0] * W, box[1] * H, box[2] * W, box[3] * H]
            found = [f for f in found if any(min(r[2], bx[2]) > max(r[0], bx[0]) and min(r[3], bx[3]) > max(r[1], bx[1]) for r in (f[1], f[2]))]
        if not found:
            out.append(measurement("image.copy_move", 0, n, box, f"No area is a pixel-level copy of another: {nk} keypoints compared, none shares its paper grain with a look-alike.", {"keypoints": nk, "grain": grain}))
            continue
        nb = lambda r: [max(0, r[0] / W), max(0, r[1] / H), min(1, r[2] / W), min(1, r[3] / H)]  # noqa: E731
        boxes = [nb(r) for f in found[:3] for r in (f[1], f[2])]
        layer = _layers.mark_layer(f"copy_move-p{n}" + ("-box" if box else ""), n, boxes, ["copy" if i % 2 else "same pixels" for i in range(len(boxes))])
        for pct, a, b, cnt, dx, dy in found[:3]:
            for here, there in ((a, b), (b, a)):
                out.append(measurement("image.copy_move", pct, n, nb(here),
                                       f"{pct:.3f}% of the page here carries the same pixels, grain included, as an area {abs(dx)} px across and {abs(dy)} px down from it ({cnt} matching points). Print repeats; grain does not.",
                                       {"points": cnt, "dx": dx, "dy": dy, "twin": ",".join(f"{v:.4f}" for v in nb(there))}, layer, "marks"))
    return out

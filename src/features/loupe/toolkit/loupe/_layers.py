"""Evidence layers: transparent PNGs with the page's aspect ratio, drawn to be
laid over the page image at 100% size. House palette (Colonnade)."""
from __future__ import annotations

import base64
import io
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import _ctx

INK = (20, 33, 61)
VERMILION = (178, 58, 43)  # seal red
AMBER = (217, 168, 78)  # brass
BLUE = (29, 78, 137)
PAPER = (255, 255, 255)
MARBLE = (245, 241, 232)
LAYER_WIDTH = 1000
MAX_BYTES = 150_000


def _page_size(page: int) -> tuple[int, int]:
    for p in _ctx.doc()["pages"]:
        if p["page"] == page:
            return p["width"], p["height"]
    raise ValueError(f"No page {page}.")


def layer_size(page: int) -> tuple[int, int]:
    w, h = _page_size(page)
    return LAYER_WIDTH, max(1, int(round(LAYER_WIDTH * h / w)))


def _mono(size: int) -> ImageFont.FreeTypeFont:
    from ._font import MONO_BOLD_B64

    return ImageFont.truetype(io.BytesIO(base64.b64decode("".join(MONO_BOLD_B64))), size)


def _sans(size: int):
    try:
        return ImageFont.load_default(size)
    except Exception:
        return _mono(size)


def save_layer(name: str, image) -> str:
    """Writes an RGBA array or PIL image as `<name>.png` in $LOUPE_OUT; returns the file name."""
    if not isinstance(image, Image.Image):
        arr = np.asarray(image)
        if arr.ndim != 3 or arr.shape[2] != 4:
            raise ValueError("save_layer needs an RGBA array (h, w, 4) or a PIL image.")
        image = Image.fromarray(arr.astype(np.uint8), "RGBA")
    image = image.convert("RGBA")
    safe = "".join(c if c.isalnum() or c in "._-" else "-" for c in name)
    if safe.endswith(".png"):
        safe = safe[:-4]
    fname = f"{safe}.png"
    path = os.path.join(_ctx.out_dir(), fname)
    image.save(path, "PNG", optimize=True)
    if os.path.getsize(path) > MAX_BYTES:
        for colors in (128, 48):
            image.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(
                path, "PNG", optimize=True
            )
            if os.path.getsize(path) <= MAX_BYTES:
                break
    return fname


def _px(box, W, H):
    x0, y0, x1, y1 = box
    return (int(round(x0 * W)), int(round(y0 * H)), int(round(x1 * W)), int(round(y1 * H)))


def heat_layer(name: str, intensity, page: int, boxes=None) -> str:
    """Colourises a 0..1 map (any resolution, covering the whole page) with the
    house ramp: transparent where nothing is unusual, amber to vermilion with
    rising opacity, a 2px ink contour round each hot region (or round `boxes`)."""
    W, H = layer_size(page)
    a = np.nan_to_num(np.asarray(intensity, dtype=np.float32), nan=0.0)
    a = np.clip(a, 0, 1)
    a = cv2.resize(a, (W, H), interpolation=cv2.INTER_CUBIC if min(a.shape) > 3 else cv2.INTER_LINEAR)
    a = np.clip(cv2.GaussianBlur(a, (0, 0), W * 0.004), 0, 1)
    t = np.clip((a - 0.10) / 0.90, 0, 1)
    s = t * t * (3 - 2 * t)
    rgb = np.empty((H, W, 3), np.float32)
    for i in range(3):
        rgb[..., i] = AMBER[i] + (VERMILION[i] - AMBER[i]) * np.clip(t * 1.25, 0, 1)
    alpha = 0.75 * np.clip(s * 1.6, 0, 1)
    line = np.zeros((H, W), np.uint8)
    if boxes:
        for b in boxes:
            x0, y0, x1, y1 = _px(b, W, H)
            cv2.rectangle(line, (x0 - 3, y0 - 3), (x1 + 3, y1 + 3), 255, 2, cv2.LINE_AA)
    else:
        mask = (a > 0.35).astype(np.uint8)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        contours = [c for c in contours if cv2.contourArea(c) >= 40]
        cv2.drawContours(line, contours, -1, 255, 2, cv2.LINE_AA)
    la = line.astype(np.float32) / 255 * 0.92
    out = np.zeros((H, W, 4), np.float32)
    for i in range(3):
        out[..., i] = rgb[..., i] * (1 - la) + INK[i] * la
    out[..., 3] = np.maximum(alpha, la) * 255
    out[..., 3][out[..., 3] < 3] = 0
    out[out[..., 3] == 0] = 0
    return save_layer(name, out.round().astype(np.uint8))


def _tag(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, W: int, color=VERMILION):
    font = _sans(13)
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    w, h = r - l + 10, 18
    x = max(0, min(W - w, x))
    y = max(0, y - h)
    draw.rectangle((x, y, x + w, y + h), fill=color + (255,))
    draw.text((x + 5, y + (h - (b - t)) // 2 - t), text, font=font, fill=PAPER + (255,))


def mark_layer(name: str, page: int, boxes, labels=None, color=VERMILION) -> str:
    """Outlines each box (0..1) in 2px seal red with a light hatch, and an optional small tag."""
    W, H = layer_size(page)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hatch = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hatch)
    d = ImageDraw.Draw(im)
    for i, b in enumerate(boxes):
        x0, y0, x1, y1 = _px(b, W, H)
        x0, y0, x1, y1 = x0 - 3, y0 - 3, x1 + 3, y1 + 3
        tile = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
        td = ImageDraw.Draw(tile)
        for k in range(-tile.height, tile.width, 6):
            td.line((k, tile.height, k + tile.height, 0), fill=color + (70,), width=1)
        hatch.alpha_composite(tile, (max(0, x0), max(0, y0)))
        hd.rectangle((x0, y0, x1, y1), outline=color + (255,), width=2)
    im.alpha_composite(hatch)
    d = ImageDraw.Draw(im)
    if labels:
        for b, lab in zip(boxes, labels):
            if lab:
                x0, y0, _, _ = _px(b, W, H)
                _tag(d, x0 - 3, y0 - 3, str(lab)[:28], W, color)
    return save_layer(name, im)


def compare_layer(name: str, page: int, box, left_label: str, left_value, right_label: str, right_value) -> str:
    """A paper card beside `box` with two figures side by side (printed against
    recomputed). The figure on the right, and the difference when both are
    numbers, are in vermilion."""
    W, H = layer_size(page)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = _px(box, W, H)
    d.rectangle((x0 - 4, y0 - 4, x1 + 4, y1 + 4), outline=VERMILION + (255,), width=2)

    def fmt(v):
        return f"{v:,.2f}" if isinstance(v, (int, float)) else str(v)

    lv, rv = fmt(left_value)[:22], fmt(right_value)[:22]
    diff = None
    if isinstance(left_value, (int, float)) and isinstance(right_value, (int, float)):
        diff = f"off by {abs(left_value - right_value):,.2f}"
    mono, small = _mono(19), _sans(11)
    lw = max(d.textlength(lv, font=mono), d.textlength(left_label.upper()[:24], font=small))
    rw = max(d.textlength(rv, font=mono), d.textlength(right_label.upper()[:24], font=small))
    pad, gap = 12, 26
    cw = int(pad + lw + gap + rw + pad)
    ch = 58 + (20 if diff else 0)
    cx = min(max(8, x1 - cw), W - cw - 10)
    cy = y1 + 12
    if cy + ch + 8 > H:
        cy = max(6, y0 - ch - 14)
    d.rectangle((cx + 5, cy + 5, cx + cw + 5, cy + ch + 5), fill=INK + (255,))
    d.rectangle((cx, cy, cx + cw, cy + ch), fill=PAPER + (255,), outline=INK + (255,), width=2)
    d.text((cx + pad, cy + 9), left_label.upper()[:24], font=small, fill=INK + (190,))
    d.text((cx + pad, cy + 26), lv, font=mono, fill=INK + (255,))
    rx = cx + pad + lw + gap
    d.line((rx - gap / 2, cy + 10, rx - gap / 2, cy + 50), fill=INK + (60,), width=1)
    d.text((rx, cy + 9), right_label.upper()[:24], font=small, fill=INK + (190,))
    d.text((rx, cy + 26), rv, font=mono, fill=VERMILION + (255,))
    if diff:
        d.line((cx + 2, cy + 56, cx + cw - 2, cy + 56), fill=INK + (255,), width=1)
        d.text((cx + pad, cy + 60), diff, font=_sans(12), fill=VERMILION + (255,))
    return save_layer(name, im)

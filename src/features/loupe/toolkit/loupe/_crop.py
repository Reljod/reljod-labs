from __future__ import annotations

import os

from PIL import Image

from . import _api


def crop(page: int, box, out: str, longest: int = 1100) -> dict:
    """The page, or a region of it, with its longest side scaled to `longest`, JPEG q85."""
    im = _api.page_image(page)
    if box:
        x0, y0, x1, y1 = _api.to_px(box, page)
        if x1 - x0 < 2 or y1 - y0 < 2:
            raise ValueError("The box is empty on this page.")
        im = im.crop((x0, y0, x1, y1))
    longest = max(64, min(4000, int(longest)))
    s = longest / max(im.size)
    size = (max(1, round(im.width * s)), max(1, round(im.height * s)))
    im = im.resize(size, Image.LANCZOS if s < 1 else Image.BICUBIC)
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    im.save(out, "JPEG", quality=85)
    return {"file": out, "width": im.width, "height": im.height, "page": page, "box": box}

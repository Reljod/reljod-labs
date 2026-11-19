"""`prepare`: identify the Document, render its pages, cache its text runs."""
from __future__ import annotations

import io
import json
import os
import shutil

from PIL import Image, ImageOps

MAX_PAGES = 20
MAX_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 80_000_000
PAGE_SIDE = 1600
IMAGE_SIDE = 2400
PAGE_QUALITY = 88

KIND_WORDS = {
    "payslip": ["payslip", "pay slip", "net pay", "gross pay", "pay period", "earnings", "employee"],
    "bank_statement": ["statement of account", "bank statement", "statement period", "opening balance", "closing balance", "withdrawals", "deposits"],
    "utility_bill": ["meter", "kwh", "billing period", "tariff", "amount due", "supply address", "usage"],
    "invoice": ["invoice", "bill to", "subtotal", "qty", "unit price", "purchase order", "vat"],
    "id_card": ["identity card", "national id", "date of birth", "nationality", "date of expiry"],
}


class Refused(Exception):
    pass


def sniff(path: str) -> str:
    with open(path, "rb") as f:
        head = f.read(1024)
    if b"%PDF-" in head:
        return "pdf"
    if head[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    raise Refused("Not a PDF, JPEG, PNG or WebP file.")


def guess_kind(text: str) -> str:
    t = text.lower()
    best, score = "other", 1
    for kind, words in KIND_WORDS.items():
        s = sum(1 for w in words if w in t)
        if kind in ("payslip", "invoice") and words[0] in t:
            s += 2
        if s > score:
            best, score = kind, s
    return best


def prepare(doc_path: str, work: str) -> dict:
    doc_path = os.path.abspath(doc_path)
    if not os.path.isfile(doc_path):
        raise Refused("No such file.")
    size = os.path.getsize(doc_path)
    if size > MAX_BYTES:
        raise Refused("Larger than 25 MB.")
    if size < 16:
        raise Refused("Empty file.")
    kind = sniff(doc_path)
    for sub in ("pages", "runs", "analysis"):
        d = os.path.join(work, sub)
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
    info = _pdf(doc_path, work) if kind == "pdf" else _image(doc_path, work, kind)
    info["file"] = doc_path
    info["bytes"] = size
    with open(os.path.join(work, "doc.json"), "w") as f:
        json.dump(info, f)
    return info


def _save_page(im: Image.Image, work: str, n: int) -> dict:
    im = im.convert("RGB")
    im.save(os.path.join(work, "pages", f"p{n}.jpg"), "JPEG", quality=PAGE_QUALITY)
    return {"page": n, "width": im.width, "height": im.height}


def _pdf(path: str, work: str) -> dict:
    import pikepdf
    import pypdfium2 as pdfium

    from . import _runs

    try:
        pdf = pikepdf.open(path)
    except pikepdf.PasswordError:
        raise Refused("The PDF is encrypted.")
    except Exception as e:
        raise Refused(f"Not a readable PDF ({type(e).__name__}).")
    with pdf:
        if pdf.is_encrypted:
            raise Refused("The PDF is encrypted.")
        count = len(pdf.pages)
        if count == 0:
            raise Refused("The PDF has no pages.")
        if count > MAX_PAGES:
            raise Refused(f"More than {MAX_PAGES} pages ({count}).")
        extracted = _runs.extract(path, MAX_PAGES)
        pages, raster, analysis, text = [], [], {}, []
        doc = pdfium.PdfDocument(path)
        for n in range(1, count + 1):
            page = doc[n - 1]
            w, h = page.get_size()
            scale = PAGE_SIDE / max(w, h)
            im = page.render(scale=scale).to_pil()
            pages.append(_save_page(im, work, n))
            ex = extracted[n - 1] if n - 1 < len(extracted) else {"page": n, "runs": [], "shapes": []}
            with open(os.path.join(work, "runs", f"p{n}.json"), "w") as f:
                json.dump(ex, f)
            text.append(" ".join(r["text"] for r in ex["runs"] if not r["rotated"]))
            big = [s for s in ex["shapes"] if s["kind"] == "image" and _area(s["box"]) >= 0.85]
            if big:
                raster.append(n)
                a = _embedded(pdf, n, work) if _area(big[0]["box"]) >= 0.97 else None
                if a:
                    analysis[str(n)] = a
        doc.close()
    has_runs = any(t.strip() for t in text)
    return {
        "format": "pdf",
        "pages": pages,
        "kindGuess": guess_kind(" ".join(text)),
        "textRuns": has_runs,
        "rasterPages": raster,
        "analysis": analysis,
    }


def _area(b) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _embedded(pdf, n: int, work: str):
    """The largest image XObject of a raster page, written out untouched when it is a JPEG."""
    import pikepdf

    try:
        best = None
        for _, obj in pdf.pages[n - 1].images.items():
            pi = pikepdf.PdfImage(obj)
            if best is None or pi.width * pi.height > best.width * best.height:
                best = pi
        if best is None or max(best.width, best.height) > 6000:
            return None
        buf = io.BytesIO()
        ext = best.extract_to(stream=buf)
        data = buf.getvalue()
        im = Image.open(io.BytesIO(data))
        im.load()
        if ext in (".jpg", ".jpeg") and max(im.size) <= IMAGE_SIDE and im.mode in ("RGB", "L"):
            rel = f"analysis/p{n}.jpg"
            with open(os.path.join(work, rel), "wb") as f:
                f.write(data)
            return {"path": rel, "jpeg": True}
        im = im.convert("RGB")
        if max(im.size) > IMAGE_SIDE:
            im.thumbnail((IMAGE_SIDE, IMAGE_SIDE), Image.LANCZOS)
        rel = f"analysis/p{n}.png"
        im.save(os.path.join(work, rel), "PNG", compress_level=1)
        return {"path": rel, "jpeg": False}
    except Exception:
        return None


def _image(path: str, work: str, kind: str) -> dict:
    try:
        im = Image.open(path)
        if im.width * im.height > MAX_PIXELS:
            raise Refused("The image is larger than 80 megapixels.")
        im.load()
    except Refused:
        raise
    except Exception as e:
        raise Refused(f"Not a readable image ({type(e).__name__}).")
    orientation = 1
    try:
        orientation = im.getexif().get(0x0112, 1) or 1
    except Exception:
        pass
    untouched = kind == "jpeg" and orientation == 1 and max(im.size) <= IMAGE_SIDE and im.mode in ("RGB", "L")
    if untouched:
        # The page image is the file itself: the same pixels, the same JPEG history.
        shutil.copyfile(path, os.path.join(work, "pages", "p1.jpg"))
        page = {"page": 1, "width": im.width, "height": im.height}
        analysis = {"path": "pages/p1.jpg", "jpeg": True}
    else:
        rgb = ImageOps.exif_transpose(im)
        if rgb.mode in ("RGBA", "LA", "P"):
            rgba = rgb.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[3])
            rgb = bg
        rgb = rgb.convert("RGB")
        if max(rgb.size) > IMAGE_SIDE:
            rgb.thumbnail((IMAGE_SIDE, IMAGE_SIDE), Image.LANCZOS)
        page = _save_page(rgb, work, 1)
        rgb.save(os.path.join(work, "analysis", "p1.png"), "PNG", compress_level=1)
        analysis = {"path": "analysis/p1.png", "jpeg": False}
    return {
        "format": "image",
        "pages": [page],
        "kindGuess": "other",
        "textRuns": False,
        "rasterPages": [],
        "analysis": {"1": analysis},
    }

"""How Corpus Documents are made from a rendered original: the scan pipeline,
the image Tampers, the PDF Tampers and the benign changes. All seeded."""
from __future__ import annotations

import io

import cv2
import numpy as np
import pikepdf
import pypdf
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont
from pypdf.generic import IndirectObject, NameObject
from reportlab.pdfgen import canvas

from sheet import FONT_FILES, FONTS, register, width

EPOCH = "D:%04d%02d%02d%02d%02d00+00'00'"


def pdate(d, hh=9, mm=30):
    return EPOCH % (d.year, d.month, d.day, hh, mm)


# ---- PDF ---------------------------------------------------------------------

def stamp(data: bytes, producer: str, creator: str, created: str, modified: str | None = None, title: str = "", linearize=False, objstreams=False) -> bytes:
    """Rewrites the file with fixed metadata and a deterministic /ID."""
    pdf = pikepdf.open(io.BytesIO(data))
    info = pdf.docinfo
    for k in list(info.keys()):
        del info[k]
    info["/Producer"] = producer
    info["/Creator"] = creator
    info["/CreationDate"] = created
    info["/ModDate"] = modified or created
    if title:
        info["/Title"] = title
    out = io.BytesIO()
    pdf.save(out, deterministic_id=True, linearize=linearize,
             object_stream_mode=pikepdf.ObjectStreamMode.generate if objstreams else pikepdf.ObjectStreamMode.disable)
    return out.getvalue()


def overlay(data: bytes, size, edits: list[dict]) -> bytes:
    """The white-out edit: for each edit, an opaque rectangle in the background
    colour over the old run and the new text on top, merged onto the page.
    The old text stays in the content stream."""
    register()
    reader = pypdf.PdfReader(io.BytesIO(data))
    writer = pypdf.PdfWriter(clone_from=reader)
    W, H = size
    for page in sorted({e["page"] for e in edits}):
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=size, invariant=1)
        for e in [e for e in edits if e["page"] == page]:
            f = e["field"]
            x0, y0, x1, y1 = f["pt"]
            font = e.get("font", f["font"])
            fs = f["size"] + e.get("dsize", 0)
            w = width(e["text"], font, fs)
            nx0 = f["anchor"] if f["align"] == "l" else (f["anchor"] - w if f["align"] == "r" else f["anchor"] - w / 2)
            rx0, rx1 = min(x0, nx0) - 1.5, max(x1, nx0 + w) + 1.5
            c.setFillColorRGB(*f["bg"])
            c.rect(rx0, H - y1 - 1.0, rx1 - rx0, (y1 - y0) + 2.0, stroke=0, fill=1)
            c.setFillColorRGB(*f["color"])
            c.setFont(FONTS[font][0], fs)
            c.drawString(nx0, H - (f["baseline"] + e.get("dy", 0)), e["text"])
            e["box"] = [max(0, rx0 / W), max(0, (y0 - 1) / H), min(1, rx1 / W), min(1, (y1 + 1) / H)]
        c.showPage()
        c.save()
        ov = pypdf.PdfReader(io.BytesIO(buf.getvalue())).pages[0]
        writer.pages[page - 1].merge_page(ov)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def incremental(orig: bytes, edited: bytes, pages: list[int], producer: str | None = None, modified: str | None = None) -> bytes:
    """Appends an incremental update to `orig` that swaps the listed pages'
    content and resources for those of `edited`. The original objects stay in the file."""
    w = pypdf.PdfWriter(io.BytesIO(orig), incremental=True)
    r = pypdf.PdfReader(io.BytesIO(edited))
    for n in pages:
        src = r.pages[n - 1]
        dst = w.pages[n - 1]
        for key in ("/Contents", "/Resources"):
            obj = src.raw_get(key).clone(w)
            if not isinstance(obj, IndirectObject):
                obj = w._add_object(obj)
            dst[NameObject(key)] = obj
    if producer:
        w.add_metadata({"/Producer": producer, "/ModDate": modified})
    out = io.BytesIO()
    w.write(out)
    data = out.getvalue()
    assert data.startswith(orig[: len(orig) - 8]), "not an incremental update"
    return data


# ---- scans ---------------------------------------------------------------------

def render_page(data: bytes, page: int, scale: float) -> np.ndarray:
    doc = pdfium.PdfDocument(data)
    arr = np.asarray(doc[page - 1].render(scale=scale).to_pil().convert("RGB"))
    doc.close()
    return arr


def scan(data: bytes, page: int, cfg: dict, donor=False):
    """A flatbed scan of the printed page: slight skew, paper tint, uneven lamp,
    optical blur, even sensor noise and paper grain. Returns (rgb, M) where M
    maps points (origin top-left) to pixels."""
    rng = np.random.Generator(np.random.PCG64(cfg["seed"] + (7919 if donor else 0)))
    s = cfg["scale"]
    arr = render_page(data, page, s)
    h, w = arr.shape[:2]
    m = cfg.get("margin", 0)
    W, H = w + 2 * m, h + 2 * m
    R = cv2.getRotationMatrix2D((w / 2, h / 2), cfg["angle"], 1.0)
    R[0, 2] += m + cfg.get("dx", 0)
    R[1, 2] += m + cfg.get("dy", 0)
    bed = cfg.get("bed", (255, 255, 255))
    img = cv2.warpAffine(arr, R, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=bed).astype(np.float32) / 255
    lo, hi = cfg.get("ink", 0.16), np.array(cfg.get("paper", (0.965, 0.955, 0.93)), np.float32)
    img = lo + (hi - lo) * img
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    lamp = 1.0 - cfg.get("lamp", 0.035) * ((xx / W - 0.3) ** 2 + (yy / H - 0.6) ** 2)
    img *= lamp[..., None]
    img = cv2.GaussianBlur(img, (0, 0), cfg["blur"])
    k = 0.45 if donor else 1.0
    luma = rng.normal(0, cfg["noise"] * k, (H, W)).astype(np.float32)
    chroma = rng.normal(0, cfg["noise"] * 0.45 * k, (H, W, 3)).astype(np.float32)
    grain = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 1.6) * cfg.get("grain", 1.6) * k
    out = img * 255 + luma[..., None] + chroma + grain[..., None]
    M = R.copy() * 1.0
    M[:, :2] *= s
    return np.clip(out + 0.5, 0, 255).astype(np.uint8), M


def jpeg(arr: np.ndarray, q: int) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "JPEG", quality=q)
    return buf.getvalue()


def png(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "PNG", optimize=True)
    return buf.getvalue()


def decode(data: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).copy()


def px_box(pt, M, pad=0.0):
    x0, y0, x1, y1 = pt
    c = np.array([[x0, y0, 1], [x1, y0, 1], [x0, y1, 1], [x1, y1, 1]], np.float32) @ M.T
    return [int(np.floor(c[:, 0].min() - pad)), int(np.floor(c[:, 1].min() - pad)), int(np.ceil(c[:, 0].max() + pad)), int(np.ceil(c[:, 1].max() + pad))]


def norm(b, shape):
    H, W = shape[:2]
    return [round(max(0, b[0] / W), 5), round(max(0, b[1] / H), 5), round(min(1, b[2] / W), 5), round(min(1, b[3] / H), 5)]


def _paper_ink(img, b):
    x0, y0, x1, y1 = b
    ring = np.concatenate([img[max(0, y0 - 6) : y0, x0:x1].reshape(-1, 3), img[y1 : y1 + 6, x0:x1].reshape(-1, 3)])
    paper = np.median(ring, axis=0)
    region = img[y0:y1, x0:x1].reshape(-1, 3).astype(np.float32)
    lum = region.sum(axis=1)
    ink = region[lum <= np.percentile(lum, 4)].mean(axis=0)
    return paper, ink


def _draw_text(shape, f, text, M, scale, font=None):
    """An anti-aliased coverage mask (0..1) of `text` set where the field was."""
    H, W = shape[:2]
    mask = Image.new("L", (W, H), 0)
    fnt = ImageFont.truetype(FONT_FILES[font or f["font"]], f["size"] * scale)
    ax, ay = (np.array([f["anchor"], f["baseline"], 1.0]) @ M.T)[:2]
    ImageDraw.Draw(mask).text((float(ax), float(ay)), text, font=fnt, fill=255, anchor={"l": "ls", "r": "rs", "c": "ms"}[f["align"]])
    return np.asarray(mask, np.float32) / 255


def pasted_patch(img, f, text, M, scale):
    """Paints a flat paper-coloured rectangle over the figure and types the new one: no grain, no blur."""
    w_new = width(text, f["font"], f["size"])
    pt = list(f["pt"])
    if f["align"] == "r":
        pt[0] = min(pt[0], f["anchor"] - w_new)
    elif f["align"] == "l":
        pt[2] = max(pt[2], f["anchor"] + w_new)
    b = px_box(pt, M, 6)
    paper, ink = _paper_ink(img, b)
    out = img.astype(np.float32)
    out[b[1] : b[3], b[0] : b[2]] = paper
    m = _draw_text(img.shape, f, text, M, scale)[..., None]
    out = out * (1 - m) + ink * m
    return np.clip(out + 0.5, 0, 255).astype(np.uint8), b


def matched_text(img, f, text, M, scale, cfg, seed):
    """A careful forger: new text blurred and grained to look like the page."""
    out, b = pasted_patch(img, f, text, M, scale)
    rng = np.random.Generator(np.random.PCG64(seed))
    x0, y0, x1, y1 = b
    reg = cv2.GaussianBlur(out.astype(np.float32), (0, 0), cfg["blur"])[y0:y1, x0:x1]
    reg += rng.normal(0, cfg["noise"], reg.shape[:2])[..., None]
    out[y0:y1, x0:x1] = np.clip(reg + 0.5, 0, 255)
    return out, b


def copy_block(img, src_pt, dst_pt, M, align="r"):
    """Copies the pixels of one field over another (right edges aligned), after
    covering the old figure with a copy of blank paper from the same row."""
    s = px_box(src_pt, M, 3)
    d = px_box(dst_pt, M, 3)
    out = img.copy()
    sw, dw, hgt = s[2] - s[0], d[2] - d[0], d[3] - d[1]
    blank_x1 = d[0] - 12
    out[d[1] : d[3], d[0] : d[2]] = img[d[1] : d[3], blank_x1 - dw : blank_x1]
    patch = img[s[1] : s[1] + hgt, s[0] : s[2]]
    x0 = d[2] - sw if align == "r" else d[0]
    out[d[1] : d[3], x0 : x0 + sw] = patch
    return out, [min(d[0], x0), d[1], max(d[2], x0 + sw), d[3]]


def char_pt(f, i):
    """The box in points of character i of a field."""
    x0 = f["pt"][0] + width(f["text"][:i], f["font"], f["size"])
    return [x0, f["pt"][1], x0 + width(f["text"][i], f["font"], f["size"]), f["pt"][3]]


def copy_char(img, src_f, si, dst_f, di, M):
    s = px_box(char_pt(src_f, si), M, 1)
    d = px_box(char_pt(dst_f, di), M, 1)
    out = img.copy()
    w, h = min(s[2] - s[0], d[2] - d[0]), min(s[3] - s[1], d[3] - d[1])
    out[d[1] : d[1] + h, d[0] : d[0] + w] = img[s[1] : s[1] + h, s[0] : s[0] + w]
    return out, [d[0], d[1], d[0] + w, d[1] + h]


def resave_region(img, b, q):
    x0, y0, x1, y1 = b
    out = img.copy()
    out[y0:y1, x0:x1] = decode(jpeg(np.ascontiguousarray(img[y0:y1, x0:x1]), q))
    return out


def splice(img, donor, b, shift=(3, 5)):
    """Pastes region b of a donor image that was a JPEG on another 8x8 grid."""
    out = img.copy()
    x0, y0, x1, y1 = b
    out[y0:y1, x0:x1] = donor[y0:y1, x0:x1]
    return out


def donor_jpeg(arr, q, shift=(3, 5)):
    rolled = np.roll(arr, shift, axis=(0, 1))
    return np.roll(decode(jpeg(rolled, q)), (-shift[0], -shift[1]), axis=(0, 1))


def rescan(img, cfg):
    """Benign: the whole page through a scanner or a messaging app again."""
    h, w = img.shape[:2]
    s = cfg["resize"]
    out = cv2.resize(img, (int(round(w * s)), int(round(h * s))), interpolation=cv2.INTER_AREA)
    if cfg.get("blur"):
        out = cv2.GaussianBlur(out, (0, 0), cfg["blur"])
    return out

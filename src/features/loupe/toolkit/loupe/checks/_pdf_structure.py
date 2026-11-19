from __future__ import annotations

import datetime as dt
import re

from .. import _api, _ctx
from .._api import measurement

EDITORS = [
    "Meridia PDF Editor", "QuickEdit PDF", "PixelForge",
    "Photoshop", "Illustrator", "GIMP", "Inkscape", "Canva", "iLovePDF", "Sejda", "PDFescape", "Smallpdf", "pdfFiller",
    "Foxit PDF Editor", "Foxit PhantomPDF", "PhantomPDF", "Nitro Pro", "PDF-XChange Editor", "PDFelement", "Wondershare",
    "Soda PDF", "Xodo", "PDF Expert", "Master PDF Editor", "DocHub", "PDF24", "Acrobat Pro", "LibreOffice Draw", "Paint.NET", "Pixelmator",
]
_DATE = re.compile(r"D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([+\-Z])?(\d{2})?'?(\d{2})?")


def _when(s):
    m = _DATE.match(str(s or ""))
    if not m:
        return None
    g = [int(x) if x else d for x, d in zip(m.groups()[:6], (1, 1, 1, 0, 0, 0))]
    try:
        t = dt.datetime(*g)
    except ValueError:
        return None
    if m.group(7) in ("+", "-"):
        off = dt.timedelta(hours=int(m.group(8) or 0), minutes=int(m.group(9) or 0))
        t = t - off if m.group(7) == "+" else t + off
    return t


def revisions(raw: bytes) -> list[dict]:
    """Sections appended after the first complete file, each with whether it carries page content."""
    ends = [m.end() for m in re.finditer(rb"%%EOF", raw)]
    if b"/Linearized" in raw[:2048] and len(ends) > 1:
        ends = ends[1:]
    out = []
    for a, b in zip(ends, ends[1:]):
        sec = raw[a:b]
        objs = len(re.findall(rb"\b\d+ \d+ obj\b", sec))
        content = bool(re.search(rb"/Type\s*/Page\b", sec)) or bool(re.search(rb"/Contents\b", sec)) or (b"stream" in sec and not re.search(rb"/Type\s*/(XRef|Metadata|Sig)\b", sec))
        if objs:
            out.append({"objects": objs, "content": content, "bytes": len(sec)})
    return out


def run(pages, box=None, kind=None, editors=None):
    out = []
    d = _ctx.doc()
    with open(d["file"], "rb") as f:
        raw = f.read()
    revs = revisions(raw)
    n = sum(1 for r in revs if r["content"])
    out.append(measurement("pdf.incremental_updates", n, 0, None,
                           f"{n} section(s) appended after the first save change page content ({len(revs)} appended in all, {sum(r['objects'] for r in revs)} objects)." if revs else "The file was written in one save: nothing was appended after it.",
                           {"sections": len(revs), "objects": sum(r["objects"] for r in revs)}))
    producer = creator = ""
    created = modified = None
    try:
        with _api.pdf() as pdf:
            info = pdf.docinfo
            producer = str(info.get("/Producer", "") or "")
            creator = str(info.get("/Creator", "") or "")
            created, modified = _when(info.get("/CreationDate")), _when(info.get("/ModDate"))
            try:
                with pdf.open_metadata() as xmp:
                    producer = producer or str(xmp.get("pdf:Producer", "") or "")
                    creator = creator or str(xmp.get("xmp:CreatorTool", "") or "")
            except Exception:
                pass
            annots = []
            for i, page in enumerate(pdf.pages, start=1):
                if i not in pages:
                    continue
                mb = [float(v) for v in page.mediabox]
                W, H = mb[2] - mb[0], mb[3] - mb[1]
                for a in page.get("/Annots", []) or []:
                    sub = str(a.get("/Subtype", ""))
                    if sub in ("/FreeText", "/Stamp", "/Redact", "/Ink") or (sub in ("/Square", "/Circle") and "/IC" in a):
                        r = [float(v) for v in a.get("/Rect", [0, 0, 0, 0])]
                        annots.append((i, [(min(r[0], r[2]) - mb[0]) / W, 1 - (max(r[1], r[3]) - mb[1]) / H, (max(r[0], r[2]) - mb[0]) / W, 1 - (min(r[1], r[3]) - mb[1]) / H], sub[1:]))
    except Exception:
        annots = []
    names = editors or EDITORS
    both = f"{producer} {creator}".lower()
    hit = next((e for e in names if e.lower() in both), None)
    shown = producer or creator or "(none)"
    out.append(measurement("pdf.editor_producer", 1 if hit else 0, 0, None,
                           f"The file names {shown!r} as the software that wrote it" + (f", which matches the editing tool {hit!r}." if hit else ", which is not on the list of editing tools."),
                           {"producer": producer or creator, "creator": creator, **({"matched": hit} if hit else {})}))
    gap = 0.0
    if created and modified:
        gap = max(0.0, (modified - created).total_seconds() / 3600)
    out.append(measurement("pdf.modified_gap_hours", gap, 0, None,
                           f"Last modified {gap:,.1f} hours after it was created ({created:%Y-%m-%d %H:%M} to {modified:%Y-%m-%d %H:%M})." if created and modified else "The file carries no creation and modification date pair.",
                           {"created": str(created or ""), "modified": str(modified or "")}))
    for p in pages:
        if p in d.get("rasterPages", []):
            img = [s for s in _api.shapes(p) if s["kind"] == "image"]
            first = min(s["seq"] for s in img) if img else 0
            runs = [r for r in _api.text_runs(p) if r["render"] != 3 and r["seq"] > first and not r["rotated"]]
            b = None
            if runs:
                b = [min(r["x0"] for r in runs), min(r["y0"] for r in runs), max(r["x1"] for r in runs), max(r["y1"] for r in runs)]
            out.append(measurement("pdf.text_over_image", len(runs), p, b,
                                   f"{len(runs)} visible text run(s) are drawn on top of the full-page image" + (f", e.g. {runs[0]['text'][:60]!r}." if runs else "."),
                                   {"sample": runs[0]["text"][:120]} if runs else None))
    by_page: dict = {}
    for p, b, sub in annots:
        by_page.setdefault(p, []).append((b, sub))
    for p, items in by_page.items():
        b = [min(i[0][0] for i in items), min(i[0][1] for i in items), max(i[0][2] for i in items), max(i[0][3] for i in items)]
        out.append(measurement("pdf.annotations", len(items), p, b, f"{len(items)} annotation(s) sit on the printed content: {', '.join(sorted({i[1] for i in items}))}.", {"kinds": ", ".join(sorted({i[1] for i in items}))}))
    return out

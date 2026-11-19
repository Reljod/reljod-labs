from __future__ import annotations

from .. import _layers, _text
from .._api import measurement


def run(pages, box=None, kind=None, editors=None):
    out = []
    for p in pages:
        found = []
        for i, pt in enumerate(_text.patches(p)):
            b = pt["shape"]["box"]
            if box and _text._overlap(b, box) <= 0 and _text._overlap(box, b) <= 0:
                continue
            hidden = " | ".join(r["text"] for r in pt["hidden"])
            shown = " | ".join(r["text"] for r in pt["shown"])
            value = len(pt["hidden"]) if pt["shown"] else 0.5
            found.append((value, b, hidden, shown))
        if found:
            layer = _layers.mark_layer(f"pdf_overpaint-p{p}", p, [f[1] for f in found], [f"was {f[2][:20]}" for f in found])
            for value, b, hidden, shown in found:
                out.append(measurement("pdf.covered_text", value, p, b,
                                       f"{hidden[:120]!r} is still in the file under an opaque shape" + (f"; {shown[:120]!r} is drawn on top." if shown else "; nothing is drawn on top."),
                                       {"hidden": hidden, "shown": shown}, layer, "marks"))
        elif box:
            out.append(measurement("pdf.covered_text", 0, p, box, "No text in this region is hidden under an opaque shape."))
    if not out and pages:
        out.append(measurement("pdf.covered_text", 0, 0, None, f"No text is hidden under an opaque shape on {len(pages)} page(s)."))
    return out

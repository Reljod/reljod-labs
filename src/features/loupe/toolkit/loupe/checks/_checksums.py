from __future__ import annotations

import re

from .. import _layers, _text, ids
from .._api import measurement

IBAN = re.compile(r"\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?)\b")
TAX = re.compile(r"\b(\d{3}-\d{3}-\d{3})\b")
NID = re.compile(r"\b(MRD\d{8})\b")


def run(pages, box=None, kind=None, editors=None):
    checked, bad = 0, []
    for p in pages:
        for line in _text.lines(p):
            joined = " ".join(r["text"] for r in line).lower()
            for r in line:
                if box and _text._overlap(r["box"], box) <= 0.3:
                    continue
                t = r["text"]
                for m in IBAN.finditer(t):
                    s = m.group(1)
                    if not (s.startswith("MR") or "iban" in joined):
                        continue
                    checked += 1
                    if not ids.iban_ok(s):
                        bad.append((p, r, "IBAN", s, "its mod-97 check digits do not match the rest of the number"))
                if re.search(r"tax id|\btin\b", joined):
                    for m in TAX.finditer(t):
                        checked += 1
                        if not ids.tax_id_ok(m.group(1)):
                            bad.append((p, r, "Tax ID", m.group(1), "its last digit is not the Luhn digit of the first eight"))
                for m in NID.finditer(t):
                    checked += 1
                    if not ids.national_id_ok(m.group(1)):
                        bad.append((p, r, "National ID", m.group(1), "its last digit is not the 7-3-1 check digit of the seven before it"))
    out = []
    by_page: dict = {}
    for b in bad:
        by_page.setdefault(b[0], []).append(b)
    for p, items in by_page.items():
        layer = _layers.mark_layer(f"checksums-p{p}", p, [i[1]["box"] for i in items], [f"{i[2]} fails" for i in items])
        for _, r, what, s, why in items:
            out.append(measurement("id.checksum_invalid", 1, p, r["box"], f"{what} {s} fails: {why}.", {"number": s, "kind": what}, layer, "marks"))
    if not bad and (checked or box):
        out.append(measurement("id.checksum_invalid", 0, 0, box, f"{checked} number(s) with check digits read; all pass."))
    return out

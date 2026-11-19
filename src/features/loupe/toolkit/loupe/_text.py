"""What the text-layer Checks share: visible runs, lines, amounts and dates."""
from __future__ import annotations

import datetime as dt
import re

from . import _api, _ctx

AMOUNT = re.compile(r"^(?:M\$|MRD|\$|€|£)?\s*([-−(]?)\s*(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\s*(\))?\s*(CR|DR)?$")
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
DATE_PATTERNS = [
    ("long", re.compile(r"\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b")),
    ("num", re.compile(r"\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b")),
    ("iso", re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")),
]


def _overlap(a, b) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    return w * h / max(1e-9, (a[2] - a[0]) * (a[3] - a[1]))


def patches(n: int) -> list[dict]:
    """Opaque filled shapes painted over text drawn before them: [{shape, hidden: [runs], shown: [runs]}]."""

    def make():
        runs = [r for r in _api.text_runs(n) if not r["rotated"] and r["render"] != 3]
        out = []
        for s in _api.shapes(n):
            b = s["box"]
            area = (b[2] - b[0]) * (b[3] - b[1])
            if not s["fill"] or s["alpha"] < 0.9 or area > 0.5 or area <= 0:
                continue
            hidden = [r for r in runs if r["seq1"] < s["seq"] and _overlap(r["box"], b) >= 0.6]
            if not hidden:
                continue
            grown = [b[0] - 0.01, b[1] - 0.006, b[2] + 0.01, b[3] + 0.006]
            shown = [r for r in runs if r["seq"] > s["seq"] and _overlap(r["box"], grown) >= 0.5]
            out.append({"shape": s, "hidden": hidden, "shown": shown})
        return out

    return _ctx.cached(("patches", n), make)


def visible(n: int) -> list[dict]:
    """Upright runs a reader sees: not invisible, not painted over."""

    def make():
        gone = {r["i"] for p in patches(n) for r in p["hidden"]}
        return [r for r in _api.text_runs(n) if not r["rotated"] and r["render"] != 3 and r["i"] not in gone and r["alpha"] > 0.2]

    return _ctx.cached(("visible", n), make)


def lines(n: int, tol: float = 2.2) -> list[list[dict]]:
    """Visible runs grouped into lines by baseline, top to bottom, each left to right."""

    def make():
        out: list[list[dict]] = []
        for r in sorted(visible(n), key=lambda r: -r["baselinePt"]):
            if out and abs(out[-1][0]["baselinePt"] - r["baselinePt"]) <= tol:
                out[-1].append(r)
            else:
                out.append([r])
        return [sorted(l, key=lambda r: r["x0"]) for l in out]

    return _ctx.cached(("lines", n, tol), make)


def amount(text: str):
    """The value of a run that is one money figure, else None."""
    m = AMOUNT.match(text.strip())
    if not m:
        return None
    v = float(m.group(2).replace(",", "") + "." + m.group(3))
    if m.group(1) in ("-", "−", "(") or m.group(5) == "DR":
        v = -v
    return v


def numeric(text: str) -> bool:
    d = sum(c.isdigit() for c in text)
    return d >= 2 and d >= 0.5 * sum(not c.isspace() for c in text)


def dates(text: str) -> list[tuple]:
    """(date or None when it is not a real day, style, matched text) for every date in a string."""
    out = []
    for style, rx in DATE_PATTERNS:
        for m in rx.finditer(text):
            try:
                if style == "long":
                    mon = MONTHS.get(m.group(2)[:3].lower())
                    if not mon:
                        continue
                    d, mo, y = int(m.group(1)), mon, int(m.group(3))
                    style2 = "long" if len(m.group(2)) > 3 else "short"
                elif style == "num":
                    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
                    style2 = "num"
                else:
                    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                    style2 = "iso"
                if not (1900 <= y <= 2100):
                    continue
                try:
                    val = dt.date(y, mo, d)
                except ValueError:
                    val = None
                out.append((val, style2, m.group(0), m.start()))
            except Exception:
                continue
    return sorted(out, key=lambda x: x[3])


def label_of(line: list[dict], run: dict) -> str:
    return " ".join(r["text"] for r in line if r["x0"] < run["x0"] and amount(r["text"]) is None).lower()

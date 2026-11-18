from __future__ import annotations

import datetime as dt
import re

from .. import _layers, _text
from .._api import measurement

ROLES = [("pay", re.compile(r"pay(ment)? date|date paid|paid on")), ("due", re.compile(r"\bdue\b|pay by")), ("issue", re.compile(r"(bill|invoice|issue|statement) date|date of issue|issued|dated"))]


def _collect(pages):
    period, roles, table, bad, all_dates = None, {}, [], [], []
    for p in pages:
        col: dict = {}
        for line in _text.lines(p):
            for r in line:
                ds = _text.dates(r["text"])
                if not ds:
                    continue
                label = (_text.label_of(line, r) + " " + r["text"]).lower()
                for d in ds:
                    if d[0] is None:
                        bad.append((p, r, f"{d[2]!r} is not a day that exists."))
                    else:
                        all_dates.append((p, r, d))
                good = [d for d in ds if d[0]]
                if len(good) >= 2 and (re.search(r"period|from|\bto\b", label)):
                    if period is None:
                        period = (good[0][0], good[1][0], p, r)
                    continue
                if len(good) == 1 and r["text"].strip() == good[0][2]:
                    role = next((k for k, rx in ROLES if rx.search(_text.label_of(line, r))), None)
                    if role and role not in roles:
                        roles[role] = (good[0][0], p, r)
                    elif not role:
                        col.setdefault(round(r["x0pt"]), []).append((good[0][0], p, r, good[0][1]))
        for items in col.values():
            if len(items) >= 4:
                table += items
    return period, roles, table, bad, all_dates


def run(pages, box=None, kind=None, editors=None):
    period, roles, table, bad, all_dates = _collect(pages)
    found = list(bad)
    if period:
        a, b = period[0], period[1]
        if a > b:
            found.append((period[2], period[3], f"The period runs backwards: {a} to {b}."))
        for d, p, r, _ in table:
            if d < a or d > b:
                found.append((p, r, f"The entry dated {d} lies outside the document's own period, {a} to {b}."))
        if "pay" in roles and (roles["pay"][0] < a or roles["pay"][0] > b + dt.timedelta(days=45)):
            found.append((roles["pay"][1], roles["pay"][2], f"The pay date {roles['pay'][0]} does not belong to the pay period {a} to {b}."))
        if "issue" in roles and roles["issue"][0] < a:
            found.append((roles["issue"][1], roles["issue"][2], f"The document is dated {roles['issue'][0]}, before its own period starts ({a})."))
    if "issue" in roles and "due" in roles and roles["issue"][0] > roles["due"][0]:
        found.append((roles["issue"][1], roles["issue"][2], f"The document is dated {roles['issue'][0]}, after its own due date {roles['due'][0]}."))
    styles: dict = {}
    for d, p, r, style in table:
        styles[style] = styles.get(style, 0) + 1
    breaks = []
    if len(styles) > 1:
        major = max(styles, key=styles.get)
        if styles[major] >= 3 * (sum(styles.values()) - styles[major]):
            breaks += [(p, r, f"The date {r['text']!r} is written unlike the other {styles[major]} dates in its column.") for d, p, r, s in table if s != major]
    for p in pages:
        cols: dict = {}
        for r in _text.visible(p):
            if _text.amount(r["text"]) is not None:
                cols.setdefault(round(r["x1pt"]), []).append(r)
        for rs in cols.values():
            big = [r for r in rs if abs(_text.amount(r["text"])) >= 1000]
            comma = [r for r in big if "," in r["text"]]
            if len(big) >= 3 and 0 < len(big) - len(comma) <= len(big) // 3:
                breaks += [(p, r, f"{r['text']!r} has no thousands separator while {len(comma)} figures in its column do.") for r in big if "," not in r["text"]]
    out = []
    for metric, items, tag, quiet in (("format.date_anomaly", found, "dates", f"{len(all_dates)} date(s) read; none contradicts the document."), ("format.style_break", breaks, "style", "Dates and figures are formatted alike within their columns.")):
        if box:
            items = [f for f in items if _text._overlap(f[1]["box"], box) > 0.3]
        by_page: dict = {}
        for p, r, why in items[:12]:
            by_page.setdefault(p, []).append((r, why))
        for p, rs in by_page.items():
            layer = _layers.mark_layer(f"{tag}-p{p}", p, [r["box"] for r, _ in rs], [r["text"][:24] for r, _ in rs])
            for r, why in rs:
                out.append(measurement(metric, 1, p, r["box"], why, {"text": r["text"]}, layer, "marks"))
        if not items and (all_dates or box):
            out.append(measurement(metric, 0, 0, box, quiet if not box else "Nothing in this region contradicts the document."))
    return out

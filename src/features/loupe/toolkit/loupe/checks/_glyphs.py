from __future__ import annotations

import re
import statistics as st

from .. import _layers, _text
from .._api import measurement

_STYLE = re.compile(r"[-, ]?(Bold|Italic|Oblique|Regular|Medium|Semibold|Light|BoldItalic|MT|PS)+$", re.I)
FLOORS = {"glyph.font_outlier": 0.2, "glyph.size_delta_pt": 0.05, "glyph.baseline_offset_pt": 0.05, "glyph.spacing_outlier": 2.0, "glyph.color_delta": 8.0}
DESIGN_STEP_PT = 1.5


def family(font: str) -> str:
    return _STYLE.sub("", font)


def fdist(a: str, b: str) -> float:
    if a == b:
        return 0.0
    return 0.35 if family(a) == family(b) else 1.0


def cdist(a, b) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def _gap(r):
    ch = [c for c in r["chars"]]
    g = [b[1] - a[2] for a, b in zip(ch, ch[1:]) if a[0].strip() and b[0].strip()]
    return (sum(g) / len(g) / r["size"]) if len(g) >= 2 else None


def score(p: int) -> list[dict]:
    """Scores every figure (a run that is mostly digits: amounts, dates, numbers)
    against the runs it belongs with: the other figures in its column, and its
    own line. Words are scored for font only, and only in a font the page
    hardly uses. Headings and deliberately different type are not peers."""
    runs = _text.visible(p)
    lines = _text.lines(p)
    line_of = {r["i"]: l for l in lines for r in l}
    font_count: dict = {}
    for r in runs:
        font_count[r["font"]] = font_count.get(r["font"], 0) + 1
    rare_max = max(4, int(0.05 * len(runs)))
    gaps: dict = {}
    for r in runs:
        g = _gap(r)
        if g is not None:
            gaps.setdefault((r["font"], round(r["size"], 1)), []).append(g)
    colors = [tuple(r["color"]) for r in runs]
    out = []
    for r in runs:
        num = _text.numeric(r["text"])
        lp = [x for x in line_of[r["i"]] if x is not r]
        near = lambda x: abs(x["size"] - r["size"]) <= 0.12 * r["size"]  # noqa: E731
        cp = [x for x in runs if x is not r and _text.numeric(x["text"]) == num and near(x) and (abs(x["x1pt"] - r["x1pt"]) < 1.2 or abs(x["x0pt"] - r["x0pt"]) < 1.2)]
        pg = [x for x in runs if x is not r and _text.numeric(x["text"])]
        rare = font_count[r["font"]] <= rare_max
        fl = st.mean(fdist(r["font"], x["font"]) for x in lp) if lp else 1.0
        font = size = base = z = col = 0.0
        if num:
            fc = st.median(fdist(r["font"], x["font"]) for x in cp) if len(cp) >= 3 else min((fdist(r["font"], x["font"]) for x in pg), default=0.0)
            font = min(fl, fc)
            same = [x for x in cp if x["font"] == r["font"]]
            if len(cp) >= 3:
                size = abs(r["size"] - st.median(x["size"] for x in cp))
            elif same:
                size = min(abs(r["size"] - x["size"]) for x in same)
            if lp:
                size = min(size, min(abs(r["size"] - x["size"]) for x in lp))
            if size > DESIGN_STEP_PT:
                size = 0.0
            if lp:
                base = min(abs(r["baselinePt"] - x["baselinePt"]) for x in lp)
            g = _gap(r)
            grp = gaps.get((r["font"], round(r["size"], 1)), [])
            if g is not None and len(grp) >= 4:
                med = st.median(grp)
                mad = st.median(abs(x - med) for x in grp)
                z = abs(g - med) / (1.4826 * mad + 0.004)
            if colors.count(tuple(r["color"])) <= 1:
                cc = [cdist(r["color"], x["color"]) for x in lp + cp]
                col = min(cc) if cc else 0.0
        elif rare and font_count[r["font"]] <= 2 and lp:
            font = fl
        out.append({"run": r, "glyph.font_outlier": font, "glyph.size_delta_pt": size, "glyph.baseline_offset_pt": base, "glyph.spacing_outlier": z, "glyph.color_delta": col,
                    "peer_font": (cp or lp or pg or [r])[0]["font"], "peer_size": (cp or lp or [r])[0]["size"], "n_line": len(lp), "n_col": len(cp)})
    return out


WORDS = {
    "glyph.font_outlier": lambda s, r: f"{r['text'][:50]!r} is set in {r['font']} while the runs it sits with use {s['peer_font']} (score {s['glyph.font_outlier']:.2f}; {s['n_line']} on its line, {s['n_col']} in its column).",
    "glyph.size_delta_pt": lambda s, r: f"{r['text'][:50]!r} is {r['size']:.2f} pt, {s['glyph.size_delta_pt']:.2f} pt off the runs it sits with.",
    "glyph.baseline_offset_pt": lambda s, r: f"{r['text'][:50]!r} sits {s['glyph.baseline_offset_pt']:.2f} pt off the baseline of its line.",
    "glyph.spacing_outlier": lambda s, r: f"The letter spacing of {r['text'][:50]!r} is {s['glyph.spacing_outlier']:.1f} standard deviations from other {r['font']} runs of its size.",
    "glyph.color_delta": lambda s, r: f"The ink of {r['text'][:50]!r} is rgb{tuple(r['color'])}, {s['glyph.color_delta']:.0f} away from the runs it sits with.",
}
TAGS = {"glyph.font_outlier": "font", "glyph.size_delta_pt": "size", "glyph.baseline_offset_pt": "baseline", "glyph.spacing_outlier": "spacing", "glyph.color_delta": "ink"}


def run(pages, box=None, kind=None, editors=None):
    out = []
    for p in pages:
        scores = score(p)
        if box:
            scores = [s for s in scores if _text._overlap(s["run"]["box"], box) > 0.3]
        if not scores:
            if box:
                out.append(measurement("glyph.font_outlier", 0, p, box, "No text run lies in this region."))
            continue
        marked: dict = {}
        picks = []
        for metric, floor in FLOORS.items():
            ranked = sorted(scores, key=lambda s: -s[metric])
            top = [s for s in ranked[:6] if s[metric] > floor] or ranked[:1]
            for s in top:
                picks.append((metric, s))
                if s[metric] > floor:
                    marked.setdefault(s["run"]["i"], (s["run"]["box"], []))[1].append(TAGS[metric])
        layer = None
        if marked:
            layer = _layers.mark_layer(f"glyphs-p{p}" + ("-box" if box else ""), p, [v[0] for v in marked.values()], [" + ".join(v[1]) for v in marked.values()])
        for metric, s in picks:
            r = s["run"]
            hot = s[metric] > FLOORS[metric]
            out.append(measurement(metric, s[metric], p, r["box"], WORDS[metric](s, r) if hot or box else f"Nothing stands out among {len(scores)} runs; the largest value is {s[metric]:.2f} at {r['text'][:40]!r}.",
                                   {"text": r["text"], "font": r["font"], "size": r["size"], "peerFont": s["peer_font"], "peerSize": s["peer_size"]}, layer if hot else None, "marks" if hot and layer else None))
    return out

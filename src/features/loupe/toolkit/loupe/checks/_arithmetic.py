"""Lines against totals, running balances and stated rates, from label
heuristics over the text layer. Nothing here knows a Corpus layout."""
from __future__ import annotations

import re

from .. import _layers, _text
from .._api import measurement

TOTAL = re.compile(r"^\W*(sub-?total|total|gross pay|net pay|amount due|balance due|amount payable)\b")
SUMMARY = re.compile(r"\b(paid in|paid out|deposits?|withdrawals?|credits?|debits?|opening|closing|brought|carried)\b")
RATE = re.compile(r"(\d{1,2}(?:\.\d+)?)\s*%")
BASE = re.compile(r"^\W*(sub-?total|gross|taxable|net amount)\b")
TOL = 0.011
HEAD_OUT = re.compile(r"paid out|withdrawal|debit|money out", re.I)
HEAD_IN = re.compile(r"paid in|deposit|credit|money in", re.I)
HEAD_BAL = re.compile(r"^balance", re.I)


def _rows(p):
    """(label, value, run) for every money figure on the page, in reading order."""
    out = []
    for line in _text.lines(p):
        for r in line:
            v = _text.amount(r["text"])
            if v is not None:
                out.append((_text.label_of(line, r), v, r))
    return out


def sums(pages):
    found, verified = [], 0
    for p in pages:
        rows = _rows(p)
        totals = []  # (value, run) of total rows already seen on the page
        last_total_at: dict = {}
        for idx, (label, v, r) in enumerate(rows):
            col = round(r["x1pt"])
            if not TOTAL.search(label) or SUMMARY.search(label):
                continue
            start = last_total_at.get(col, -1)
            items = [x[1] for x in rows[start + 1 : idx] if abs(x[2]["x1pt"] - r["x1pt"]) < 1.5 and not TOTAL.search(x[0])]
            s = sum(items)
            hyp = {}
            if len(items) >= 1:
                hyp["the lines above it"] = s
            if totals:
                p1 = totals[-1][0]
                if items:
                    hyp["the lines above it plus the total before"] = s + p1
                    hyp["the total before less the lines above it"] = p1 - s
                if len(totals) >= 2 and not items:
                    p2 = totals[-2][0]
                    hyp["the two totals before it, subtracted"] = p2 - p1
                    hyp["the two totals before it, added"] = p2 + p1
            last_total_at[col] = idx
            totals.append((v, r))
            if not hyp:
                continue
            how, calc = min(hyp.items(), key=lambda kv: abs(kv[1] - v))
            diff = abs(calc - v)
            if diff <= TOL:
                verified += 1
            found.append({"page": p, "run": r, "label": label, "printed": v, "computed": round(calc, 2), "diff": 0.0 if diff <= TOL else round(diff, 2), "how": how, "items": len(items)})
    return found, verified


def rates(pages):
    found = []
    for p in pages:
        rows = _rows(p)
        bases = [(l, v) for l, v, _ in rows if BASE.search(l) or TOTAL.search(l)]
        for label, v, r in rows:
            m = RATE.search(label)
            if not m or TOTAL.search(label.split("(")[0]) and "%" not in label.split("(")[0]:
                continue
            rate = float(m.group(1)) / 100
            of = re.search(r"of ([a-z ]+)", label)
            cands = [(l, b) for l, b in bases if b > 0 and abs(b - v) > TOL]
            if of:
                named = [(l, b) for l, b in cands if of.group(1).strip().split()[0] in l]
                cands = named or cands
            cands = [(l, b) for l, b in cands if 0.5 * abs(v) <= rate * b <= 2.0 * abs(v) + 1]
            if not cands:
                continue
            l, b = min(cands, key=lambda c: abs(rate * c[1] - abs(v)))
            diff = abs(round(rate * b, 2) - abs(v))
            found.append({"page": p, "run": r, "label": label, "printed": v, "computed": round(rate * b, 2), "diff": 0.0 if diff <= TOL else round(diff, 2), "rate": rate * 100, "base": b, "baseLabel": l})
    return found


def _near_amount(p, lab):
    """The figure a label names: on its line to the right, else just below it."""
    best = None
    for r in _text.visible(p):
        v = _text.amount(r["text"])
        if v is None or r is lab:
            continue
        dy = lab["baselinePt"] - r["baselinePt"]
        if abs(dy) <= 2.2 and r["x0pt"] > lab["x0pt"]:
            cost = (r["x0pt"] - lab["x1pt"]) / 10
        elif 2.2 < dy <= 34 and r["x1pt"] > lab["x0pt"] and r["x0pt"] < lab["x0pt"] + 170:
            cost = dy
        else:
            continue
        if best is None or cost < best[0]:
            best = (cost, v, r)
    return best


def balances(pages):
    found = []
    prev = None
    tin = tout = 0.0
    last = None
    saw_table = False
    for p in pages:
        cols = None
        for line in _text.lines(p):
            texts = [r["text"] for r in line]
            hb = [r for r in line if HEAD_BAL.search(r["text"])]
            ho = [r for r in line if HEAD_OUT.search(r["text"])]
            hi = [r for r in line if HEAD_IN.search(r["text"])]
            if hb and (ho or hi) and not any(_text.amount(t) is not None for t in texts):
                cols = {"bal": hb[-1]["x1pt"], "out": ho[-1]["x1pt"] if ho else None, "in": hi[-1]["x1pt"] if hi else None}
                saw_table = True
                continue
            if not cols:
                continue
            cell = {}
            for r in line:
                v = _text.amount(r["text"])
                if v is None:
                    continue
                k = min((k for k in cols if cols[k] is not None), key=lambda k: abs(cols[k] - r["x1pt"]))
                if abs(cols[k] - r["x1pt"]) < 4:
                    cell[k] = (v, r)
            if "bal" not in cell:
                continue
            bal, run_ = cell["bal"]
            o = cell.get("out", (0.0, None))[0]
            i = cell.get("in", (0.0, None))[0]
            if prev is not None:
                exp = prev - abs(o) + abs(i)
                diff = abs(exp - bal)
                found.append({"page": p, "run": run_, "printed": bal, "computed": round(exp, 2), "diff": 0.0 if diff <= TOL else round(diff, 2), "what": "row"})
            prev, last = bal, run_
            tin += abs(i)
            tout += abs(o)
    # the summary: opening + in - out = closing, and the totals against the table
    summ = {}
    for p in pages:
        for r in _text.visible(p):
            t = r["text"].lower()
            if _text.amount(r["text"]) is not None or len(t) > 40:
                continue
            key = "opening" if "opening balance" in t else "closing" if "closing balance" in t else "in" if re.search(r"total (paid in|deposits|credits)", t) else "out" if re.search(r"total (paid out|withdrawals|debits)", t) else None
            if key and key not in summ:
                hit = _near_amount(p, r)
                if hit:
                    summ[key] = (hit[1], hit[2], p)
    if all(k in summ for k in ("opening", "closing", "in", "out")):
        exp = summ["opening"][0] + summ["in"][0] - summ["out"][0]
        diff = abs(exp - summ["closing"][0])
        found.append({"page": summ["closing"][2], "run": summ["closing"][1], "printed": summ["closing"][0], "computed": round(exp, 2), "diff": 0.0 if diff <= TOL else round(diff, 2), "what": "summary"})
    if saw_table:
        for key, tot in (("in", tin), ("out", tout)):
            if key in summ:
                diff = abs(tot - summ[key][0])
                found.append({"page": summ[key][2], "run": summ[key][1], "printed": summ[key][0], "computed": round(tot, 2), "diff": 0.0 if diff <= TOL else round(diff, 2), "what": f"total {key}"})
    return found


SAY = {
    "row": "The balance {printed:,.2f} should be {computed:,.2f} from the balance before it and this row's transaction: off by {diff:,.2f}.",
    "summary": "Closing balance {printed:,.2f} is not opening balance plus paid in less paid out ({computed:,.2f}): off by {diff:,.2f}.",
    "total in": "The summary's total paid in {printed:,.2f} is not the sum of the table's ({computed:,.2f}): off by {diff:,.2f}.",
    "total out": "The summary's total paid out {printed:,.2f} is not the sum of the table's ({computed:,.2f}): off by {diff:,.2f}.",
}


def _emit(out, metric, items, box, detail, tag):
    if box:
        items = [f for f in items if _text._overlap(f["run"]["box"], box) > 0.3]
    bad = sorted([f for f in items if f["diff"] > 0], key=lambda f: -f["diff"])[:6]
    for k, f in enumerate(bad):
        layer = _layers.compare_layer(f"{tag}-p{f['page']}-{k + 1}", f["page"], f["run"]["box"], "printed", f["printed"], "recomputed", f["computed"])
        out.append(measurement(metric, f["diff"], f["page"], f["run"]["box"], detail(f), {k2: v for k2, v in f.items() if k2 not in ("run", "page", "diff")}, layer, "compare"))
    if not bad and items:
        f = items[-1]
        out.append(measurement(metric, 0, f["page"], f["run"]["box"], f"{len(items)} figure(s) recomputed and all agree; the last is {f['printed']:,.2f} against {f['computed']:,.2f}.", {"printed": f["printed"], "computed": f["computed"], "checked": len(items)}))
    elif box and not items:
        out.append(measurement(metric, 0, 0, box, "Nothing in this region could be recomputed from the text layer."))


def run(pages, box=None, kind=None, editors=None):
    out = []
    s, verified = sums(pages)
    if verified == 0:
        s = [dict(f, diff=0.0) for f in s if f["diff"] == 0]  # a layout it could not verify anywhere is not evidence
    _emit(out, "arith.sum_mismatch", s, box, lambda f: f"{f['label'][:60]!r} prints {f['printed']:,.2f} but {f['how']} come to {f['computed']:,.2f}: off by {f['diff']:,.2f}.", "arith-sum")
    _emit(out, "arith.balance_break", balances(pages), box, lambda f: SAY[f["what"]].format(**f), "arith-balance")
    _emit(out, "arith.rate_mismatch", rates(pages), box, lambda f: f"{f['label'][:60]!r} prints {f['printed']:,.2f}, but {f['rate']:g}% of {f['base']:,.2f} is {f['computed']:,.2f}: off by {f['diff']:,.2f}.", "arith-rate")
    return out

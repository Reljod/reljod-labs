"""The Checks. Each is callable from code, e.g. `loupe.checks.ela(page=1, box=None)`,
and returns a list of Measurement dicts (writing Evidence layers into $LOUPE_OUT)."""
from __future__ import annotations

import importlib
import time

from .. import _ctx, contract

REGISTRY = tuple(contract.CHECKS)
PER_METRIC_PER_PAGE = 6


def _mod(check: str):
    return importlib.import_module(f"{__name__}._{check}")


def _pages_for(check: str) -> list[int]:
    d = _ctx.doc()
    if "pdf" in contract.CHECKS[check]["formats"]:
        return [p["page"] for p in d["pages"]] if d["format"] == "pdf" else []
    if d["format"] == "image":
        return [1]
    return list(d.get("rasterPages", []))


def _cap(ms: list[dict]) -> list[dict]:
    seen: dict = {}
    out = []
    for m in sorted(ms, key=lambda m: -abs(m["value"])):
        k = (m["metric"], m["page"])
        seen[k] = seen.get(k, 0) + 1
        if seen[k] <= PER_METRIC_PER_PAGE:
            out.append(m)
    return sorted(out, key=lambda m: (m["page"], contract.METRICS.index(m["metric"]), -abs(m["value"])))


def _call(check: str, page=None, box=None, kind=None, editors=None) -> list[dict]:
    if check not in REGISTRY:
        raise ValueError(f"Unknown check {check!r}. Checks: {', '.join(REGISTRY)}")
    d = _ctx.doc()
    pages = _pages_for(check)
    if page is not None:
        page = int(page)
        if not 1 <= page <= len(d["pages"]):
            raise ValueError(f"Page {page} is out of range (1..{len(d['pages'])}).")
        if "image" in contract.CHECKS[check]["formats"] and d["format"] == "pdf":
            pages = [page]  # asked for: run it on the rendered page
        else:
            pages = [p for p in pages if p == page]
    if box is not None and page is None:
        pages = pages[:1]
    ms = _mod(check).run(pages=pages, box=box, kind=kind or d.get("kindGuess"), editors=editors)
    for m in ms:
        m["check"] = check
    return _cap(ms)


def run_one(check: str, page=None, box=None, kind=None, editors=None) -> dict:
    t = time.perf_counter()
    entry = {"check": check, "ms": 0, "measurements": 0}
    ms = []
    try:
        ms = _call(check, page, box, kind, editors)
    except Exception as e:
        entry["error"] = f"{type(e).__name__}: {e}"[:300]
    entry["ms"] = int((time.perf_counter() - t) * 1000)
    entry["measurements"] = len(ms)
    return {"measurements": ms, "checks": [entry]}


def sweep(kind=None, editors=None) -> dict:
    """Every Check that fits the Document. A Check that throws is recorded and the Sweep goes on."""
    out = {"measurements": [], "checks": []}
    for check in REGISTRY:
        if not _pages_for(check):
            continue
        r = run_one(check, kind=kind, editors=editors)
        out["measurements"] += r["measurements"]
        out["checks"] += r["checks"]
    return out


def _make(check):
    def f(page=None, box=None, kind=None, editors=None):
        return _call(check, page, box, kind, editors)

    f.__name__ = check
    f.__doc__ = f"Runs the {check} Check on a page (default: every page it fits) or a box; returns Measurements."
    return f


for _c in REGISTRY:
    globals()[_c] = _make(_c)

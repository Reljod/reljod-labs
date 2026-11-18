"""Where the Document and the outputs live. Everything comes from
`configure()` (the CLI calls it) or the environment: LOUPE_WORK (default
/work) and LOUPE_OUT (default <work>/out/run)."""
from __future__ import annotations

import json
import os

_state: dict = {"work": None, "out": None, "doc": None, "cache": {}}


def configure(work: str | None = None, out: str | None = None) -> None:
    if work is not None:
        _state["work"] = os.path.abspath(work)
        _state["doc"] = None
        _state["cache"] = {}
    if out is not None:
        _state["out"] = os.path.abspath(out)


def work() -> str:
    return _state["work"] or os.environ.get("LOUPE_WORK", "/work")


def out_dir() -> str:
    d = _state["out"] or os.environ.get("LOUPE_OUT") or os.path.join(work(), "out", "run")
    os.makedirs(d, exist_ok=True)
    return d


def doc() -> dict:
    if _state["doc"] is None:
        path = os.path.join(work(), "doc.json")
        if not os.path.exists(path):
            raise RuntimeError(f"No doc.json in {work()}: run `python -m loupe prepare` first.")
        with open(path) as f:
            _state["doc"] = json.load(f)
    return _state["doc"]


def cache() -> dict:
    """In-process cache, dropped when the work dir changes."""
    return _state["cache"]


def cached(key, make):
    c = cache()
    if key not in c:
        c[key] = make()
    return c[key]

"""python -m loupe <prepare|sweep|check|crop> ... : one line of JSON last on stdout."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time


def _box(s):
    if not s:
        return None
    v = [float(x) for x in s.split(",")]
    if len(v) != 4 or not (0 <= v[0] < v[2] <= 1 and 0 <= v[1] < v[3] <= 1):
        raise SystemExit("--box is x0,y0,x1,y1, each 0..1, x1 > x0 and y1 > y0")
    return v


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m loupe")
    sub = ap.add_subparsers(dest="cmd", required=True)
    default_work = os.environ.get("LOUPE_WORK", "/work")
    p = sub.add_parser("prepare")
    p.add_argument("--doc", required=True)
    p.add_argument("--work", default=default_work)
    p = sub.add_parser("sweep")
    p.add_argument("--work", default=default_work)
    p.add_argument("--kind", default=None)
    p.add_argument("--out", required=True)
    p.add_argument("--editors", default=None, help="JSON list of editing-tool names")
    p = sub.add_parser("check")
    p.add_argument("check")
    p.add_argument("--work", default=default_work)
    p.add_argument("--out", required=True)
    p.add_argument("--page", type=int, default=None)
    p.add_argument("--box", default=None)
    p.add_argument("--kind", default=None)
    p.add_argument("--editors", default=None)
    p = sub.add_parser("crop")
    p.add_argument("--work", default=default_work)
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--box", default=None)
    p.add_argument("--out", required=True)
    p.add_argument("--max", type=int, default=1100)
    a = ap.parse_args(argv)

    t0 = time.perf_counter()
    try:
        if a.cmd == "prepare":
            from ._prepare import Refused, prepare

            os.makedirs(a.work, exist_ok=True)
            try:
                info = prepare(a.doc, a.work)
            except Refused as e:
                print(f"refused: {e}", file=sys.stderr)
                return 2
            info["ms"] = int((time.perf_counter() - t0) * 1000)
            print(json.dumps(info))
            return 0

        from . import _ctx, checks

        _ctx.configure(work=a.work, out=getattr(a, "out", None) if a.cmd != "crop" else None)
        if a.cmd == "crop":
            from ._crop import crop

            print(json.dumps(crop(a.page, _box(a.box), a.out, a.max)))
            return 0
        os.makedirs(a.out, exist_ok=True)
        editors = json.loads(a.editors) if a.editors else None
        if a.cmd == "sweep":
            res = checks.sweep(kind=a.kind, editors=editors)
        else:
            if a.check not in checks.REGISTRY:
                print(f"unknown check {a.check!r}; checks: {', '.join(checks.REGISTRY)}", file=sys.stderr)
                return 2
            res = checks.run_one(a.check, page=a.page, box=_box(a.box), kind=a.kind, editors=editors)
        with open(os.path.join(a.out, "measurements.json"), "w") as f:
            json.dump(res, f)
        print(
            json.dumps(
                {
                    "measurements": len(res["measurements"]),
                    "checks": res["checks"],
                    "file": os.path.join(a.out, "measurements.json"),
                    "ms": int((time.perf_counter() - t0) * 1000),
                }
            )
        )
        return 0
    except SystemExit:
        raise
    except Exception as e:  # a short message, never a traceback on stdout
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

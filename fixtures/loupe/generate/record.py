"""Runs the real Toolkit over every Corpus Document and records its Sweep:
fixtures/loupe/expected/<id>.json, and for featured Samples the page images
and Evidence layers under public/loupe/samples/<id>/. The Toolkit never sees
the Manifest: it is given the file and the Document kind, as the server gives them."""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(ROOT))
sys.path.insert(0, os.path.join(REPO, "src", "features", "loupe", "toolkit"))

from loupe import _ctx, _prepare, checks  # noqa: E402


def main():
    docs = json.load(open(os.path.join(ROOT, "manifest.json")))["documents"]
    exp = os.path.join(ROOT, "expected")
    samples = os.path.join(REPO, "public", "loupe", "samples")
    for d in (exp, samples):
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
    total = 0.0
    slow = (0, "")
    for d in docs:
        work = tempfile.mkdtemp(prefix="loupe-")
        out = os.path.join(work, "out", "sweep")
        t0 = time.perf_counter()
        info = _prepare.prepare(os.path.join(ROOT, "corpus", d["file"]), work)
        os.makedirs(out, exist_ok=True)
        _ctx.configure(work=work, out=out)
        res = checks.sweep(kind=d["kind"])
        ms = int((time.perf_counter() - t0) * 1000)
        total += ms
        slow = max(slow, (ms, d["id"]))
        errors = [c for c in res["checks"] if c.get("error")]
        if errors:
            raise SystemExit(f"{d['id']}: a Check failed: {errors}")
        assert info["format"] == d["format"] and len(info["pages"]) == d["pages"], d["id"]
        record = {"id": d["id"], "format": info["format"], "kindGuess": info["kindGuess"], "pages": info["pages"],
                  "measurements": res["measurements"], "checks": res["checks"], "toolkitMs": ms}
        with open(os.path.join(exp, d["id"] + ".json"), "w") as f:
            json.dump(record, f, indent=1)
            f.write("\n")
        if d["featured"]:
            dst = os.path.join(samples, d["id"])
            os.makedirs(dst)
            shutil.copyfile(os.path.join(ROOT, "corpus", d["file"]), os.path.join(dst, "document." + d["file"].rsplit(".", 1)[1]))
            for p in info["pages"]:
                shutil.copyfile(os.path.join(work, "pages", f"p{p['page']}.jpg"), os.path.join(dst, f"p{p['page']}.jpg"))
            for name in sorted(os.listdir(out)):
                if name.endswith(".png"):
                    shutil.copyfile(os.path.join(out, name), os.path.join(dst, name))
            with open(os.path.join(dst, "sweep.json"), "w") as f:
                json.dump(record, f)
        shutil.rmtree(work, ignore_errors=True)
    print(f"recorded {len(docs)} sweeps: mean {total / len(docs):.0f} ms, slowest {slow[0]} ms ({slow[1]})")


if __name__ == "__main__":
    main()

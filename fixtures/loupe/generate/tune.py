"""Finds, on train and validation only, the threshold per Metric that best
separates Measurements on a Tamper from everything else, then reports what
those thresholds do on every Split (test is reported, never tuned)."""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
METRICS = None
# Evidence about the whole file, or about a relation between figures, has no box on the edit itself:
# on a tampered Document it counts for the Tamper.
RELATIONAL = ("arith.", "format.", "id.")
# Where untouched Documents measure exactly 0: the smallest value that means anything.
ZERO_FLOORS = {"arith.": 0.02, "pdf.modified_gap_hours": 1.0, "image.copy_move": 0.01}


def overlaps(a, b):
    return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])


def on_tamper(m, doc):
    if not doc["tampers"]:
        return False
    if m["page"] == 0 or not m.get("box") or m["metric"].startswith(RELATIONAL):
        return True
    boxes = [m["box"]]
    twin = (m.get("facts") or {}).get("twin")  # a copy and its source are one piece of evidence
    if twin:
        boxes.append([float(v) for v in twin.split(",")])
    return any(t["page"] == m["page"] and overlaps(b, t["box"]) for t in doc["tampers"] for b in boxes)


def main():
    docs = json.load(open(os.path.join(ROOT, "manifest.json")))["documents"]
    rows = []  # (doc, metric, value, on)
    for d in docs:
        e = json.load(open(os.path.join(ROOT, "expected", d["id"] + ".json")))
        for m in e["measurements"]:
            rows.append((d, m["metric"], m["value"], on_tamper(m, d)))
    metrics = sorted({r[1] for r in rows})
    tv = [r for r in rows if r[0]["split"] != "test"]
    out = {}
    for metric in metrics:
        mine = [r for r in tv if r[1] == metric]
        off = [r[2] for r in mine if not r[3]]
        on = sorted({r[2] for r in mine if r[3] and r[2] > 0})
        max_off = max(off, default=0.0)
        above = [v for v in on if v > max_off]
        floor = next((v for k, v in ZERO_FLOORS.items() if metric.startswith(k)), None)
        if above and max_off == 0 and floor is not None:
            t = floor
            note = "Every untouched Document in train and validation measures exactly 0, so the threshold is the smallest value that means anything."
        elif above:
            t = round((max_off + above[0]) / 2, 3) if max_off > 0 else above[0]
            if all(float(v).is_integer() for v in on + off):
                t = above[0]
            note = "No false flag on train and validation at this threshold: halfway between the highest untouched value and the lowest value on a Tamper above it."
        else:
            t = round(max_off * 1.25 + 0.01, 3) if max_off > 0 else 1.0
            note = "Never fired on a Tamper in train or validation without also firing elsewhere; set above every untouched value, so it stays quiet."
        caught = {r[0]["id"] for r in mine if r[3] and r[2] >= t}
        false = {r[0]["id"] for r in mine if not r[3] and r[2] >= t}
        out[metric] = {"threshold": t, "direction": ">=", "trainValCaught": len(caught), "trainValFalse": len(false), "maxUntouched": round(max_off, 4), "note": note}
    thr = {m: v["threshold"] for m, v in out.items()}

    def flagged(doc, on_only=False):
        return any(r[2] >= thr[r[1]] and (r[3] or not on_only) for r in rows if r[0] is doc)

    splits = {}
    for split in ("train", "validation", "test"):
        ds = [d for d in docs if d["split"] == split]
        tam = [d for d in ds if d["tampers"]]
        easy = [d for d in tam if not d["hard"]]
        clean = [d for d in ds if not d["tampers"]]
        types = {}
        for d in tam:
            for t in sorted({t["type"] for t in d["tampers"]}):
                c = types.setdefault(t, [0, 0, []])
                c[1] += 1
                if flagged(d):
                    c[0] += 1
                else:
                    c[2].append(d["id"] + (" (hard)" if d["hard"] else ""))
        splits[split] = {
            "documents": len(ds), "tampered": len(tam), "hard": len(tam) - len(easy), "genuineOrBenign": len(clean),
            "detectionRate": round(sum(flagged(d) for d in tam) / max(1, len(tam)), 3),
            "detectionRateNonHard": round(sum(flagged(d) for d in easy) / max(1, len(easy)), 3),
            "localised": round(sum(flagged(d, True) for d in tam) / max(1, len(tam)), 3),
            "falsePositiveRate": round(sum(flagged(d) for d in clean) / max(1, len(clean)), 3),
            "falseFlagged": [d["id"] for d in clean if flagged(d)],
            "perTamperType": {k: {"caught": v[0], "of": v[1], "missed": v[2]} for k, v in sorted(types.items())},
        }
    with open(os.path.join(ROOT, "tuning.json"), "w") as f:
        json.dump({"tunedOn": ["train", "validation"], "rule": "a Document is flagged if any Measurement >= its Metric's threshold", "metrics": out, "splits": splits}, f, indent=1)
        f.write("\n")
    for m, v in out.items():
        print(f"{m:28s} >= {v['threshold']:<8g} caught {v['trainValCaught']:2d}  false {v['trainValFalse']}  max untouched {v['maxUntouched']}")
    for s, v in splits.items():
        print(f"{s:10s} docs {v['documents']:2d}  detection {v['detectionRate']:.0%} (non-hard {v['detectionRateNonHard']:.0%})  false-positive {v['falsePositiveRate']:.0%}  missed: " + ", ".join(i for t in v["perTamperType"].values() for i in t["missed"]))


if __name__ == "__main__":
    main()

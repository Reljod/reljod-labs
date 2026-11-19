"""Builds the Corpus: originals, Tampers, benign changes and the Manifest.
Run through scripts/render-loupe-corpus.mts. Deterministic: seeded, no clock."""
from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import corpus  # noqa: E402
import forge  # noqa: E402
from corpus import MONTHS, THEMES, fdate, money  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "corpus")
KIND_LABEL = {"payslip": "Payslip", "bank_statement": "Bank statement", "utility_bill": "Utility bill", "invoice": "Invoice", "id_card": "Identity card"}
EDITORS = ["Meridia PDF Editor 4.2", "QuickEdit PDF 11", "PixelForge 2026.1"]
SCAN = {
    "a": dict(scale=1.9, angle=0.35, blur=0.85, noise=2.6, grain=1.6, q=86),
    "b": dict(scale=1.8, angle=-0.5, blur=0.95, noise=3.1, grain=1.9, q=82, paper=(0.95, 0.945, 0.925)),
    "c": dict(scale=1.95, angle=0.2, blur=0.75, noise=2.2, grain=1.3, q=90, paper=(0.97, 0.965, 0.95)),
    "card": dict(scale=2.6, angle=0.6, blur=0.9, noise=2.4, grain=1.4, q=88, margin=56, bed=(226, 228, 230), paper=(0.97, 0.97, 0.965)),
    "card2": dict(scale=2.5, angle=-0.4, blur=0.8, noise=2.9, grain=1.7, q=84, margin=48, bed=(214, 216, 214), paper=(0.965, 0.965, 0.955)),
}


class Orig:
    def __init__(self, oid, split, model, scan=None, seed=0):
        self.id, self.split, self.d = oid, split, model
        self.kind = model["kind"]
        self.theme = THEMES.get(model["theme"])
        self.issuer = self.theme["issuer"] if self.theme else "Republic of Meridia, Civil Registry"
        raw, self.fields, self.size, self.pages = corpus.render(model)
        self.created = forge.pdate(self._date(), 6 + seed % 9, 12 + seed % 40)
        self.producer = self.theme["producer"] if self.theme else "Meridia Civil Registry CardPrint 2"
        self.pdf = forge.stamp(raw, self.producer, self.issuer, self.created, title=self.title())
        self.format = "image" if scan else "pdf"
        self.cfg = None
        if scan:
            self.cfg = dict(SCAN[scan], seed=1000 + seed)
            self.img, self.M = forge.scan(raw, 1, self.cfg)
            self.jpg = forge.jpeg(self.img, self.cfg["q"])
            self.dec = forge.decode(self.jpg)
            self.pages = 1

    def _date(self):
        d = self.d
        return d.get("pay_date") or d.get("bill_date") or d.get("issue") or d.get("end")

    def month(self):
        x = self._date()
        return f"{MONTHS[x.month - 1]} {x.year}"

    def title(self):
        if self.kind == "id_card":
            return "National identity card"
        return f"{KIND_LABEL[self.kind]}, {self.month()}"

    def blurb(self):
        if self.kind == "id_card":
            return "Identity card · Republic of Meridia · scan"
        return f"{KIND_LABEL[self.kind]} · {self.issuer} · {self.month()}" + (" · scan" if self.format == "image" else "")


DOCS: list[dict] = []
FILES: dict[str, bytes] = {}


def add(o: Orig, suffix: str, data: bytes, ext: str, tampers=(), benign=(), hard=False, fmt=None, pages=None):
    did = o.id + (f"-{suffix}" if suffix else "")
    FILES[f"{did}.{ext}"] = data
    DOCS.append(dict(id=did, baseId=o.id, title=o.title(), kind=o.kind, format=fmt or o.format, split=o.split, file=f"{did}.{ext}",
                     pages=pages or o.pages, issuer=o.issuer, tampers=list(tampers), benign=list(benign), hard=hard, featured=False, blurb=o.blurb()))


def tamper(ttype, page, box, field, frm, to):
    return dict(type=ttype, page=page, box=[round(float(v), 5) for v in box], field=field, **{"from": frm, "to": to})


def diff(o: Orig, fields: dict, ttype: str):
    return [tamper(ttype, f["page"], f["box"], k, o.fields[k]["text"], f["text"]) for k, f in fields.items() if k in o.fields and o.fields[k]["text"] != f["text"]]


def later(o: Orig, days: int):
    return forge.pdate(o._date() + dt.timedelta(days=days), 21, 47)


# ---- PDF variants ---------------------------------------------------------------------

def inplace(o, sfx, ttype, overrides=None, mutate=None, editor=None, hard=False, days=6):
    """The run's string replaced where it stands in the content stream: same font resource, same position."""
    d = corpus.clone(o.d)
    if mutate:
        mutate(d)
        corpus.finalize(d)
    raw, fields, _, _ = corpus.render(d, overrides)
    data = forge.stamp(raw, EDITORS[editor] if editor is not None else o.producer, o.issuer, o.created, later(o, days) if editor is not None else None, o.title())
    add(o, sfx, data, "pdf", diff(o, fields, ttype), hard=hard)


def overpaint(o, sfx, ttype, edits: dict, editor=None, days=4, **opts):
    es = [dict(page=o.fields[k]["page"], field=o.fields[k], text=v, name=k, **opts) for k, v in edits.items()]
    data = forge.overlay(o.pdf, o.size, es)
    data = forge.stamp(data, EDITORS[editor] if editor is not None else o.producer, o.issuer, o.created, later(o, days) if editor is not None else None, o.title())
    add(o, sfx, data, "pdf", [tamper(ttype, e["page"], e["box"], e["name"], e["field"]["text"], e["text"]) for e in es])


def incr(o, sfx, ttype, overrides, editor=None, days=11):
    raw, fields, _, _ = corpus.render(o.d, overrides)
    ts = diff(o, fields, ttype)
    data = forge.incremental(o.pdf, forge.stamp(raw, "x", "x", o.created), sorted({t["page"] for t in ts}),
                             EDITORS[editor] if editor is not None else None, later(o, days))
    add(o, sfx, data, "pdf", ts)


def resave(o, sfx, linearize):
    when = later(o, 3)
    data = forge.stamp(o.pdf, "Meridia Office Print to PDF 2.4", "Meridia Office Writer", when, when, o.title(), linearize=linearize, objstreams=not linearize)
    add(o, sfx, data, "pdf", benign=["resave_pdf"])


def screenshot(o, sfx, scale=1.55, q=91):
    add(o, sfx, forge.jpeg(forge.render_page(o.pdf, 1, scale), q), "jpg", benign=["screenshot"], fmt="image", pages=1)


# ---- image variants ---------------------------------------------------------------------

def img_add(o, sfx, arr, q, tampers=(), benign=()):
    add(o, sfx, forge.jpeg(arr, q), "jpg", tampers, benign)


def pasted(o, sfx, edits: dict, q):
    img, ts = o.dec, []
    for k, v in edits.items():
        img, b = forge.pasted_patch(img, o.fields[k], v, o.M, o.cfg["scale"])
        ts.append(tamper("pasted_patch", 1, forge.norm(b, img.shape), k, o.fields[k]["text"], v))
    img_add(o, sfx, img, q, ts)


def copyblk(o, sfx, src, dst, q):
    img, b = forge.copy_block(o.dec, o.fields[src]["pt"], o.fields[dst]["pt"], o.M, o.fields[dst]["align"])
    img_add(o, sfx, img, q, [tamper("copy_move", 1, forge.norm(b, img.shape), dst, o.fields[dst]["text"], o.fields[src]["text"])])


def copychars(o, sfx, dst, new, q):
    """Each changed character of `dst` is a copy of the same character printed elsewhere on the page."""
    f = o.fields[dst]
    img, boxes = o.dec, []
    for i, (a, c) in enumerate(zip(f["text"], new)):
        if a == c:
            continue
        src = next((s, s["text"].index(c)) for k, s in sorted(o.fields.items()) if k != dst and c in s["text"] and s["font"] == f["font"] and abs(s["size"] - f["size"]) < 0.01)
        img, b = forge.copy_char(img, src[0], src[1], f, i, o.M)
        boxes.append(b)
    b = [min(x[0] for x in boxes), min(x[1] for x in boxes), max(x[2] for x in boxes), max(x[3] for x in boxes)]
    img_add(o, sfx, img, q, [tamper("copy_move", 1, forge.norm(b, img.shape), dst, f["text"], new)])


def resaved(o, sfx, name, new, q_region, q):
    img, b = forge.matched_text(o.dec, o.fields[name], new, o.M, o.cfg["scale"], o.cfg, o.cfg["seed"] + 31)
    reg = [max(0, b[0] - 70), max(0, b[1] - 26), min(img.shape[1], b[2] + 30), min(img.shape[0], b[3] + 26)]
    img = forge.resave_region(img, reg, q_region)
    img_add(o, sfx, img, q, [tamper("resaved_region", 1, forge.norm(reg, img.shape), name, o.fields[name]["text"], new)])


def spliced(o, sfx, name, new, q_donor, q):
    raw, fields, _, _ = corpus.render(o.d, {name: {"text": new}})
    donor, _ = forge.scan(raw, 1, o.cfg, donor=True)
    donor = forge.donor_jpeg(donor, q_donor)
    b = forge.px_box(fields[name]["pt"], o.M, 7)
    b0 = forge.px_box(o.fields[name]["pt"], o.M, 7)
    b = [min(b[0], b0[0]), min(b[1], b0[1]), max(b[2], b0[2]), max(b[3], b0[3])]
    img = forge.splice(o.dec, donor, b)
    img_add(o, sfx, img, q, [tamper("recompressed_splice", 1, forge.norm(b, img.shape), name, o.fields[name]["text"], new)])


def rescanned(o, sfx, resize, q, blur=0.0):
    img_add(o, sfx, forge.rescan(o.dec, dict(resize=resize, blur=blur)), q, benign=["rescan"])


def bad_iban(s: str) -> str:
    digits = [c for c in s]
    i = len(digits) - 2
    digits[i] = str((int(digits[i]) + 3) % 10)
    j = len(digits) - 7
    digits[j] = str((int(digits[j]) + 5) % 10)
    return "".join(digits)


def plan():
    f = lambda v: money(v)  # noqa: E731
    # ---- train
    o = Orig("lp-tr-payslip-01", "train", corpus.make_payslip(11, "tidewater", 3), seed=1)
    add(o, "", o.pdf, "pdf")
    inplace(o, "t1", "text_edit", {"net": {"text": f(o.d["net"] + 1900)}})
    overpaint(o, "t2", "overpaint_edit", {"earn.0": f(o.d["earnings"][0][1] + 2400), "earn_total": f(o.d["gross"] + 2400)}, editor=0)
    inplace(o, "t3", "text_edit", mutate=lambda d: d["earnings"][0].__setitem__(1, d["earnings"][0][1] + 1500), hard=True)
    resave(o, "b1", linearize=True)

    o = Orig("lp-tr-statement-01", "train", corpus.make_statement(12, "pssb", 4, 34), seed=2)
    add(o, "", o.pdf, "pdf")
    k = len(o.d["tx"]) // 3
    incr(o, "t1", "incremental_update", {f"tx.{k}.amt": {"text": f(o.d["tx"][k][3] + 4000)}}, editor=1)
    j = len(o.d["tx"]) - 2
    inplace(o, "t2", "date_change", {f"tx.{j}.date": {"text": fdate(o.d["end"] + dt.timedelta(days=9), "short")}})
    resave(o, "b1", linearize=False)

    o = Orig("lp-tr-invoice-01", "train", corpus.make_invoice(13, "saltmarsh", 5), seed=3)
    add(o, "", o.pdf, "pdf")
    inplace(o, "t1", "payee_change", {"iban": {"text": bad_iban(o.d["iban"])}, "payee": {"text": "Saltmarsh Print Works (Holdings)"}})
    d2 = corpus.clone(o.d)
    d2["items"][0][3] = corpus.r2(d2["items"][0][3] - 300 if d2["items"][0][3] > 400 else d2["items"][0][3] + 300)
    corpus.finalize(d2)
    sub = {"font": "Vera", "dsize": 0.35, "dy": 0.9}
    inplace(o, "t2", "font_substitution", {"item.0.amt": {"text": f(d2["items"][0][3]), **sub}, "subtotal": {"text": f(d2["subtotal"]), **sub},
                                           "vat": {"text": f(d2["vat"]), **sub}, "total": {"text": f(d2["total"]), "font": "Vera-B", "dsize": 0.35, "dy": 0.9}})
    screenshot(o, "b1")

    o = Orig("lp-tr-bill-01", "train", corpus.make_bill(14, "halcyon", 6), scan="a", seed=4)
    add(o, "", o.jpg, "jpg")
    low = f(round(o.d["amount_due"] * 0.31, 2))
    pasted(o, "t1", {"amount_due": low, "amount_due_big": "M$ " + low}, 87)
    copyblk(o, "t2", "line.2", "total", 86)
    rescanned(o, "b1", 0.93, 80)

    o = Orig("lp-tr-payslip-02", "train", corpus.make_payslip(15, "corvane", 7), scan="b", seed=5)
    add(o, "", o.jpg, "jpg")
    spliced(o, "t1", "net", f(o.d["net"] + 2300), 60, 84)
    resaved(o, "t2", "earn_total", f(o.d["gross"] + 1800), 48, 93)

    o = Orig("lp-tr-idcard-01", "train", corpus.make_idcard(16, "blue"), scan="card", seed=6)
    add(o, "", o.jpg, "jpg")
    dob = o.d["dob"]
    pasted(o, "t1", {"dob": fdate(dob.replace(year=dob.year + 9), "short").upper()}, 88)
    rescanned(o, "b1", 0.9, 78, blur=0.5)

    # ---- validation
    o = Orig("lp-va-statement-01", "validation", corpus.make_statement(21, "lqcu", 2, 22), seed=7)
    add(o, "", o.pdf, "pdf")
    overpaint(o, "t1", "overpaint_edit", {"closing": f(o.d["closing"] + 12000), "closing_row": f(o.d["closing"] + 12000)}, editor=1)
    inplace(o, "t2", "payee_change", mutate=lambda d: d.__setitem__("name", "Leandro Whitlow-Marchetti"), hard=True)
    resave(o, "b1", linearize=True)

    o = Orig("lp-va-bill-01", "validation", corpus.make_bill(22, "halcyon", 8), seed=8)
    add(o, "", o.pdf, "pdf")
    inplace(o, "t1", "date_change", {"bill_date": {"text": fdate(o.d["due_date"] + dt.timedelta(days=40), "long")}})
    incr(o, "t2", "incremental_update", {"amount_due": {"text": "0.00"}, "amount_due_big": {"text": "M$ 0.00"}}, editor=2)

    o = Orig("lp-va-invoice-01", "validation", corpus.make_invoice(23, "greywether", 9), scan="c", seed=9)
    add(o, "", o.jpg, "jpg")
    pasted(o, "t1", {"total": f(o.d["total"] + 5000)}, 90)
    spliced(o, "t2", "iban", bad_iban(o.d["iban"]), 64, 88)
    rescanned(o, "b1", 0.95, 84)

    o = Orig("lp-va-idcard-01", "validation", corpus.make_idcard(24, "green"), scan="card2", seed=10)
    add(o, "", o.jpg, "jpg")
    resaved(o, "t1", "surname", "HARTWELL" if o.d["surname"] != "HARTWELL" else "SORENSEN", 52, 92)
    ex = fdate(o.d["expiry"], "short").upper()
    want = ex[:-1] + next(c for c in "9876543210" if c != ex[-1] and any(c in s["text"] for k, s in o.fields.items() if k != "expiry" and s["font"] == "Sans-B"))
    copychars(o, "t2", "expiry", want, 85)

    # ---- test
    o = Orig("lp-te-payslip-01", "test", corpus.make_payslip(31, "corvane", 9), seed=11)
    add(o, "", o.pdf, "pdf")
    inplace(o, "t1", "text_edit", {"earn_total": {"text": f(o.d["gross"] + 3000)}}, editor=0)
    inplace(o, "t2", "font_substitution", {"net": {"text": f(o.d["net"] + 1200), "font": "Sans-B", "dy": -0.8}})

    def shift(d):
        for key in ("start", "end", "pay_date"):
            d[key] = d[key].replace(month=d[key].month + 2)
    inplace(o, "t3", "date_change", mutate=shift, hard=True)
    resave(o, "b1", linearize=False)

    o = Orig("lp-te-statement-01", "test", corpus.make_statement(32, "pssb", 10, 64), seed=12)
    add(o, "", o.pdf, "pdf")
    k = len(o.d["tx"]) // 3
    incr(o, "t1", "incremental_update", {f"tx.{k}.amt": {"text": f(o.d["tx"][k][3] + 3000)}, f"tx.{k}.bal": {"text": f(o.d["bal"][k] + 3000)}})
    overpaint(o, "t2", "payee_change", {"iban": bad_iban(o.d["iban"]), "name": "Desmond Kovalenko"}, editor=1)
    screenshot(o, "b1", 1.5, 90)

    o = Orig("lp-te-bill-01", "test", corpus.make_bill(33, "brightline", 11), scan="b", seed=13)
    add(o, "", o.jpg, "jpg")
    pasted(o, "t1", {"name": "Matteo Estrada"}, 84)
    resaved(o, "t2", "amount_due", f(round(o.d["amount_due"] * 0.2, 2)), 55, 91)
    rescanned(o, "b1", 0.92, 76)

    o = Orig("lp-te-idcard-01", "test", corpus.make_idcard(34, "blue"), scan="card", seed=14)
    add(o, "", o.jpg, "jpg")
    spliced(o, "t1", "dob", fdate(o.d["dob"].replace(year=o.d["dob"].year - 12), "short").upper(), 58, 86)
    no = o.d["doc_no"]
    want = no[:-2] + next(c for c in "9876543210" if c != no[-2] and any(c in s["text"] for k, s in o.fields.items() if k != "doc_no" and s["font"] == "Sans-B")) + no[-1]
    copychars(o, "t2", "doc_no", want, 88)


FEATURED = [
    "lp-tr-payslip-01", "lp-tr-payslip-01-t2", "lp-tr-bill-01-t1", "lp-tr-idcard-01-b1",
    "lp-va-statement-01-t1", "lp-va-bill-01-t2", "lp-va-invoice-01", "lp-va-invoice-01-t2", "lp-va-idcard-01-t2",
    "lp-te-payslip-01-t2", "lp-te-statement-01-t1", "lp-te-statement-01-b1", "lp-te-bill-01-t1", "lp-te-idcard-01-t1",
]


def main():
    plan()
    ids = [d["id"] for d in DOCS]
    assert len(set(ids)) == len(ids)
    for fid in FEATURED:
        next(d for d in DOCS if d["id"] == fid)["featured"] = True
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    for name, data in FILES.items():
        with open(os.path.join(OUT, name), "wb") as fh:
            fh.write(data)
    with open(os.path.join(ROOT, "manifest.json"), "w") as fh:
        json.dump({"version": 1, "generatedBy": "fixtures/loupe/generate/build.py", "documents": DOCS}, fh, indent=1)
        fh.write("\n")
    total = sum(len(v) for v in FILES.values())
    print(f"corpus: {len(DOCS)} documents, {total / 1e6:.1f} MB, {sum(1 for d in DOCS if d['tampers'])} tampered, {sum(1 for d in DOCS if d['benign'])} benign")


if __name__ == "__main__":
    main()

"""Data models and page templates of the Corpus. Everything is invented and
set in the fictional Republic of Meridia; every page carries SPECIMEN."""
from __future__ import annotations

import copy
import datetime as dt
import math
import random

from loupe import ids
from sheet import GREY, INK, WHITE, Sheet, hexc, width

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
GIVEN = ["Amara", "Tobias", "Ilse", "Rafael", "Noor", "Callum", "Mirela", "Desmond", "Yuki", "Helena", "Osric", "Tamsin", "Leandro", "Priya", "Edda", "Matteo"]
SURNAMES = ["Vandermeer", "Okonjo", "Castellane", "Hartwell", "Sorensen", "Adeyemi", "Linhart", "Moreau", "Tanaka", "Brannock", "Estrada", "Kovalenko", "Whitlow", "Marchetti"]
STREETS = ["Lantern Quay", "Saltmarsh Row", "Cooper's Wharf", "Almond Terrace", "Foundry Lane", "Heron Street", "Customs House Road", "Tidewater Parade", "Gull Passage", "Old Signal Hill"]
TOWNS = ["Port Selene", "Halcyon Bay", "Corvane", "Greywether", "Saint Aurel", "Brightline"]
BANKS = [("PSSB", "Port Selene Savings Bank"), ("LQCU", "Lantern Quay Credit Union"), ("MMBK", "Meridia Mutual Bank"), ("HBTC", "Halcyon Bay Trust Company")]

THEMES = {
    "tidewater": dict(issuer="Tidewater Logistics Ltd", addr="14 Customs House Road, Port Selene MR1-2040", accent="#1d4e89", head="Sans-B", body="Sans", num="Sans", datefmt="long", producer="Tidewater Payroll Engine 7.3", band=True),
    "corvane": dict(issuer="Corvane Shipyards plc", addr="Dry Dock 3, Foundry Lane, Corvane MR4-0117", accent="#7a2e2a", head="Serif-B", body="Serif", num="Mono", datefmt="short", producer="Corvane HR Suite / PayPrint 2.9", band=False),
    "pssb": dict(issuer="Port Selene Savings Bank", addr="1 Lantern Quay, Port Selene MR1-0001", accent="#0f5c4d", head="Sans-B", body="Sans", num="Sans", datefmt="short", producer="PSSB CoreStatements 12.1", band=True),
    "lqcu": dict(issuer="Lantern Quay Credit Union", addr="88 Heron Street, Halcyon Bay MR2-3310", accent="#4a3b7c", head="Serif-B", body="Serif", num="Mono", datefmt="num", producer="LQCU eStatement Renderer 4.0", band=False),
    "halcyon": dict(issuer="Halcyon Water & Power", addr="PO Box 220, Halcyon Bay MR2-0220", accent="#0b6e99", head="Vera-B", body="Vera", num="Vera", datefmt="long", producer="Halcyon BillRun 5.4", band=True),
    "brightline": dict(issuer="Brightline Telecom", addr="5 Old Signal Hill, Brightline MR6-1500", accent="#c2571a", head="Sans-B", body="Sans", num="Mono", datefmt="short", producer="Brightline Billing Composer 3.1", band=False),
    "saltmarsh": dict(issuer="Saltmarsh Print Works", addr="27 Saltmarsh Row, Port Selene MR1-5512", accent="#2f5d3a", head="Serif-B", body="Sans", num="Sans", datefmt="long", producer="Saltmarsh Ledger Invoicing 6.2", band=False),
    "greywether": dict(issuer="Greywether Timber Supply", addr="Yard 9, Gull Passage, Greywether MR5-0730", accent="#5b4a2f", head="Sans-B", body="Sans", num="Sans", datefmt="num", producer="Greywether TradeDesk 1.8", band=True),
}


def money(v: float) -> str:
    return f"{v:,.2f}"


def fdate(d: dt.date, style: str) -> str:
    if style == "long":
        return f"{d.day} {MONTHS[d.month - 1]} {d.year}"
    if style == "short":
        return f"{d.day:02d} {MONTHS[d.month - 1][:3]} {d.year}"
    return f"{d.day:02d}/{d.month:02d}/{d.year}"


def person(r: random.Random):
    return r.choice(GIVEN), r.choice(SURNAMES)


def address(r: random.Random) -> str:
    t = r.randrange(len(TOWNS))
    return f"{r.randint(2, 96)} {r.choice(STREETS)}, {TOWNS[t]} MR{t + 1}-{r.randint(100, 9899):04d}"


def iban(r: random.Random, bank=None) -> tuple[str, str]:
    code, name = bank or r.choice(BANKS)
    acct = "".join(str(r.randint(0, 9)) for _ in range(12))
    s = f"MR{ids.iban_check_digits(code, acct)}{code}{acct}"
    return " ".join(s[i : i + 4] for i in range(0, 20, 4)), name


def tax_id(r: random.Random) -> str:
    d = "".join(str(r.randint(0, 9)) for _ in range(8))
    d += str(ids.luhn_digit(d))
    return f"{d[:3]}-{d[3:6]}-{d[6:]}"


def national_id(r: random.Random) -> str:
    d = "".join(str(r.randint(0, 9)) for _ in range(7))
    return f"MRD{d}{ids.icao_digit(d)}"


def r2(v):
    return round(v + 1e-9, 2)


# ---- models ---------------------------------------------------------------------

def make_payslip(seed: int, theme: str, month: int) -> dict:
    r = random.Random(seed)
    g, s = person(r)
    start = dt.date(2026, month, 1)
    end = (start + dt.timedelta(days=32)).replace(day=1) - dt.timedelta(days=1)
    basic = r.randint(260, 520) * 10.0
    ib, bank = iban(r)
    d = dict(kind="payslip", theme=theme, name=f"{g} {s}", addr=address(r), emp_no=f"E-{r.randint(10000, 99999)}",
             dept=r.choice(["Harbour Operations", "Fabrication", "Fleet Planning", "Stores & Dispatch"]), tin=tax_id(r), nid=national_id(r),
             start=start, end=end, pay_date=end - dt.timedelta(days=r.randint(0, 3)), iban=ib, bank=bank,
             earnings=[["Basic salary", basic], ["Overtime", r2(r.randint(4, 22) * basic / 160 * 1.5)], ["Shift allowance", r.randint(8, 30) * 10.0]],
             tax_rate=r.choice([0.16, 0.18, 0.2]), employer_tin=tax_id(r))
    if r.random() < 0.5:
        d["earnings"].append(["Harbour bonus", r.randint(10, 60) * 10.0])
    return finalize(d)


def make_statement(seed: int, theme: str, month: int, rows: int) -> dict:
    r = random.Random(seed)
    g, s = person(r)
    code = "PSSB" if theme == "pssb" else "LQCU"
    ib, bank = iban(r, (code, dict(BANKS)[code]))
    start = dt.date(2026, month, 1)
    end = (start + dt.timedelta(days=32)).replace(day=1) - dt.timedelta(days=1)
    outs = ["Card payment - Saint Aurel Market", "Direct debit - Halcyon Water & Power", "Card payment - Gull Passage Bakery", "Standing order - Almond Terrace Lettings",
            "Card payment - Corvane Ferry Co", "Direct debit - Brightline Telecom", "ATM withdrawal - Lantern Quay", "Card payment - Tidewater Fuel", "Transfer to savings pot",
            "Card payment - Old Signal Books", "Direct debit - Meridia Mutual Insurance"]
    ins = ["Salary - Tidewater Logistics Ltd", "Transfer from H. Moreau", "Refund - Corvane Ferry Co", "Interest paid"]
    days = sorted(r.randint(1, end.day) for _ in range(rows))
    tx = []
    for i, day in enumerate(days):
        if i == rows // 3 or (i == rows - 3) or r.random() < 0.08:
            tx.append([start.replace(day=day), ins[0] if i == rows // 3 else r.choice(ins[1:]), 0.0, r2(r.randint(2200, 4800) if i == rows // 3 else r.uniform(12, 380))])
        else:
            tx.append([start.replace(day=day), r.choice(outs), r2(r.uniform(4.5, 420)), 0.0])
    d = dict(kind="bank_statement", theme=theme, name=f"{g} {s}", addr=address(r), iban=ib, bank=bank, start=start, end=end,
             opening=r2(r.uniform(900, 5200)), tx=tx, acct_type=r.choice(["Everyday Current Account", "Harbour Saver Plus"]))
    return finalize(d)


def make_bill(seed: int, theme: str, month: int) -> dict:
    r = random.Random(seed)
    g, s = person(r)
    start = dt.date(2026, month, 1)
    end = (start + dt.timedelta(days=32)).replace(day=1) - dt.timedelta(days=1)
    ib, bank = iban(r)
    if theme == "halcyon":
        prev = r.randint(18000, 52000)
        usage = r.randint(180, 640)
        rate = r.choice([0.214, 0.238, 0.251])
        lines = [[f"Energy charge ({usage} kWh at M$ {rate:.3f})", r2(usage * rate)], [f"Standing charge ({end.day} days at M$ 0.42)", r2(end.day * 0.42)], ["Water and wastewater", r2(r.uniform(18, 44))]]
        extra = dict(meter=f"HW-{r.randint(100000, 999999)}", prev_read=prev, curr_read=prev + usage, usage=usage, levy_label="Meridia energy levy", levy_rate=0.05)
    else:
        lines = [["Fibre 500 broadband", 42.0], ["Mobile plan - Unlimited Meridia", 24.5], ["Calls outside plan", r2(r.uniform(1, 19))], ["Router rental", 3.5]]
        extra = dict(meter=None, levy_label="VAT", levy_rate=0.12)
    d = dict(kind="utility_bill", theme=theme, name=f"{g} {s}", addr=address(r), account=f"{r.randint(1000, 9999)} {r.randint(1000, 9999)} {r.randint(10, 99)}",
             start=start, end=end, bill_date=end + dt.timedelta(days=r.randint(2, 5)), lines=lines, prev_balance=r2(r.uniform(40, 160)), iban=ib, bank=bank, **extra)
    d["payment"] = d["prev_balance"]
    d["due_date"] = d["bill_date"] + dt.timedelta(days=21)
    d["history"] = [r.randint(30, 100) for _ in range(12)]
    return finalize(d)


def make_invoice(seed: int, theme: str, month: int) -> dict:
    r = random.Random(seed)
    g, s = person(r)
    ib, bank = iban(r)
    if theme == "saltmarsh":
        pool = [("A5 folded leaflets, 150 gsm", 0.18), ("Business cards, letterpress, box of 250", 38.0), ("A2 posters, satin", 4.6), ("Perfect-bound booklets, 48 pp", 3.95), ("Artwork set-up", 65.0), ("Courier to Halcyon Bay", 14.5)]
    else:
        pool = [("Oak board 25 x 150 mm, per metre", 11.4), ("Treated pine joist 47 x 150 mm, per metre", 6.85), ("Marine plywood 18 mm sheet", 58.0), ("Decking screws, box of 500", 21.5), ("Delivery, Greywether district", 35.0), ("Cedar shingles, bundle", 44.25)]
    items = []
    for desc, unit in r.sample(pool, r.randint(4, 5)):
        q = r.choice([1, 2, 4, 6, 12, 25, 50, 250, 500]) if unit < 20 else r.randint(1, 8)
        items.append([q, desc, unit, r2(q * unit)])
    issue = dt.date(2026, month, r.randint(3, 24))
    d = dict(kind="invoice", theme=theme, bill_to=r.choice(["Heron Street Bindery", "Almond Terrace Café", "Corvane Rowing Club", "Old Signal Hill Books", "Gull Passage Joinery"]),
             bill_addr=address(r), contact=f"{g} {s}", number=f"INV-{r.randint(2000, 9800)}", po=f"PO {r.randint(100, 999)}-{r.randint(10, 99)}",
             issue=issue, due=issue + dt.timedelta(days=30), items=items, vat_rate=0.12, iban=ib, bank=bank, tin=tax_id(r))
    return finalize(d)


def make_idcard(seed: int, series: str) -> dict:
    r = random.Random(seed)
    g, s = person(r)
    g2 = r.choice(GIVEN)
    dob = dt.date(r.randint(1962, 2003), r.randint(1, 12), r.randint(1, 28))
    issue = dt.date(r.randint(2019, 2025), r.randint(1, 12), r.randint(1, 28))
    d = dict(kind="id_card", theme=series, surname=s.upper(), given=f"{g} {g2}".upper(), dob=dob, sex=r.choice("MF"), doc_no=national_id(r),
             issue=issue, expiry=issue.replace(year=issue.year + 10), place=r.choice(TOWNS).upper(), seed=seed)
    return finalize(d)


def finalize(d: dict) -> dict:
    """Recomputes everything that depends on something else, so a model is always consistent."""
    k = d["kind"]
    if k == "payslip":
        d["gross"] = r2(sum(a for _, a in d["earnings"]))
        g = d["gross"]
        d["deductions"] = [["Income tax (PAYE)", r2(g * d["tax_rate"] - 180), None], ["Social insurance (4.5% of gross pay)", r2(g * 0.045), 0.045],
                           ["Pension contribution (5.0% of gross pay)", r2(g * 0.05), 0.05], ["Union dues", 18.0, None]]
        d["total_ded"] = r2(sum(a for _, a, _ in d["deductions"]))
        d["net"] = r2(g - d["total_ded"])
    elif k == "bank_statement":
        bal = d["opening"]
        d["bal"] = []
        for _, _, o, i in d["tx"]:
            bal = r2(bal - o + i)
            d["bal"].append(bal)
        d["paid_in"] = r2(sum(t[3] for t in d["tx"]))
        d["paid_out"] = r2(sum(t[2] for t in d["tx"]))
        d["closing"] = bal
    elif k == "utility_bill":
        d["subtotal"] = r2(sum(a for _, a in d["lines"]))
        d["levy"] = r2(d["subtotal"] * d["levy_rate"])
        d["total"] = r2(d["subtotal"] + d["levy"])
        d["amount_due"] = r2(d["total"] + d["prev_balance"] - d["payment"])
    elif k == "invoice":
        d["subtotal"] = r2(sum(i[3] for i in d["items"]))
        d["vat"] = r2(d["subtotal"] * d["vat_rate"])
        d["total"] = r2(d["subtotal"] + d["vat"])
    elif k == "id_card":
        def ymd(x):
            return f"{x.year % 100:02d}{x.month:02d}{x.day:02d}"
        no = d["doc_no"][:9]
        l1 = f"I<MRD{no}{ids.icao_digit(no)}".ljust(30, "<")
        b, e = ymd(d["dob"]), ymd(d["expiry"])
        l2 = f"{b}{ids.icao_digit(b)}{d['sex']}{e}{ids.icao_digit(e)}MRD".ljust(29, "<")
        l2 += str(ids.icao_digit(l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29]))
        l3 = (d["surname"] + "<<" + d["given"].replace(" ", "<")).ljust(30, "<")[:30]
        d["mrz"] = [l1, l2, l3]
    return d


# ---- templates ---------------------------------------------------------------------

def _header(sh: Sheet, t: dict, title: str, sub: str = ""):
    acc = hexc(t["accent"])
    if t["band"]:
        sh.rect(0, 0, sh.W, 86, fill=acc)
        sh.text(40, 44, t["issuer"], t["head"], 19, WHITE, bg=acc)
        sh.text(40, 62, t["addr"], t["body"], 8.2, (0.88, 0.92, 0.95), bg=acc)
        sh.text(sh.W - 40, 44, title.upper(), t["head"], 13, WHITE, "r", bg=acc)
        if sub:
            sh.text(sh.W - 40, 62, sub, t["body"], 8.2, (0.88, 0.92, 0.95), "r", bg=acc)
        return 118
    sh.circle(52, 50, 13, fill=acc)
    sh.text(52, 54.5, t["issuer"][0], t["head"], 14, WHITE, "c", bg=acc)
    sh.text(74, 47, t["issuer"], t["head"], 18, INK)
    sh.text(74, 61, t["addr"], t["body"], 8.2, GREY)
    sh.text(sh.W - 40, 47, title.upper(), t["head"], 13, acc, "r")
    if sub:
        sh.text(sh.W - 40, 61, sub, t["body"], 8.2, GREY, "r")
    sh.line(40, 78, sh.W - 40, 78, acc, 1.6)
    sh.line(40, 81, sh.W - 40, 81, acc, 0.5)
    return 112


def _kv(sh, x, y, k, v, t, field=None, kw=92, size=8.8):
    sh.text(x, y, k, t["body"], 7.6, GREY)
    sh.text(x + kw, y, v, t["body"], size, INK, field=field)


def _eyebrow(sh, x, y, s, t):
    sh.text(x, y, s.upper(), t["head"], 7.4, hexc(t["accent"]), charspace=0.6)


def _footer(sh, t, note):
    sh.line(40, sh.H - 52, sh.W - 40, sh.H - 52, (0.8, 0.8, 0.82), 0.5)
    sh.text(40, sh.H - 38, note, t["body"], 7.2, GREY)
    sh.text(sh.W - 40, sh.H - 38, f"SPECIMEN - not a real document - page {sh.page}", t["body"], 7.2, GREY, "r")


def draw_payslip(sh: Sheet, d: dict):
    t = THEMES[d["theme"]]
    acc = hexc(t["accent"])
    ds = t["datefmt"]
    y = _header(sh, t, "Payslip", f"Pay period {fdate(d['start'], ds)} to {fdate(d['end'], ds)}")
    _eyebrow(sh, 40, y, "Employee", t)
    _eyebrow(sh, 320, y, "Payment", t)
    y += 16
    for i, (k, v, f) in enumerate([("Name", d["name"], "name"), ("Employee no.", d["emp_no"], None), ("Department", d["dept"], None), ("Tax ID", d["tin"], "tin"), ("National ID", d["nid"], "nid")]):
        _kv(sh, 40, y + i * 14, k, v, t, f)
    for i, (k, v, f) in enumerate([("Pay period", f"{fdate(d['start'], ds)} to {fdate(d['end'], ds)}", "period"), ("Pay date", fdate(d["pay_date"], ds), "pay_date"), ("Paid to", d["iban"], "iban"), ("Bank", d["bank"], None), ("Method", "Bank transfer", None)]):
        _kv(sh, 320, y + i * 14, k, v, t, f, kw=62)
    y += 5 * 14 + 22
    X0, X1 = 40, sh.W - 40

    def table(title, rows, total_label, total, prefix, y):
        sh.rect(X0, y, X1 - X0, 20, fill=acc if t["band"] else (0.93, 0.93, 0.95))
        hc = WHITE if t["band"] else INK
        hb = acc if t["band"] else (0.93, 0.93, 0.95)
        sh.text(X0 + 8, y + 13.5, title, t["head"], 9, hc, bg=hb)
        sh.text(X1 - 8, y + 13.5, "Amount (M$)", t["head"], 9, hc, "r", bg=hb)
        y += 20
        for i, row in enumerate(rows):
            y += 18
            sh.text(X0 + 8, y - 5, row[0], t["body"], 9.2)
            sh.text(X1 - 8, y - 5, money(row[1]), t["num"], 9.2, align="r", field=f"{prefix}.{i}")
            sh.line(X0, y, X1, y, (0.86, 0.86, 0.88), 0.4)
        y += 20
        sh.text(X0 + 8, y - 6, total_label, t["head"], 9.6)
        sh.text(X1 - 8, y - 6, money(total), t["head"] if t["num"] != "Mono" else "Mono-B", 9.6, align="r", field=prefix + "_total")
        sh.line(X0, y, X1, y, INK, 0.9)
        return y + 18

    y = table("Earnings", d["earnings"], "Gross pay", d["gross"], "earn", y)
    y = table("Deductions", d["deductions"], "Total deductions", d["total_ded"], "ded", y)
    y += 6
    sh.rect(X0, y, X1 - X0, 46, fill=(0.955, 0.96, 0.97), stroke=acc, lw=1.2)
    sh.text(X0 + 14, y + 29, "Net pay", t["head"], 13, INK, bg=(0.955, 0.96, 0.97))
    sh.text(X1 - 14, y + 29, money(d["net"]), t["head"] if t["num"] != "Mono" else "Mono-B", 15, INK, "r", field="net", bg=(0.955, 0.96, 0.97))
    sh.text(X1 - 14 - width(money(d["net"]), t["head"] if t["num"] != "Mono" else "Mono-B", 15) - 8, y + 29, "M$", t["body"], 9, GREY, "r", bg=(0.955, 0.96, 0.97))
    y += 70
    sh.text(X0, y, f"Employer Tax ID {d['employer_tin']}. Tax and social insurance are withheld under the Meridia Revenue Code.", t["body"], 7.6, GREY)
    sh.text(X0, y + 11, "Keep this payslip: lenders and public offices may ask for it as proof of income.", t["body"], 7.6, GREY)
    _footer(sh, t, f"{t['issuer']} - payroll")


def draw_statement(sh: Sheet, d: dict):
    t = THEMES[d["theme"]]
    acc = hexc(t["accent"])
    ds = t["datefmt"]
    X0, X1 = 40, sh.W - 40
    cols = dict(date=X0 + 6, desc=X0 + 78, out=X1 - 176, inn=X1 - 92, bal=X1 - 6)
    names = ("Date", "Description", "Paid out", "Paid in", "Balance") if d["theme"] == "pssb" else ("Date", "Details", "Withdrawals", "Deposits", "Balance")

    def head(y):
        sh.rect(X0, y, X1 - X0, 19, fill=acc)
        for key, nm, al in zip(("date", "desc", "out", "inn", "bal"), names, "llrrr"):
            sh.text(cols[key], y + 13, nm, t["head"], 8.4, WHITE, al, bg=acc)
        return y + 19

    y = _header(sh, t, "Statement of account", d["acct_type"])
    sh.text(X0, y, d["name"], t["head"], 10.5, field="name")
    for i, part in enumerate(d["addr"].split(", ")):
        sh.text(X0, y + 13 + i * 11.5, part, t["body"], 8.8)
    _kv(sh, 330, y, "IBAN", d["iban"], t, "iban", kw=84)
    _kv(sh, 330, y + 14, "Statement period", f"{fdate(d['start'], ds)} to {fdate(d['end'], ds)}", t, "period", kw=84)
    _kv(sh, 330, y + 28, "Statement date", fdate(d["end"], ds), t, None, kw=84)
    y += 58
    bw = (X1 - X0 - 18) / 4
    for i, (k, v, f) in enumerate([("Opening balance", d["opening"], "opening"), ("Total paid in" if d["theme"] == "pssb" else "Total deposits", d["paid_in"], "paid_in"),
                                   ("Total paid out" if d["theme"] == "pssb" else "Total withdrawals", d["paid_out"], "paid_out"), ("Closing balance", d["closing"], "closing")]):
        bx = X0 + i * (bw + 6)
        sh.rect(bx, y, bw, 40, fill=(0.955, 0.96, 0.965))
        sh.text(bx + 8, y + 14, k, t["body"], 7.6, GREY, bg=(0.955, 0.96, 0.965))
        sh.text(bx + bw - 8, y + 30, money(v), t["num"], 10.5, INK, "r", field=f, bg=(0.955, 0.96, 0.965))
    y += 58
    y = head(y)
    y += 17
    sh.text(cols["desc"], y - 5, "Opening balance", t["body"], 8.6, GREY)
    sh.text(cols["bal"], y - 5, money(d["opening"]), t["num"], 8.6, align="r")
    for i, (date, desc, o, inn) in enumerate(d["tx"]):
        if y > sh.H - 110:
            _footer(sh, t, f"{t['issuer']} is a fictional bank. Continued on the next page.")
            sh.new_page()
            sh.text(X0, 52, f"{t['issuer']} - statement of account, continued", t["head"], 10)
            sh.text(X1, 52, f"{d['name']} - {d['iban']}", t["body"], 8.2, GREY, "r")
            y = head(66) + 0
        y += 17
        bg = (0.972, 0.975, 0.98) if i % 2 == 0 else WHITE
        if i % 2 == 0:
            sh.rect(X0, y - 17, X1 - X0, 17, fill=bg)
        sh.text(cols["date"], y - 5, fdate(date, ds), t["num"], 8.4, field=f"tx.{i}.date", bg=bg)
        sh.text(cols["desc"], y - 5, desc, t["body"], 8.6, bg=bg)
        if o:
            sh.text(cols["out"], y - 5, money(o), t["num"], 8.6, align="r", field=f"tx.{i}.amt", bg=bg)
        else:
            sh.text(cols["inn"], y - 5, money(inn), t["num"], 8.6, align="r", field=f"tx.{i}.amt", bg=bg)
        sh.text(cols["bal"], y - 5, money(d["bal"][i]), t["num"], 8.6, align="r", field=f"tx.{i}.bal", bg=bg)
    y += 19
    sh.line(X0, y - 17, X1, y - 17, INK, 0.8)
    sh.text(cols["desc"], y - 4, "Closing balance", t["head"], 8.8)
    sh.text(cols["bal"], y - 4, money(d["closing"]), t["head"] if t["num"] != "Mono" else "Mono-B", 8.8, align="r", field="closing_row")
    _footer(sh, t, f"{t['issuer']} is a fictional bank. Deposits are not real.")


def draw_bill(sh: Sheet, d: dict):
    t = THEMES[d["theme"]]
    acc = hexc(t["accent"])
    ds = t["datefmt"]
    X0, X1 = 40, sh.W - 40
    y = _header(sh, t, "Your bill", f"Account {d['account']}")
    sh.text(X0, y, d["name"], t["head"], 10.5, field="name")
    for i, part in enumerate(d["addr"].split(", ")):
        sh.text(X0, y + 13 + i * 11.5, part, t["body"], 8.8)
    for i, (k, v, f) in enumerate([("Bill date", fdate(d["bill_date"], ds), "bill_date"), ("Billing period", f"{fdate(d['start'], ds)} to {fdate(d['end'], ds)}", "period"),
                                   ("Payment due", fdate(d["due_date"], ds), "due_date"), ("Account number", d["account"], None)]):
        _kv(sh, 330, y + i * 14, k, v, t, f, kw=78)
    y += 74
    sh.rect(X0, y, X1 - X0, 54, fill=(0.955, 0.96, 0.965), stroke=acc, lw=1.2)
    sh.text(X0 + 14, y + 22, "Amount due", t["head"], 12, bg=(0.955, 0.96, 0.965))
    sh.text(X0 + 14, y + 38, f"Please pay by {fdate(d['due_date'], ds)}", t["body"], 8.4, GREY, bg=(0.955, 0.96, 0.965))
    sh.text(X1 - 14, y + 34, "M$ " + money(d["amount_due"]), t["head"], 18, acc, "r", field="amount_due_big", bg=(0.955, 0.96, 0.965))
    y += 78
    if d["meter"]:
        _eyebrow(sh, X0, y, "Meter readings", t)
        y += 8
        sh.rect(X0, y, X1 - X0, 17, fill=(0.93, 0.93, 0.95))
        hx = [X0 + 8, X0 + 170, X0 + 300, X1 - 8]
        for x, nm, al in zip(hx, ("Meter", "Previous reading", "Current reading", "Usage (kWh)"), "lrrr"):
            sh.text(x, y + 12, nm, t["head"], 8, INK, al, bg=(0.93, 0.93, 0.95))
        y += 32
        for x, v, al in zip(hx, (d["meter"], f"{d['prev_read']:,}", f"{d['curr_read']:,}", f"{d['usage']:,}"), "lrrr"):
            sh.text(x, y - 3, v, t["num"], 8.8, INK, al)
        y += 22
    _eyebrow(sh, X0, y, "Charges for this period", t)
    y += 6
    rows = [(l, a, f"line.{i}", False) for i, (l, a) in enumerate(d["lines"])]
    rows += [("Subtotal", d["subtotal"], "subtotal", True), (f"{d['levy_label']} ({d['levy_rate'] * 100:g}%)", d["levy"], "levy", False), ("Total current charges", d["total"], "total", True),
             ("Previous balance", d["prev_balance"], "prev_balance", False), ("Payment received - thank you", -d["payment"], "payment", False), ("Amount due", d["amount_due"], "amount_due", True)]
    for lab, amt, f, bold in rows:
        y += 18
        sh.text(X0 + 8, y - 5, lab, t["head"] if bold else t["body"], 9.2)
        sh.text(X1 - 8, y - 5, money(amt), (t["head"] if t["num"] != "Mono" else "Mono-B") if bold else t["num"], 9.2, align="r", field=f)
        sh.line(X0, y, X1, y, INK if bold else (0.86, 0.86, 0.88), 0.8 if bold else 0.4)
    y += 30
    _eyebrow(sh, X0, y, "Your last twelve months", t)
    bx = X0
    for i, h in enumerate(d["history"]):
        hh = h * 0.42
        sh.rect(bx + i * 20, y + 52 - hh, 13, hh, fill=acc if i == 11 else (0.80, 0.84, 0.88))
    sh.line(X0, y + 52, X0 + 240, y + 52, GREY, 0.5)
    _eyebrow(sh, 330, y, "How to pay", t)
    _kv(sh, 330, y + 16, "IBAN", d["iban"], t, "iban", kw=44)
    _kv(sh, 330, y + 30, "Bank", d["bank"], t, None, kw=44)
    _kv(sh, 330, y + 44, "Reference", d["account"], t, None, kw=44)
    _footer(sh, t, f"{t['issuer']} - customer billing")


def draw_invoice(sh: Sheet, d: dict):
    t = THEMES[d["theme"]]
    acc = hexc(t["accent"])
    ds = t["datefmt"]
    X0, X1 = 40, sh.W - 40
    y = _header(sh, t, "Invoice", d["number"])
    _eyebrow(sh, X0, y, "Bill to", t)
    sh.text(X0, y + 15, d["bill_to"], t["head"], 10.5, field="bill_to")
    sh.text(X0, y + 28, f"Attn. {d['contact']}", t["body"], 8.8)
    for i, part in enumerate(d["bill_addr"].split(", ")):
        sh.text(X0, y + 40 + i * 11.5, part, t["body"], 8.8)
    for i, (k, v, f) in enumerate([("Invoice number", d["number"], None), ("Invoice date", fdate(d["issue"], ds), "issue"), ("Due date", fdate(d["due"], ds), "due"), ("Your reference", d["po"], None), ("Supplier Tax ID", d["tin"], "tin")]):
        _kv(sh, 330, y + i * 14, k, v, t, f, kw=84)
    y += 92
    sh.rect(X0, y, X1 - X0, 20, fill=acc)
    cx = [X0 + 34, X0 + 46, X1 - 100, X1 - 8]
    for x, nm, al in zip(cx, ("Qty", "Description", "Unit price", "Amount (M$)"), "rlrr"):
        sh.text(x, y + 13.5, nm, t["head"], 8.6, WHITE, al, bg=acc)
    y += 20
    for i, (q, desc, unit, amt) in enumerate(d["items"]):
        y += 20
        sh.text(cx[0], y - 6, str(q), t["num"], 9, align="r")
        sh.text(cx[1], y - 6, desc, t["body"], 9)
        sh.text(cx[2], y - 6, money(unit), t["num"], 9, align="r", field=f"item.{i}.unit")
        sh.text(cx[3], y - 6, money(amt), t["num"], 9, align="r", field=f"item.{i}.amt")
        sh.line(X0, y, X1, y, (0.86, 0.86, 0.88), 0.4)
    y += 8
    bold = t["head"] if t["num"] != "Mono" else "Mono-B"
    for lab, amt, f, b in [("Subtotal", d["subtotal"], "subtotal", False), (f"VAT {d['vat_rate'] * 100:g}%", d["vat"], "vat", False), ("Total due", d["total"], "total", True)]:
        y += 19
        sh.text(X1 - 190, y - 5, lab, t["head"] if b else t["body"], 10 if b else 9.2)
        sh.text(X1 - 8, y - 5, money(amt), bold if b else t["num"], 10 if b else 9.2, align="r", field=f)
        sh.line(X1 - 196, y, X1, y, INK if b else (0.86, 0.86, 0.88), 0.9 if b else 0.4)
    y += 40
    _eyebrow(sh, X0, y, "Payment", t)
    _kv(sh, X0, y + 16, "Pay to", t["issuer"], t, "payee", kw=60)
    _kv(sh, X0, y + 30, "IBAN", d["iban"], t, "iban", kw=60)
    _kv(sh, X0, y + 44, "Bank", d["bank"], t, None, kw=60)
    _kv(sh, X0, y + 58, "Terms", "30 days from the invoice date", t, None, kw=60)
    sh.text(X0, y + 84, "Thank you for your order. Goods remain the property of the supplier until paid in full.", t["body"], 7.8, GREY)
    _footer(sh, t, f"{t['issuer']} - Tax ID {d['tin']}")


CARD = (486.0, 306.0)


def draw_idcard(sh: Sheet, d: dict):
    green = d["theme"] == "green"
    acc = hexc("#1f6b52" if green else "#1d4e89")
    tint = (0.93, 0.965, 0.95) if green else (0.925, 0.95, 0.975)
    W, H = sh.W, sh.H
    sh.rect(0, 0, W, H, fill=tint)
    r = random.Random(d["seed"])
    for k in range(26):
        ph, amp = r.uniform(0, 6.28), r.uniform(5, 16)
        pts = [(x, 60 + k * 9 + amp * math.sin(x / 38.0 + ph + k * 0.35)) for x in range(0, int(W) + 6, 6)]
        sh.poly(pts, stroke=(acc[0] * 0.5 + 0.5, acc[1] * 0.5 + 0.5, acc[2] * 0.5 + 0.5), lw=0.35, close=False)
    sh.c.saveState()
    sh.c.setFillColorRGB(*(0.84, 0.87, 0.90))
    sh.c.translate(W / 2 + 40, H / 2 - 8)
    sh.c.rotate(24)
    sh.c.setFont("LiberationSans-Bold", 58)
    sh.c.drawCentredString(0, 0, "SPECIMEN")
    sh.c.restoreState()
    sh.rect(0, 0, W, 44, fill=acc)
    sh.text(18, 20, "REPUBLIC OF MERIDIA", "Sans-B", 13, WHITE, bg=acc, charspace=1.2)
    sh.text(18, 35, "NATIONAL IDENTITY CARD", "Sans", 8.5, (0.9, 0.93, 0.96), bg=acc, charspace=0.8)
    sh.circle(W - 34, 22, 13, stroke=WHITE, lw=1.2)
    sh.text(W - 34, 26.5, "M", "Serif-B", 14, WHITE, "c", bg=acc)
    # portrait: a drawn silhouette, never a face
    px, py, pw, ph_ = 18, 58, 118, 150
    sh.rect(px, py, pw, ph_, fill=(0.80, 0.84, 0.87), stroke=acc, lw=0.8)
    sh.circle(px + pw / 2, py + 58, 27, fill=(0.56, 0.61, 0.66))
    sh.poly([(px + 12, py + ph_), (px + 18, py + 112), (px + pw / 2, py + 92), (px + pw - 18, py + 112), (px + pw - 12, py + ph_)], fill=(0.56, 0.61, 0.66))
    fx = 152
    rows = [("Surname", d["surname"], "surname", fx, 70), ("Given names", d["given"], "given", fx, 100), ("Date of birth", fdate(d["dob"], "short").upper(), "dob", fx, 130), ("Sex", d["sex"], "sex", fx + 118, 130),
            ("Nationality", "MERIDIAN", None, fx + 190, 130), ("Document no.", d["doc_no"], "doc_no", fx, 160), ("Place of birth", d["place"], None, fx + 150, 160),
            ("Date of issue", fdate(d["issue"], "short").upper(), "issue", fx, 190), ("Date of expiry", fdate(d["expiry"], "short").upper(), "expiry", fx + 150, 190)]
    for lab, val, f, x, y in rows:
        sh.text(x, y, lab.upper(), "Sans", 5.8, acc, bg=tint, charspace=0.3)
        sh.text(x, y + 13, val, "Sans-B", 11.2, INK, field=f, bg=tint)
    sx, sy = fx + 190, 86
    pts = [(sx, sy)]
    for i in range(6):
        pts += [(sx + 14 * i + r.uniform(2, 9), sy - r.uniform(6, 16)), (sx + 14 * i + r.uniform(6, 12), sy + r.uniform(4, 12)), (sx + 14 * (i + 1), sy + r.uniform(-3, 3))]
    sh.poly(pts, stroke=(0.1, 0.12, 0.3), lw=0.9, close=False, curve=True)
    sh.rect(0, H - 76, W, 76, fill=(0.975, 0.975, 0.97))
    for i, line in enumerate(d["mrz"]):
        sh.text(20, H - 54 + i * 19, line, "Mono", 14.2, INK, field=f"mrz{i + 1}", bg=(0.975, 0.975, 0.97), charspace=1.05)


DRAW = {"payslip": draw_payslip, "bank_statement": draw_statement, "utility_bill": draw_bill, "invoice": draw_invoice, "id_card": draw_idcard}


def render(d: dict, overrides: dict | None = None) -> tuple[bytes, dict, tuple[float, float]]:
    """The model as a PDF: bytes, the recorded fields and the page size."""
    card = d["kind"] == "id_card"
    sh = Sheet(size=CARD if card else (595.0, 842.0), overrides=overrides, watermark=not card)
    DRAW[d["kind"]](sh, d)
    pages = sh.page
    data = sh.finish()
    return data, {k: v for k, v in sh.fields.items() if v.get("pt")}, (sh.W, sh.H), pages


def clone(d: dict) -> dict:
    return copy.deepcopy(d)

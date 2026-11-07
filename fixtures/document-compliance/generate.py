"""Generate the synthetic Document packs used by the document compliance demo.

Every document belongs to the fictional Republic of Meridia and carries a SPECIMEN
watermark. Each pack holds one deliberate flaw (or none, for `clean`) and a
`pack.json` with its Client declaration, Pre-screen date and expected Findings.

Requires Google Chrome (headless rendering), Pillow and pypdfium2. The parser's
virtual environment has both Python packages:

    services/parser/.venv/bin/python fixtures/document-compliance/generate.py
"""

import html
import json
import math
import random
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from string import Template

import pypdfium2
from PIL import Image, ImageChops, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / "templates"
PACKS = ROOT / "packs"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PRESCREEN_DATE = "2026-11-07"
RULEBOOK_ID = "individual-onboarding"

REQUIREMENT_IDS = [
    "identity-document-present",
    "identity-document-not-expired",
    "proof-of-address-present",
    "proof-of-address-recent",
    "name-matches",
    "date-of-birth-matches",
    "address-matches",
    "certification-complete",
    "documents-legible",
    "no-tampering",
]


@dataclass(frozen=True)
class Passport:
    number: str = "MR4820173"
    surname: str = "VELASCO"
    given_names: str = "AMARA LUCIA"
    date_of_birth: date = date(1991, 3, 14)
    sex: str = "F"
    place_of_birth: str = "Port Selene"
    date_of_issue: date = date(2022, 5, 10)
    date_of_expiry: date = date(2032, 5, 9)
    # Expiry printed on the data page when it was altered after issue. The MRZ keeps the real one.
    tampered_expiry: date | None = None


@dataclass(frozen=True)
class Bill:
    account_holder: str = "Amara L. Velasco"
    account_number: str = "0048-2291-77"
    statement_date: date = date(2026, 10, 2)
    billing_period: str = "01 Sep 2026 to 30 Sep 2026"
    due_date: date = date(2026, 10, 23)
    amount_due: str = "139.41"


@dataclass(frozen=True)
class Certification:
    wording: str = "I certify that this is a true copy of the original document, which I have seen."
    certifier_name: str = "Daniel K. Ortez"
    certifier_occupation: str = "Notary Public"
    certification_date: date | None = date(2026, 10, 20)


@dataclass(frozen=True)
class Pack:
    slug: str
    title: str
    flaw: str
    passport: Passport = field(default_factory=Passport)
    bill: Bill = field(default_factory=Bill)
    certification: Certification = field(default_factory=Certification)
    # Requirement ID -> outcome, for every Requirement that should not pass.
    expected_exceptions: dict[str, str] = field(default_factory=dict)


ADDRESS_LINE_1 = "14 Harbour View Road"
ADDRESS_LINE_2 = "Port Selene MR-2041"

CLIENT_DECLARATION = {
    "fullName": "Amara Lucia Velasco",
    "dateOfBirth": "1991-03-14",
    "residentialAddress": f"{ADDRESS_LINE_1}, {ADDRESS_LINE_2}, Republic of Meridia",
}

PACK_LIST = [
    Pack(slug="clean", title="Clean pack", flaw="None. Every Requirement should pass."),
    Pack(
        slug="expired-passport",
        title="Expired passport",
        flaw="The passport expired before the Pre-screen date.",
        passport=Passport(date_of_issue=date(2016, 8, 31), date_of_expiry=date(2026, 8, 30)),
        expected_exceptions={"identity-document-not-expired": "fail"},
    ),
    Pack(
        slug="stale-bill",
        title="Stale proof of address",
        flaw="The utility bill is more than 3 months old.",
        bill=Bill(
            statement_date=date(2026, 6, 15),
            billing_period="01 May 2026 to 31 May 2026",
            due_date=date(2026, 7, 6),
        ),
        expected_exceptions={"proof-of-address-recent": "fail"},
    ),
    Pack(
        slug="name-mismatch",
        title="Name mismatch",
        flaw="The utility bill is addressed to a different first name with the same surname.",
        bill=Bill(account_holder="Marisol Velasco"),
        expected_exceptions={"name-matches": "needs_review"},
    ),
    Pack(
        slug="tampered-passport",
        title="Tampered passport",
        flaw=(
            "The expiry date on the data page was pasted over in a different font. "
            "The machine-readable zone still carries the real, past expiry date."
        ),
        passport=Passport(
            date_of_issue=date(2015, 9, 12),
            date_of_expiry=date(2025, 9, 11),
            tampered_expiry=date(2029, 9, 11),
        ),
        expected_exceptions={
            "identity-document-not-expired": "needs_review",
            "no-tampering": "needs_review",
        },
    ),
    Pack(
        slug="incomplete-certification",
        title="Incomplete certification",
        flaw="The certified copy is missing the certifier's occupation and the certification date.",
        certification=Certification(certifier_occupation="", certification_date=None),
        expected_exceptions={"certification-complete": "fail"},
    ),
]


# MRZ ---------------------------------------------------------------------------------------


def mrz_check_digit(value: str) -> str:
    weights = (7, 3, 1)
    total = 0
    for index, char in enumerate(value):
        if char.isdigit():
            number = int(char)
        elif char.isalpha():
            number = ord(char) - ord("A") + 10
        else:
            number = 0
        total += number * weights[index % 3]
    return str(total % 10)


def mrz_lines(passport: Passport) -> tuple[str, str]:
    name = f"{passport.surname.replace(' ', '<')}<<{passport.given_names.replace(' ', '<')}"
    line_1 = f"P<MRD{name}".ljust(44, "<")[:44]

    number = passport.number.ljust(9, "<")
    birth = passport.date_of_birth.strftime("%y%m%d")
    expiry = passport.date_of_expiry.strftime("%y%m%d")
    personal = "<" * 14
    number_part = number + mrz_check_digit(number)
    birth_part = birth + mrz_check_digit(birth)
    expiry_part = expiry + mrz_check_digit(expiry)
    personal_part = personal + mrz_check_digit(personal)
    composite = mrz_check_digit(number_part + birth_part + expiry_part + personal_part)
    line_2 = f"{number_part}MRD{birth_part}{passport.sex}{expiry_part}{personal_part}{composite}"
    return line_1, line_2


# Rendering ---------------------------------------------------------------------------------


def passport_date(value: date) -> str:
    return value.strftime("%d %b %Y").upper()


def document_date(value: date) -> str:
    return value.strftime("%d %b %Y")


def guilloche_paths() -> str:
    paths = []
    for curve in range(30):
        phase = curve * 0.42
        amplitude = 26 + (curve % 5) * 7
        offset = 110 + curve * 17
        points = []
        for x in range(0, 1001, 10):
            y = offset + amplitude * math.sin(x / 61 + phase) * math.cos(x / 173 - phase)
            points.append(f"{x},{y:.1f}")
        paths.append(f'<polyline points="{" ".join(points)}"/>')
    return "\n".join(paths)


SIGNATURE = (
    '<path d="M8 50 C30 6 46 64 66 30 S96 10 104 44 C112 70 138 12 160 34 S206 58 226 22 '
    'C238 6 252 40 290 30" fill="none" stroke="#1b2f6b" stroke-width="3" stroke-linecap="round"/>'
)


def render_template(name: str, values: dict[str, str]) -> str:
    return Template((TEMPLATES / name).read_text()).substitute(values)


def chrome(args: list[str]) -> None:
    subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", *args],
        check=True,
        capture_output=True,
    )


def screenshot(html_path: Path, out: Path, width: int, height: int, scale: int) -> None:
    chrome(
        [
            f"--window-size={width},{height}",
            f"--force-device-scale-factor={scale}",
            f"--screenshot={out}",
            html_path.as_uri(),
        ]
    )


def print_pdf(html_path: Path, out: Path) -> None:
    chrome(["--no-pdf-header-footer", "--print-to-pdf-no-header", f"--print-to-pdf={out}", html_path.as_uri()])


def add_noise(image: Image.Image, sigma: float, strength: float) -> Image.Image:
    noise = Image.effect_noise(image.size, sigma).convert(image.mode)
    return Image.blend(image, ImageChops.overlay(image, noise), strength)


def photograph(source: Path, out: Path, seed: int) -> None:
    """Make a clean render look like a phone photo of a passport on a desk."""
    rng = random.Random(seed)
    card = Image.open(source).convert("RGB")
    angle = rng.uniform(-2.6, -1.4)
    rotated = card.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(0, 0, 0))
    mask = Image.new("L", card.size, 255).rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)

    desk = Image.new("RGB", (rotated.width + 300, rotated.height + 300), (92, 78, 66))
    shading = Image.linear_gradient("L").resize(desk.size).filter(ImageFilter.GaussianBlur(40))
    desk = Image.composite(desk, Image.new("RGB", desk.size, (58, 48, 40)), shading)

    shadow = Image.new("RGB", rotated.size, (20, 16, 12))
    shadow_mask = mask.filter(ImageFilter.GaussianBlur(18))
    desk.paste(shadow, (166, 172), shadow_mask)
    desk.paste(rotated, (150, 150), mask)

    photo = desk.filter(ImageFilter.GaussianBlur(0.9))
    photo = add_noise(photo, sigma=60, strength=0.18)
    photo = photo.resize((1600, round(1600 * photo.height / photo.width)), Image.Resampling.LANCZOS)
    photo.save(out, "JPEG", quality=82)


# Page images are what the viewer draws boxes on and what the model looks at.
PAGE_RENDER_DPI = 150


def render_pdf_pages(pdf: Path) -> list[str]:
    """Rasterize every page of a PDF next to it and return the page file names."""
    names = []
    document = pypdfium2.PdfDocument(pdf)
    for index in range(len(document)):
        name = f"{pdf.stem}.page-{index + 1}.png"
        document[index].render(scale=PAGE_RENDER_DPI / 72).to_pil().convert("RGB").save(pdf.parent / name)
        names.append(name)
    document.close()
    return names


def scan_to_pdf(source: Path, out: Path, seed: int) -> None:
    """Make a rendered page look like a greyscale photocopy, saved as an image-only PDF."""
    rng = random.Random(seed)
    page = ImageOps.grayscale(Image.open(source))
    page = page.rotate(rng.uniform(0.4, 0.9), resample=Image.Resampling.BICUBIC, fillcolor=255)
    page = add_noise(page, sigma=40, strength=0.12).filter(ImageFilter.GaussianBlur(0.5))
    page.save(out, "PDF", resolution=150)


# Packs -------------------------------------------------------------------------------------


def passport_values(passport: Passport) -> dict[str, str]:
    line_1, line_2 = mrz_lines(passport)
    printed_expiry = passport.tampered_expiry or passport.date_of_expiry
    return {
        "guilloche": guilloche_paths(),
        "passport_number": passport.number,
        "surname": passport.surname,
        "given_names": passport.given_names,
        "date_of_birth": passport_date(passport.date_of_birth),
        "sex": passport.sex,
        "place_of_birth": passport.place_of_birth,
        "date_of_issue": passport_date(passport.date_of_issue),
        "date_of_expiry": passport_date(printed_expiry),
        "expiry_class": "tampered" if passport.tampered_expiry else "",
        "mrz_line_1": html.escape(line_1),
        "mrz_line_2": html.escape(line_2),
    }


def bill_values(bill: Bill) -> dict[str, str]:
    return {
        "account_holder": bill.account_holder,
        "account_number": bill.account_number,
        "statement_date": document_date(bill.statement_date),
        "billing_period": bill.billing_period,
        "due_date": document_date(bill.due_date),
        "amount_due": bill.amount_due,
        "address_line_1": ADDRESS_LINE_1,
        "address_line_2": ADDRESS_LINE_2,
    }


def certification_values(certification: Certification, passport_image: Path) -> dict[str, str]:
    return {
        "passport_image": passport_image.as_uri(),
        "certification_wording": certification.wording,
        "certifier_name": certification.certifier_name,
        "certifier_occupation": certification.certifier_occupation,
        "certification_date": (
            document_date(certification.certification_date) if certification.certification_date else ""
        ),
        "signature": SIGNATURE,
    }


def pack_manifest(pack: Pack, pages: dict[str, list[str]]) -> dict:
    return {
        "slug": pack.slug,
        "title": pack.title,
        "flaw": pack.flaw,
        "rulebookId": RULEBOOK_ID,
        "prescreenDate": PRESCREEN_DATE,
        "clientDeclaration": CLIENT_DECLARATION,
        "documents": [
            {
                "kind": "identity_document",
                "file": "identity-document.jpg",
                "mediaType": "image/jpeg",
                "sourceFormat": "image",
                "pages": pages["identity-document.jpg"],
            },
            {
                "kind": "proof_of_address",
                "file": "proof-of-address.pdf",
                "mediaType": "application/pdf",
                "sourceFormat": "pdf_digital",
                "pages": pages["proof-of-address.pdf"],
            },
            {
                "kind": "certified_copy",
                "file": "certified-copy.pdf",
                "mediaType": "application/pdf",
                "sourceFormat": "pdf_scanned",
                "pages": pages["certified-copy.pdf"],
            },
        ],
        "expectedFindings": [
            {"requirementId": requirement_id, "outcome": pack.expected_exceptions.get(requirement_id, "pass")}
            for requirement_id in REQUIREMENT_IDS
        ],
    }


def build_pack(pack: Pack, seed: int) -> None:
    out_dir = PACKS / pack.slug
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)

        passport_html = tmp / "passport.html"
        passport_html.write_text(render_template("passport.html", passport_values(pack.passport)))
        passport_png = tmp / "passport.png"
        screenshot(passport_html, passport_png, 1000, 700, scale=2)
        photograph(passport_png, out_dir / "identity-document.jpg", seed)

        bill_html = tmp / "bill.html"
        bill_html.write_text(render_template("utility-bill.html", bill_values(pack.bill)))
        print_pdf(bill_html, out_dir / "proof-of-address.pdf")

        copy_html = tmp / "certified-copy.html"
        copy_html.write_text(
            render_template("certified-copy.html", certification_values(pack.certification, passport_png))
        )
        copy_png = tmp / "certified-copy.png"
        screenshot(copy_html, copy_png, 1240, 1754, scale=1)
        scan_to_pdf(copy_png, out_dir / "certified-copy.pdf", seed)

    pages = {
        "identity-document.jpg": ["identity-document.jpg"],
        "proof-of-address.pdf": render_pdf_pages(out_dir / "proof-of-address.pdf"),
        "certified-copy.pdf": render_pdf_pages(out_dir / "certified-copy.pdf"),
    }
    (out_dir / "pack.json").write_text(json.dumps(pack_manifest(pack, pages), indent=2) + "\n")


def main() -> None:
    for seed, pack in enumerate(PACK_LIST, start=1):
        build_pack(pack, seed)
        print(f"built {pack.slug}")


if __name__ == "__main__":
    main()

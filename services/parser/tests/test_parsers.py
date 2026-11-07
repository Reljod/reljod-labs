"""Runs the real parsers on the synthetic packs. Slow (model load) but local and free."""

from pathlib import Path

from app.parsers import parse_digital_pdf, parse_image, parse_scanned_pdf

PACKS = Path(__file__).resolve().parents[3] / "fixtures" / "document-compliance" / "packs"


def texts(spans):
    return " ".join(span["text"] for span in spans)


def test_digital_pdf_spans_hold_the_bill_details():
    page_count, spans = parse_digital_pdf(PACKS / "clean" / "proof-of-address.pdf")
    assert page_count == 1
    text = texts(spans)
    assert "Amara L. Velasco" in text
    assert "02 Oct 2026" in text
    assert all(0 <= span["box"]["y0"] < span["box"]["y1"] <= 1 for span in spans)


def test_image_ocr_reads_the_passport_including_the_mrz():
    page_count, spans = parse_image(PACKS / "tampered-passport" / "identity-document.jpg")
    assert page_count == 1
    text = texts(spans).replace(" ", "")
    assert "VELASCO" in text
    assert "11SEP2029" in text
    assert "2509116" in text  # real expiry in the machine-readable zone


def test_scanned_pdf_ocr_reads_the_certification():
    page_count, spans = parse_scanned_pdf(PACKS / "clean" / "certified-copy.pdf")
    assert page_count == 1
    # OCR drops some spaces ("Daniel K.Ortez"), so compare without them.
    text = texts(spans).replace(" ", "")
    assert "DanielK.Ortez" in text
    assert "NotaryPublic" in text
    assert "20Oct2026" in text

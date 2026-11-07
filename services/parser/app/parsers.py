"""The two parsers behind `/parse`: opendataloader-pdf for born-digital PDFs and
PaddleOCR (CPU, lightweight PP-OCR models) for images and scanned PDFs."""

import json
import tempfile
from functools import cache
from pathlib import Path

import opendataloader_pdf
import pypdfium2
from PIL import Image

from .spans import Span, spans_from_ocr, spans_from_opendataloader

# Matches the page images the app shows, so OCR boxes line up with them.
SCAN_RENDER_DPI = 150


@cache
def ocr_engine():
    from paddleocr import PaddleOCR

    return PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_recognition_model_name="PP-OCRv5_mobile_rec",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="cpu",
    )


def ocr_image(path: Path, page: int) -> list[Span]:
    with Image.open(path) as image:
        width, height = image.size
    results = ocr_engine().predict(str(path))
    if not results:
        return []
    result = results[0]
    return spans_from_ocr(
        page,
        list(result["rec_texts"]),
        [float(score) for score in result["rec_scores"]],
        [list(box) for box in result["rec_boxes"]],
        width,
        height,
    )


def parse_image(path: Path) -> tuple[int, list[Span]]:
    return 1, ocr_image(path, page=1)


def parse_scanned_pdf(path: Path) -> tuple[int, list[Span]]:
    spans: list[Span] = []
    with tempfile.TemporaryDirectory() as tmp, pypdfium2.PdfDocument(path) as pdf:
        for index in range(len(pdf)):
            page_image = Path(tmp) / f"page-{index + 1}.png"
            pdf[index].render(scale=SCAN_RENDER_DPI / 72).to_pil().convert("RGB").save(page_image)
            spans.extend(ocr_image(page_image, page=index + 1))
        return len(pdf), spans


def parse_digital_pdf(path: Path) -> tuple[int, list[Span]]:
    with pypdfium2.PdfDocument(path) as pdf:
        page_sizes = [pdf[index].get_size() for index in range(len(pdf))]
    with tempfile.TemporaryDirectory() as out:
        opendataloader_pdf.convert(input_path=[str(path)], output_dir=out, format="json")
        document = json.loads(next(Path(out).glob("*.json")).read_text())
    return len(page_sizes), spans_from_opendataloader(document, page_sizes)

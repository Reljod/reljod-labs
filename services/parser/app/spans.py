"""Turn each parser's native output into Spans: text plus a box normalised to 0-1
with a top-left origin, the one shape the app understands (ADR 0002)."""

from collections.abc import Iterator
from typing import Any, Literal, TypedDict


class Box(TypedDict):
    x0: float
    y0: float
    x1: float
    y1: float


class Span(TypedDict):
    ref: str
    page: int
    text: str
    granularity: Literal["word", "line", "element"]
    box: Box
    confidence: float | None


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


def pixel_box(x0: float, y0: float, x1: float, y1: float, width: int, height: int) -> Box:
    """A box in image pixels (top-left origin) normalised by the image size."""
    return {
        "x0": _clamp(x0 / width),
        "y0": _clamp(y0 / height),
        "x1": _clamp(x1 / width),
        "y1": _clamp(y1 / height),
    }


def pdf_box(bounding_box: list[float], page_width: float, page_height: float) -> Box:
    """A `[left, bottom, right, top]` box in PDF points (bottom-left origin), flipped and normalised."""
    left, bottom, right, top = bounding_box
    return {
        "x0": _clamp(left / page_width),
        "y0": _clamp((page_height - top) / page_height),
        "x1": _clamp(right / page_width),
        "y1": _clamp((page_height - bottom) / page_height),
    }


def walk_elements(node: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Every opendataloader-pdf element that carries text and a box, in reading order."""
    content = node.get("content")
    if isinstance(content, str) and content.strip() and "bounding box" in node:
        yield node
    for value in node.values():
        if isinstance(value, list):
            for child in value:
                if isinstance(child, dict):
                    yield from walk_elements(child)


def spans_from_opendataloader(document: dict[str, Any], page_sizes: list[tuple[float, float]]) -> list[Span]:
    spans: list[Span] = []
    counters: dict[int, int] = {}
    for element in walk_elements(document):
        page = int(element["page number"])
        width, height = page_sizes[page - 1]
        counters[page] = counters.get(page, 0) + 1
        spans.append(
            {
                "ref": f"p{page}-s{counters[page]}",
                "page": page,
                "text": element["content"].strip(),
                "granularity": "element",
                "box": pdf_box(element["bounding box"], width, height),
                "confidence": None,
            }
        )
    return spans


def spans_from_ocr(
    page: int, texts: list[str], scores: list[float], boxes: list[list[float]], width: int, height: int
) -> list[Span]:
    """PaddleOCR line results (`rec_texts`, `rec_scores`, `rec_boxes` as x1,y1,x2,y2 pixels)."""
    spans: list[Span] = []
    for index, (text, score, box) in enumerate(zip(texts, scores, boxes, strict=True), start=1):
        if not text.strip():
            continue
        spans.append(
            {
                "ref": f"p{page}-s{index}",
                "page": page,
                "text": text.strip(),
                "granularity": "line",
                "box": pixel_box(*[float(value) for value in box], width, height),
                "confidence": float(score),
            }
        )
    return spans

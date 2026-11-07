from app.spans import pdf_box, pixel_box, spans_from_ocr, spans_from_opendataloader, walk_elements


def test_pdf_box_flips_the_bottom_left_origin():
    box = pdf_box([100.0, 600.0, 300.0, 700.0], page_width=600.0, page_height=800.0)
    assert box == {"x0": 100 / 600, "y0": 100 / 800, "x1": 300 / 600, "y1": 200 / 800}


def test_pixel_box_normalises_and_clamps():
    box = pixel_box(-5, 10, 1010, 50, width=1000, height=100)
    assert box == {"x0": 0.0, "y0": 0.1, "x1": 1.0, "y1": 0.5}


def test_walk_elements_reaches_nested_text_and_skips_empty():
    document = {
        "kids": [
            {"type": "paragraph", "content": "Top", "page number": 1, "bounding box": [0, 0, 1, 1]},
            {
                "type": "table",
                "rows": [{"cells": [{"content": "Cell", "page number": 1, "bounding box": [0, 0, 1, 1]}]}],
            },
            {"type": "paragraph", "content": "  ", "page number": 1, "bounding box": [0, 0, 1, 1]},
        ]
    }
    assert [element["content"] for element in walk_elements(document)] == ["Top", "Cell"]


def test_opendataloader_spans_are_numbered_per_page():
    document = {
        "kids": [
            {"content": "A", "page number": 1, "bounding box": [0, 0, 10, 10]},
            {"content": "B", "page number": 2, "bounding box": [0, 0, 10, 10]},
            {"content": "C", "page number": 2, "bounding box": [0, 0, 10, 10]},
        ]
    }
    spans = spans_from_opendataloader(document, [(100.0, 100.0), (100.0, 100.0)])
    assert [(span["ref"], span["granularity"], span["confidence"]) for span in spans] == [
        ("p1-s1", "element", None),
        ("p2-s1", "element", None),
        ("p2-s2", "element", None),
    ]


def test_ocr_spans_keep_confidence_and_drop_blank_lines():
    spans = spans_from_ocr(1, ["VELASCO", " "], [0.98, 0.5], [[10, 20, 110, 40], [0, 0, 1, 1]], 200, 100)
    assert spans == [
        {
            "ref": "p1-s1",
            "page": 1,
            "text": "VELASCO",
            "granularity": "line",
            "box": {"x0": 0.05, "y0": 0.2, "x1": 0.55, "y1": 0.4},
            "confidence": 0.98,
        }
    ]

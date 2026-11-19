"""Loupe's Toolkit: the Checks and the helpers the Examiner's code imports.
See ../README.md."""
from . import checks, ids
from ._api import (
    doc_path,
    fmt,
    page_array,
    page_count,
    page_image,
    page_text,
    pdf,
    report,
    shapes,
    text_runs,
    to_box,
    to_px,
)
from ._ctx import configure
from ._layers import compare_layer, heat_layer, mark_layer, save_layer
from .contract import CHECKS, METRICS

__all__ = [
    "CHECKS", "METRICS", "checks", "ids", "configure", "doc_path", "fmt", "page_count", "page_image",
    "page_array", "text_runs", "shapes", "page_text", "pdf", "to_px", "to_box", "report", "save_layer",
    "heat_layer", "mark_layer", "compare_layer",
]

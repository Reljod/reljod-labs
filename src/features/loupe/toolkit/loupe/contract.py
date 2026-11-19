"""The fixed lists, equal to METRICS and CHECKS in ../../domain/contract.ts."""

METRICS = (
    "pdf.incremental_updates",
    "pdf.editor_producer",
    "pdf.modified_gap_hours",
    "pdf.covered_text",
    "pdf.text_over_image",
    "pdf.annotations",
    "glyph.font_outlier",
    "glyph.size_delta_pt",
    "glyph.baseline_offset_pt",
    "glyph.spacing_outlier",
    "glyph.color_delta",
    "image.ela_ratio",
    "image.noise_ratio",
    "image.jpeg_ghost",
    "image.copy_move",
    "image.edge_halo",
    "arith.sum_mismatch",
    "arith.balance_break",
    "arith.rate_mismatch",
    "format.date_anomaly",
    "format.style_break",
    "id.checksum_invalid",
)

CHECKS = {
    "pdf_structure": {"formats": ("pdf",), "metrics": ("pdf.incremental_updates", "pdf.editor_producer", "pdf.modified_gap_hours", "pdf.text_over_image", "pdf.annotations")},
    "pdf_overpaint": {"formats": ("pdf",), "metrics": ("pdf.covered_text",)},
    "glyphs": {"formats": ("pdf",), "metrics": ("glyph.font_outlier", "glyph.size_delta_pt", "glyph.baseline_offset_pt", "glyph.spacing_outlier", "glyph.color_delta")},
    "arithmetic": {"formats": ("pdf",), "metrics": ("arith.sum_mismatch", "arith.balance_break", "arith.rate_mismatch")},
    "dates_formats": {"formats": ("pdf",), "metrics": ("format.date_anomaly", "format.style_break")},
    "checksums": {"formats": ("pdf",), "metrics": ("id.checksum_invalid",)},
    "ela": {"formats": ("image",), "metrics": ("image.ela_ratio",)},
    "noise": {"formats": ("image",), "metrics": ("image.noise_ratio",)},
    "jpeg_ghost": {"formats": ("image",), "metrics": ("image.jpeg_ghost",)},
    "copy_move": {"formats": ("image",), "metrics": ("image.copy_move",)},
    "edge_halo": {"formats": ("image",), "metrics": ("image.edge_halo",)},
}

LAYER_KINDS = ("heatmap", "marks", "compare")
DOCUMENT_KINDS = ("payslip", "bank_statement", "utility_bill", "invoice", "id_card", "other")

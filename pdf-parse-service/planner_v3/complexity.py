"""PDF Extraction V3 · E10 — deterministic per-page complexity classification.

Maps each page's source signals to exactly one complexity tier and the derived
capability requirements (OCR / tables / raster / VLM). The mapping is a total,
side-effect-free function so identical signals always yield an identical
classification — a precondition for a deterministic plan.

Tiers (see contracts.COMPLEXITY_TIERS):
  * ``native_simple``  — selectable text, little imagery: fast CPU is enough.
  * ``native_rich``    — selectable text + tables/vectors: needs table fidelity.
  * ``scanned``        — image page / scanned layer: needs OCR.
  * ``design_heavy``   — image-dominant, low text: raster fidelity likely.
  * ``unreadable``     — no usable signal: raster-only fallback.
"""
from __future__ import annotations

from typing import List, Tuple

from .contracts import (
    PDF_PAGE_COMPLEXITY_VERSION,
    PdfPageComplexityV1,
    PdfExtractionPreflightV1,
    PdfPageSignal,
)

# Classification thresholds. Named constants so the mapping is auditable and any
# change is a visible, versioned edit (which bumps the planner impl version).
_MIN_NATIVE_TEXT_CHARS = 40
_MIN_TEXT_COVERAGE = 0.12
_RICH_VECTOR_OPS = 120
_IMAGE_DOMINANT_RATIO = 0.75
_LOW_TEXT_COVERAGE = 0.04


def classify_page(signal: PdfPageSignal) -> PdfPageComplexityV1:
    """Classify a single page from its source signals (deterministic, total)."""
    reasons: List[str] = []

    has_text = signal.text_char_count >= _MIN_NATIVE_TEXT_CHARS and signal.text_coverage_ratio >= _MIN_TEXT_COVERAGE
    has_tables = signal.table_region_count > 0
    image_dominant = signal.image_area_ratio >= _IMAGE_DOMINANT_RATIO
    very_low_text = signal.text_coverage_ratio < _LOW_TEXT_COVERAGE

    if signal.has_scanned_layer and not has_text:
        tier = "scanned"
        reasons.append("scanned_layer_without_text")
        return PdfPageComplexityV1(
            version=PDF_PAGE_COMPLEXITY_VERSION,
            page_number=signal.page_number,
            tier=tier,
            requires_ocr=True,
            requires_tables=has_tables,
            requires_raster=True,
            requires_vlm=False,
            reason_codes=tuple(reasons),
        )

    if not has_text and image_dominant:
        # Image-dominant, little/no selectable text: treat as design-heavy.
        tier = "design_heavy"
        reasons.append("image_dominant_low_text")
        return PdfPageComplexityV1(
            version=PDF_PAGE_COMPLEXITY_VERSION,
            page_number=signal.page_number,
            tier=tier,
            requires_ocr=signal.has_scanned_layer,
            requires_tables=has_tables,
            requires_raster=True,
            requires_vlm=False,
            reason_codes=tuple(reasons),
        )

    if not has_text and very_low_text and not signal.has_scanned_layer and signal.vector_op_count == 0:
        # No text, no scan, no vectors, no dominant image: nothing to reconstruct.
        tier = "unreadable"
        reasons.append("no_usable_signal")
        return PdfPageComplexityV1(
            version=PDF_PAGE_COMPLEXITY_VERSION,
            page_number=signal.page_number,
            tier=tier,
            requires_ocr=False,
            requires_tables=False,
            requires_raster=True,
            requires_vlm=False,
            reason_codes=tuple(reasons),
        )

    # Has usable text: native. Rich if tables or heavy vector content present.
    if has_tables or signal.vector_op_count >= _RICH_VECTOR_OPS or image_dominant:
        tier = "native_rich"
        if has_tables:
            reasons.append("native_with_tables")
        if signal.vector_op_count >= _RICH_VECTOR_OPS:
            reasons.append("native_heavy_vectors")
        if image_dominant:
            reasons.append("native_with_dominant_image")
    else:
        tier = "native_simple"
        reasons.append("native_simple_text")

    return PdfPageComplexityV1(
        version=PDF_PAGE_COMPLEXITY_VERSION,
        page_number=signal.page_number,
        tier=tier,
        requires_ocr=False,
        requires_tables=has_tables,
        requires_raster=tier == "native_rich" and image_dominant,
        requires_vlm=False,
        reason_codes=tuple(reasons),
    )


def classify_pages(preflight: PdfExtractionPreflightV1) -> Tuple[PdfPageComplexityV1, ...]:
    """Classify every page in the preflight, ordered by page number."""
    return tuple(classify_page(s) for s in preflight.page_signals)

"""PDF Extraction V3 · E10 — deterministic preflight builder.

Builds the immutable ``PdfExtractionPreflightV1`` from source-derived signals.
Every field is a pure function of the source bytes + requested output; nothing
here reads a signed URL, a wall-clock, a job id or a credential. The preflight
is the SINGLE source of truth the planner consumes, so two identical sources
always yield an identical preflight (and therefore an identical plan).
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from .contracts import (
    PDF_EXTRACTION_PREFLIGHT_VERSION,
    PdfExtractionPreflightV1,
    PdfPageSignal,
)


def _finite(v: Any, fallback: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return fallback
    return f if math.isfinite(f) else fallback


def _clamp01(v: float) -> float:
    if v < 0.0:
        return 0.0
    if v > 1.0:
        return 1.0
    return v


def _int(v: Any, fallback: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return fallback


def build_page_signal(raw: Dict[str, Any]) -> PdfPageSignal:
    """Normalize one raw per-page signal dict into a bounded ``PdfPageSignal``."""
    return PdfPageSignal(
        page_number=max(1, _int(raw.get("page_number"), 1)),
        text_char_count=max(0, _int(raw.get("text_char_count"), 0)),
        text_coverage_ratio=_clamp01(_finite(raw.get("text_coverage_ratio"), 0.0)),
        image_area_ratio=_clamp01(_finite(raw.get("image_area_ratio"), 0.0)),
        vector_op_count=max(0, _int(raw.get("vector_op_count"), 0)),
        has_scanned_layer=bool(raw.get("has_scanned_layer", False)),
        table_region_count=max(0, _int(raw.get("table_region_count"), 0)),
    )


def build_preflight(raw: Dict[str, Any]) -> PdfExtractionPreflightV1:
    """Build the immutable preflight bundle from a raw source-signal dict.

    Page signals are sorted by page number so ordering of the input never
    affects the resulting identity. Aggregate ratios are clamped to [0, 1].
    """
    page_signals_raw = raw.get("page_signals") or []
    page_signals = tuple(
        sorted(
            (build_page_signal(p) for p in page_signals_raw if isinstance(p, dict)),
            key=lambda s: s.page_number,
        )
    )
    page_count = _int(raw.get("page_count"), len(page_signals)) or len(page_signals)
    scanned_pages = sum(1 for s in page_signals if s.has_scanned_layer)
    scanned_ratio = _clamp01(scanned_pages / page_count) if page_count > 0 else 0.0
    return PdfExtractionPreflightV1(
        version=PDF_EXTRACTION_PREFLIGHT_VERSION,
        source_sha256=str(raw.get("source_sha256") or ""),
        byte_size=max(0, _int(raw.get("byte_size"), 0)),
        page_count=max(0, page_count),
        file_type="pdf",
        has_selectable_text=bool(raw.get("has_selectable_text", False)),
        selectable_text_ratio=_clamp01(_finite(raw.get("selectable_text_ratio"), 0.0)),
        scanned_page_ratio=_clamp01(_finite(raw.get("scanned_page_ratio"), scanned_ratio)),
        ocr_hint=bool(raw.get("ocr_hint", False)),
        image_heavy=bool(raw.get("image_heavy", False)),
        design_heavy=bool(raw.get("design_heavy", False)),
        table_likelihood=str(raw.get("table_likelihood") or "low"),
        encrypted=bool(raw.get("encrypted", False)),
        page_signals=page_signals,
    )

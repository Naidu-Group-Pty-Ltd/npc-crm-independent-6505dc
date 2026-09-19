"""PDF Extraction V3 · E10 — deterministic fixtures for tests (no real PDFs).

Synthetic, fully in-memory source-signal dicts and request options. No private
PDF, no signed URL, no credential ever appears here — only structural signals a
test can feed to the planner to exercise routing, caching and recovery.
"""
from __future__ import annotations

from typing import Any, Dict

from .plan import PlanV3RequestOptions

# A deterministic "native + tables + scanned + design" mixed 6-page document.
MIXED_SOURCE_SIGNALS: Dict[str, Any] = {
    "source_sha256": "a" * 64,
    "byte_size": 2_500_000,
    "page_count": 6,
    "has_selectable_text": True,
    "selectable_text_ratio": 0.7,
    "ocr_hint": True,
    "image_heavy": False,
    "design_heavy": True,
    "table_likelihood": "high",
    "encrypted": False,
    "page_signals": [
        # p1: simple native text
        {"page_number": 1, "text_char_count": 1800, "text_coverage_ratio": 0.55, "image_area_ratio": 0.02,
         "vector_op_count": 4, "has_scanned_layer": False, "table_region_count": 0},
        # p2: native with tables
        {"page_number": 2, "text_char_count": 900, "text_coverage_ratio": 0.3, "image_area_ratio": 0.05,
         "vector_op_count": 40, "has_scanned_layer": False, "table_region_count": 3},
        # p3: scanned (image page, no text layer)
        {"page_number": 3, "text_char_count": 0, "text_coverage_ratio": 0.0, "image_area_ratio": 0.95,
         "vector_op_count": 0, "has_scanned_layer": True, "table_region_count": 0},
        # p4: design-heavy (image dominant, low text, no scan layer)
        {"page_number": 4, "text_char_count": 10, "text_coverage_ratio": 0.02, "image_area_ratio": 0.9,
         "vector_op_count": 200, "has_scanned_layer": False, "table_region_count": 0},
        # p5: native heavy vectors
        {"page_number": 5, "text_char_count": 1200, "text_coverage_ratio": 0.4, "image_area_ratio": 0.1,
         "vector_op_count": 400, "has_scanned_layer": False, "table_region_count": 0},
        # p6: unreadable (nothing usable)
        {"page_number": 6, "text_char_count": 0, "text_coverage_ratio": 0.0, "image_area_ratio": 0.0,
         "vector_op_count": 0, "has_scanned_layer": False, "table_region_count": 0},
    ],
}

# A deterministic 3-page all-native document.
NATIVE_SOURCE_SIGNALS: Dict[str, Any] = {
    "source_sha256": "b" * 64,
    "byte_size": 400_000,
    "page_count": 3,
    "has_selectable_text": True,
    "selectable_text_ratio": 0.95,
    "ocr_hint": False,
    "image_heavy": False,
    "design_heavy": False,
    "table_likelihood": "low",
    "encrypted": False,
    "page_signals": [
        {"page_number": 1, "text_char_count": 2000, "text_coverage_ratio": 0.6, "image_area_ratio": 0.0,
         "vector_op_count": 2, "has_scanned_layer": False, "table_region_count": 0},
        {"page_number": 2, "text_char_count": 2100, "text_coverage_ratio": 0.62, "image_area_ratio": 0.0,
         "vector_op_count": 1, "has_scanned_layer": False, "table_region_count": 0},
        {"page_number": 3, "text_char_count": 1900, "text_coverage_ratio": 0.58, "image_area_ratio": 0.0,
         "vector_op_count": 0, "has_scanned_layer": False, "table_region_count": 0},
    ],
}


def default_request_options(**overrides: Any) -> PlanV3RequestOptions:
    """A stable default request-option set for tests; override any field."""
    base: Dict[str, Any] = {
        "requested_mode": "semantic",
        "allow_mode_override": True,
        "max_chunk_pages": 4,
        "redact_pii": False,
        "redaction_policy_version": "redaction-policy-v1",
        "description_tier": "off",
        "include_markdown": True,
        "include_doctags": False,
        "raster_format": "png",
        "raster_dpi": 200,
        "engine_version": "docling-2.14.0",
        "artifact_contract_version": "raster-manifest-v1",
        "lane_policy_version": "extractor-lane-policy-v1",
        "provider_policy_id": "default-local-only",
        "remote_approved": False,
    }
    base.update(overrides)
    return PlanV3RequestOptions(**base)

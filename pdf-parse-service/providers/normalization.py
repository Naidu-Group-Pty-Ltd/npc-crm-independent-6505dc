"""E9 — provider-neutral coordinate + Unicode + evidence-id normalization.

Every provider is normalized into PDF points, top-left origin, y-down,
parent-global page numbers, finite page-clamped geometry and explicit rotation.
Raw provider text is preserved exactly; NFC is stored separately; critical
punctuation (en/em dash, minus, ×, arrows, NBSP, currency, %, superscripts) is
NEVER destructively normalized. Provider-local evidence IDs are deterministic but
provider-local — they never replace canonical E1 source IDs.
"""
from __future__ import annotations

import math
import unicodedata
from typing import Dict, List, Optional, Tuple

from .contracts import SourceBBox, fnv1a32, stable_json

# Coordinate systems a provider may report.
COORD_TOP_LEFT_PT = "top-left-points"
COORD_BOTTOM_LEFT_PT = "bottom-left-points"
COORD_NORMALIZED = "normalized-0-1"
COORD_PIXELS = "pixels"
COORD_PROVIDER_UNITS = "provider-units"
COORD_UNKNOWN = "unknown"

_PROVIDER_ABBREV = {
    "pymupdf-exact": "pmu", "docling-standard-vnext": "dsv", "docling-vlm": "dvl",
    "google-document-ai-layout": "gal", "google-document-ai-ocr": "goc", "docling-legacy": "dlg",
}


class NormalizationError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def normalize_bbox(
    raw: Dict[str, float],
    *,
    system: str,
    page_width_pt: float,
    page_height_pt: float,
    pixel_scale: Optional[float] = None,
    critical: bool = False,
) -> SourceBBox:
    """Convert a provider bbox into canonical top-left PDF points, page-clamped.

    Rejects non-finite geometry, zero-area critical regions, off-page regions and
    unknown scale with no conversion evidence.
    """
    x = float(raw.get("x", raw.get("x0", float("nan"))))
    y = float(raw.get("y", raw.get("y0", float("nan"))))
    w = raw.get("width")
    h = raw.get("height")
    if w is None and "x1" in raw:
        w = float(raw["x1"]) - x
    if h is None and "y1" in raw:
        h = float(raw["y1"]) - y
    w = float(w if w is not None else float("nan"))
    h = float(h if h is not None else float("nan"))

    if not all(math.isfinite(v) for v in (x, y, w, h)):
        raise NormalizationError("non_finite_geometry")

    if system == COORD_TOP_LEFT_PT:
        pass
    elif system == COORD_BOTTOM_LEFT_PT:
        # PDF default bottom-left → flip y to top-left.
        y = page_height_pt - (y + h)
    elif system == COORD_NORMALIZED:
        x, w = x * page_width_pt, w * page_width_pt
        y, h = y * page_height_pt, h * page_height_pt
    elif system == COORD_PIXELS:
        if not pixel_scale or not math.isfinite(pixel_scale) or pixel_scale <= 0:
            raise NormalizationError("unknown_scale")
        x, y, w, h = x / pixel_scale, y / pixel_scale, w / pixel_scale, h / pixel_scale
    else:
        raise NormalizationError("unknown_coordinate_system")

    if w <= 0 or h <= 0:
        if critical:
            raise NormalizationError("zero_area_critical_region")
        w, h = max(w, 0.0), max(h, 0.0)

    # off-page rejection (fully outside the page box, with a small tolerance).
    tol = 1.0
    if x + w < -tol or y + h < -tol or x > page_width_pt + tol or y > page_height_pt + tol:
        raise NormalizationError("region_off_page")

    # clamp to the page box.
    cx = min(max(x, 0.0), page_width_pt)
    cy = min(max(y, 0.0), page_height_pt)
    cw = min(w, page_width_pt - cx)
    ch = min(h, page_height_pt - cy)
    return SourceBBox(round(cx, 4), round(cy, 4), round(cw, 4), round(ch, 4))


# ── Unicode / text normalization ─────────────────────────────────────────────

# Critical glyphs that must never be silently normalized away.
_CRITICAL_GLYPHS = (
    "\u2013\u2014\u2212\u00d7\u2192\u2190\u00a0\u202f\u00a4$\u00a3\u20ac%\u2030\u00b0"
)


def normalize_text(raw: str) -> Dict[str, str]:
    """Return {raw, normalizedNfc, searchNormalized}. `raw` is authoritative."""
    raw = raw if isinstance(raw, str) else ""
    nfc = unicodedata.normalize("NFC", raw)
    # search-only: NFKC + fold dashes/spaces (never becomes visible text).
    folded = unicodedata.normalize("NFKC", raw)
    for ch in ("\u2013", "\u2014", "\u2212"):
        folded = folded.replace(ch, "-")
    for ch in ("\u00a0", "\u202f", "\u2007", "\u2009"):
        folded = folded.replace(ch, " ")
    return {"raw": raw, "normalizedNfc": nfc, "searchNormalized": folded.lower()}


def critical_glyph_signature(text: str) -> str:
    """A signature of the critical glyphs present, for conflict detection."""
    present = [ch for ch in text if ch in _CRITICAL_GLYPHS]
    return "".join(sorted(present))


# ── Provider-local evidence IDs (deterministic, provider-local) ──────────────

def provider_evidence_id(
    *,
    provider_id: str,
    request_id: str,
    page_number: int,
    kind: str,
    provider_local_ref: str,
    bbox: Optional[SourceBBox],
    ordinal: int,
    configuration_identity: str,
) -> str:
    abbr = _PROVIDER_ABBREV.get(provider_id, provider_id[:3])
    payload = {
        "requestId": request_id, "providerId": provider_id, "kind": kind,
        "providerLocalRef": provider_local_ref, "bbox": bbox.to_dict() if bbox else None,
        "ordinal": ordinal, "configurationIdentity": configuration_identity,
    }
    return f"pevd-{abbr}-p{page_number}-{kind}-{fnv1a32(stable_json(payload))}"


def geometry_hash(bbox: Optional[SourceBBox]) -> str:
    return fnv1a32(stable_json(bbox.to_dict() if bbox else None))


def text_hash(text: str) -> str:
    return fnv1a32(text)


def table_topology_hash(rows: int, cols: int, header_rows: int, header_cols: int, cell_refs: List[str]) -> str:
    return fnv1a32(stable_json({"r": rows, "c": cols, "hr": header_rows, "hc": header_cols, "cells": sorted(cell_refs)}))

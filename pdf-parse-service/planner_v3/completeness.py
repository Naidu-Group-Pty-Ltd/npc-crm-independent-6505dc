"""PDF Extraction V3 · E10 — artifact completeness (pdf-artifact-completeness-v1).

A V3 cache hit — and a finalized V3 run — must be ARTIFACT-COMPLETE: every page
the plan promised must have its required artifact set present as durable object
references (never signed URLs). This module computes a deterministic
completeness report the cache layer and finalizer both consult. An incomplete
report is a hard MISS / not-finalizable, never a partial success.

Required artifacts per page depend on the page's resolved capabilities:
  * every page needs the source raster + the page manifest entry;
  * OCR pages additionally need an ``ocr`` artifact;
  * table pages additionally need a ``tables`` artifact;
  * native pages need ``docling`` + ``blocks``.
Raster-only pages need ONLY the raster (the deliberate design of a pixel page).
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from .contracts import (
    PDF_ARTIFACT_COMPLETENESS_VERSION,
    PdfPageComplexityV1,
    ServiceRouteDecisionV1,
    SERVICE_CLASS_RASTER_ONLY,
    is_durable_ref,
    stable_hash,
)


def required_artifacts_for_page(
    page: PdfPageComplexityV1,
    resolved_class: str,
) -> Tuple[str, ...]:
    """The artifact keys a given page must have present to be complete."""
    if resolved_class == SERVICE_CLASS_RASTER_ONLY or page.tier == "unreadable":
        return ("raster",)
    required: List[str] = ["raster", "docling", "blocks"]
    if page.requires_ocr:
        required.append("ocr")
    if page.requires_tables:
        required.append("tables")
    return tuple(sorted(set(required)))


def _resolved_class_by_page(route_decisions: Tuple[ServiceRouteDecisionV1, ...]) -> Dict[int, str]:
    mapping: Dict[int, str] = {}
    for r in route_decisions:
        for p in r.page_numbers:
            mapping[p] = r.resolved_class
    return mapping


def evaluate_artifact_completeness(
    page_classifications: Tuple[PdfPageComplexityV1, ...],
    route_decisions: Tuple[ServiceRouteDecisionV1, ...],
    present_artifacts_by_page: Dict[int, Dict[str, Any]],
) -> Dict[str, Any]:
    """Compute the completeness report.

    ``present_artifacts_by_page`` maps page_number -> {artifact_key: ref}. A ref
    counts as present only when it is a DURABLE object reference (not a signed
    URL / absolute path / traversal). The report lists missing pages/artifacts
    and a single ``complete`` boolean; it carries a deterministic report id.
    """
    class_by_page = _resolved_class_by_page(route_decisions)
    missing: List[Dict[str, Any]] = []
    signed_url_leaks: List[int] = []
    checked_pages = 0

    for page in sorted(page_classifications, key=lambda p: p.page_number):
        checked_pages += 1
        resolved_class = class_by_page.get(page.page_number, SERVICE_CLASS_RASTER_ONLY)
        required = required_artifacts_for_page(page, resolved_class)
        present = present_artifacts_by_page.get(page.page_number, {}) or {}
        missing_keys: List[str] = []
        for key in required:
            ref = present.get(key)
            if ref is None or ref == "":
                missing_keys.append(key)
            elif not is_durable_ref(ref):
                # A signed URL / absolute path masquerading as an artifact is a
                # completeness FAILURE (and a policy leak), not a pass.
                missing_keys.append(key)
                if page.page_number not in signed_url_leaks:
                    signed_url_leaks.append(page.page_number)
        if missing_keys:
            missing.append({"page_number": page.page_number, "missing": sorted(missing_keys)})

    complete = len(missing) == 0 and checked_pages == len(page_classifications) and checked_pages > 0
    report = {
        "version": PDF_ARTIFACT_COMPLETENESS_VERSION,
        "complete": complete,
        "checked_pages": checked_pages,
        "expected_pages": len(page_classifications),
        "missing": missing,
        "signed_url_leak_pages": sorted(signed_url_leaks),
    }
    report["report_id"] = stable_hash(
        "acmp",
        {
            "version": report["version"],
            "complete": report["complete"],
            "checked_pages": report["checked_pages"],
            "expected_pages": report["expected_pages"],
            "missing": report["missing"],
            "signed_url_leak_pages": report["signed_url_leak_pages"],
        },
    )
    return report

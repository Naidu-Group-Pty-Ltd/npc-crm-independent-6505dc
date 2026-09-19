"""E9 — deterministic generated provider fixtures (test-time only).

Artificial synthetic provider payloads + request builders. No client information,
no external calls, no model download.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .contracts import (
    ExtractionProviderRequestV1, ProviderBudgetsV1, ProviderPolicyRefV1, ProviderProfileRefV1, ProviderScopeV1,
)
from .policy import default_local_policy
from .request_identity import configuration_identity, options_hash, request_id


def make_request(
    *, provider_id: str, purpose: str = "primary-extraction", page_start: int = 1, page_end: int = 1,
    region_ids: Optional[List[str]] = None, remote_approved: bool = False, byte_size: int = 4096,
    profile: str = "fast-native", policy=None,
) -> ExtractionProviderRequestV1:
    policy = policy or default_local_policy()
    cfg = configuration_identity(
        provider_id=provider_id, adapter_version="extraction-provider-adapter-v1", engine_package_version="0",
        model_preset=profile, processor_type=None, processor_version=None, trusted_location=None,
        ocr_options={}, table_options={}, chart_options={}, vlm_preset=None, privacy_policy_version="v1",
    )
    oh = options_hash({"profile": profile})
    ph = policy.policy_hash()
    rid = request_id(
        source_sha256="a" * 64, provider_id=provider_id, configuration_identity=cfg, purpose=purpose,
        page_start=page_start, page_end=page_end, region_ids=region_ids or [], region_bboxes=[],
        requested_capabilities=["nativeText"], options_hash=oh, policy_hash=ph,
    )
    return ExtractionProviderRequestV1(
        request_id=rid, import_id="imp-1", job_id="job-1", attempt_id="",
        source={"sourceSha256": "a" * 64, "mime": "application/pdf", "byteSize": byte_size, "pageCount": page_end, "durablePath": "job-1/source.pdf"},
        scope=ProviderScopeV1("page" if page_start == page_end else "page-range", page_start, page_end, list(region_ids or [])),
        purpose=purpose, requested_capabilities=["nativeText"],
        provider_profile=ProviderProfileRefV1(provider_id, cfg, profile, oh),
        policy_ref=ProviderPolicyRefV1(policy.version, ph, policy.privacy_class, policy.residency_class, remote_approved),
        budgets=ProviderBudgetsV1(timeout_ms=15000, max_retries=0, max_pages=100, max_regions=1000, max_bytes=1 << 26, maximum_estimated_cost=None),
        source_evidence_refs=["job-1/pages/page-001/blocks.json"],
    )


# ── Synthetic payloads ───────────────────────────────────────────────────────

def pymupdf_text_payload() -> Dict[str, Any]:
    return {"pages": [{"pageNumber": 1, "widthPt": 595, "heightPt": 842, "textSpans": [
        {"ref": "s1", "text": "Projected value $910,000–$920,000", "bbox": {"x": 40, "y": 40, "width": 220, "height": 14}, "readingOrder": 0, "confidence": 1.0},
        {"ref": "s2", "text": "8×8 grid", "bbox": {"x": 40, "y": 60, "width": 60, "height": 14}, "readingOrder": 1, "confidence": 1.0},
    ]}]}


def docling_table_payload() -> Dict[str, Any]:
    return {"pages": [{"pageNumber": 1, "widthPt": 595, "heightPt": 842, "converterKey": "vnext:accurate", "tables": [
        {"ref": "t1", "profile": "accurate-table", "sourceRegionRef": "region-tbl-1", "rows": 3, "cols": 3, "headerRows": 1, "headerCols": 0,
         "cells": [{"row": 0, "col": 0, "text": "Year"}, {"row": 1, "col": 1, "text": "$100,000"}], "numericTokens": ["100,000"], "punctuationTokens": ["$"], "confidence": 0.9},
    ]}]}


def docling_partial_payload() -> Dict[str, Any]:
    return {"status": "partial-success", "pages": [{"pageNumber": 1, "widthPt": 595, "heightPt": 842, "textSpans": [{"ref": "s1", "text": "ok", "bbox": {"x": 10, "y": 10, "width": 20, "height": 10}}]}]}


def vlm_invented_number_payload() -> Dict[str, Any]:
    # a plausible-but-invented numeric label (untrusted candidate evidence).
    return {"pages": [{"pageNumber": 1, "widthPt": 595, "heightPt": 842, "charts": [
        {"ref": "c1", "chartType": "bar", "caption": "Revenue", "numericLabels": ["999,999"], "confidence": 0.7}]}]}


def google_layout_normalized_payload() -> Dict[str, Any]:
    # normalized 0..1 coordinates.
    return {"pages": [{"pageNumber": 1, "widthPt": 595, "heightPt": 842, "textSpans": [
        {"ref": "g1", "text": "Heading", "bbox": {"x": 0.05, "y": 0.05, "width": 0.4, "height": 0.03}, "readingOrder": 0, "confidence": 0.95}]}]}


def google_ocr_payload() -> Dict[str, Any]:
    return {"pages": [{"pageNumber": 1, "widthPt": 595, "heightPt": 842, "textSpans": [
        {"ref": "o1", "text": "Scanned line 10–15", "bbox": {"x": 0.05, "y": 0.1, "width": 0.5, "height": 0.03}, "confidence": 0.8}]}]}


class FakeGoogleClient:
    """Injected fake — NEVER makes a network call. Returns a recorded payload."""

    def __init__(self, payload: Dict[str, Any], *, raise_exc: Optional[BaseException] = None) -> None:
        self._payload = payload
        self._raise = raise_exc
        self.calls = 0

    def process_document(self, *, processor_resource: str, content: bytes, mime_type: str, field_mask, timeout_seconds: float):
        self.calls += 1
        if self._raise is not None:
            raise self._raise
        return self._payload

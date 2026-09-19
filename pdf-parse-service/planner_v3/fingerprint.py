"""PDF Extraction V3 · E10 — cache fingerprint V3 and cache entry V3.

The V3 fingerprint folds in EVERY plan-affecting input, including the fields the
C1 ``pdf-cache-contract-v2`` fingerprint covered PLUS the Planner V3 additions
(service-class registry id, routing policy id, provider policy id, planner impl
version, page classifications digest, route digest). Two hard safety rules:

  1. NO V1 / V2 REUSE. The fingerprint string is namespaced by
     ``pdf-cache-fingerprint-v3`` and the planner impl version. A V1/V2 cache
     row can never fingerprint-match a V3 request, and ``is_reusable_contract``
     rejects any non-V3 contract version outright.
  2. A V3 CACHE HIT MUST BE ARTIFACT-COMPLETE. ``evaluate_cache_hit`` only
     admits a candidate entry when the fingerprints match, the contract version
     is exactly V3, AND the entry's artifact-completeness report passes. An
     incomplete entry is a MISS, never a partial/false hit.
"""
from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Optional, Tuple

from .contracts import (
    PDF_CACHE_ENTRY_V3_VERSION,
    PDF_CACHE_FINGERPRINT_V3_VERSION,
    PLANNER_V3_IMPLEMENTATION_VERSION,
    PdfExtractionPlanV3,
    ServiceRouteDecisionV1,
    stable_hash,
    stable_json,
    strip_urls,
)


class CacheFingerprintV3Input:
    """Structural inputs to the V3 fingerprint. A plain container (no I/O)."""

    __slots__ = (
        "source_sha256",
        "requested_mode",
        "allow_mode_override",
        "redact_pii",
        "redaction_policy_version",
        "description_tier",
        "include_markdown",
        "include_doctags",
        "raster_format",
        "raster_dpi",
        "engine_version",
        "artifact_contract_version",
        "lane_policy_version",
        "provider_policy_id",
        "registry_id",
        "routing_policy_id",
        "planner_impl_version",
        "classification_digest",
        "route_digest",
    )

    def __init__(
        self,
        *,
        source_sha256: str,
        requested_mode: str,
        allow_mode_override: bool,
        redact_pii: bool,
        redaction_policy_version: str,
        description_tier: str,
        include_markdown: bool,
        include_doctags: bool,
        raster_format: str,
        raster_dpi: int,
        engine_version: str,
        artifact_contract_version: str,
        lane_policy_version: str,
        provider_policy_id: str,
        registry_id: str,
        routing_policy_id: str,
        classification_digest: str,
        route_digest: str,
        planner_impl_version: str = PLANNER_V3_IMPLEMENTATION_VERSION,
    ) -> None:
        self.source_sha256 = source_sha256
        self.requested_mode = requested_mode
        self.allow_mode_override = allow_mode_override
        self.redact_pii = redact_pii
        self.redaction_policy_version = redaction_policy_version
        self.description_tier = description_tier
        self.include_markdown = include_markdown
        self.include_doctags = include_doctags
        self.raster_format = raster_format
        self.raster_dpi = raster_dpi
        self.engine_version = engine_version
        self.artifact_contract_version = artifact_contract_version
        self.lane_policy_version = lane_policy_version
        self.provider_policy_id = provider_policy_id
        self.registry_id = registry_id
        self.routing_policy_id = routing_policy_id
        self.planner_impl_version = planner_impl_version
        self.classification_digest = classification_digest
        self.route_digest = route_digest

    def to_dict(self) -> Dict[str, Any]:
        return {
            # 'contract' is the FIRST namespacing key so a V1/V2 payload can
            # never collide with a V3 payload even with identical other fields.
            "contract": PDF_CACHE_FINGERPRINT_V3_VERSION,
            "source_sha256": self.source_sha256,
            "requested_mode": self.requested_mode,
            "allow_mode_override": self.allow_mode_override,
            "redact_pii": self.redact_pii,
            "redaction_policy_version": self.redaction_policy_version,
            "description_tier": self.description_tier,
            "include_markdown": self.include_markdown,
            "include_doctags": self.include_doctags,
            "raster_format": self.raster_format,
            "raster_dpi": self.raster_dpi,
            "engine_version": self.engine_version,
            "artifact_contract_version": self.artifact_contract_version,
            "lane_policy_version": self.lane_policy_version,
            "provider_policy_id": self.provider_policy_id,
            "registry_id": self.registry_id,
            "routing_policy_id": self.routing_policy_id,
            "planner_impl_version": self.planner_impl_version,
            "classification_digest": self.classification_digest,
            "route_digest": self.route_digest,
        }


def classification_digest(page_classifications: Tuple[Any, ...]) -> str:
    """Order-independent digest of the page classifications (by page number)."""
    rows = sorted((p.to_dict() for p in page_classifications), key=lambda d: d["page_number"])
    return stable_hash("cls", rows)


def route_digest(route_decisions: Tuple[ServiceRouteDecisionV1, ...]) -> str:
    """Digest of the resolved routes (class + pages + admission), order-stable."""
    rows = [
        {
            "resolved_class": r.resolved_class,
            "desired_class": r.desired_class,
            "admitted": r.admitted,
            "page_numbers": sorted(r.page_numbers),
        }
        for r in route_decisions
    ]
    rows.sort(key=lambda d: (min(d["page_numbers"]) if d["page_numbers"] else 0, d["resolved_class"]))
    return stable_hash("rt", rows)


def compute_cache_fingerprint(inp: CacheFingerprintV3Input) -> str:
    """The canonical V3 fingerprint string: ``pf3-<sha256(...)>``.

    Deterministic and cross-runtime stable (matches the TS producer for ASCII).
    """
    canonical = strip_urls(stable_json(inp.to_dict())).encode("utf-8")
    return f"pf3-{hashlib.sha256(canonical).hexdigest()}"


def is_reusable_contract(contract_version: Any) -> bool:
    """Only an exact ``pdf-cache-fingerprint-v3`` entry is ever reusable by V3."""
    return contract_version == PDF_CACHE_FINGERPRINT_V3_VERSION


def evaluate_cache_hit(
    request_fingerprint: str,
    entry_fingerprint: Any,
    entry_contract_version: Any,
    entry_artifacts_complete: bool,
) -> Tuple[bool, str]:
    """Decide whether a candidate cache entry is a true, safe hit.

    Returns (is_hit, reason_code). A hit requires ALL of:
      * exact fingerprint match;
      * the entry's contract version is exactly V3 (no V1/V2 reuse);
      * the entry is artifact-complete.
    Any failure is a MISS with a specific, bounded reason — never a partial hit.
    """
    if not is_reusable_contract(entry_contract_version):
        return False, "cache_reuse_forbidden_legacy_contract"
    if entry_fingerprint != request_fingerprint:
        return False, "cache_miss_no_fingerprint_match"
    if not entry_artifacts_complete:
        return False, "cache_miss_incomplete_artifacts"
    return True, "cache_hit_artifact_complete"


def build_cache_entry_v3(plan: PdfExtractionPlanV3, artifacts_complete: bool) -> Dict[str, Any]:
    """Build a persisted cache-entry-v3 record (no signed URLs, no wall-clock).

    Only durable identity + completeness is persisted; the artifact bytes and
    signed URLs live elsewhere and are never embedded in the cache row.
    """
    return {
        "version": PDF_CACHE_ENTRY_V3_VERSION,
        "cache_fingerprint": plan.cache_fingerprint,
        "contract_version": PDF_CACHE_FINGERPRINT_V3_VERSION,
        "plan_id": plan.plan_id,
        "plan_hash": plan.plan_hash,
        "artifacts_complete": bool(artifacts_complete),
    }

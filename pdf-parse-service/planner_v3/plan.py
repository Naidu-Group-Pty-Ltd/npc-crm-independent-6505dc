"""PDF Extraction V3 · E10 — Plan V3 assembly (the ONE immutable plan).

``build_plan_v3`` composes preflight -> page complexity -> route decisions ->
chunk plan -> cache fingerprint -> plan id/hash into ONE immutable
``PdfExtractionPlanV3``. The plan id and plan hash are pure functions of the
plan's structural content, so:

  * SAME inputs  -> SAME plan id, plan hash, classifications, routes, chunk plan
    and cache fingerprint (a retry reuses the identical plan);
  * a genuine REROUTE (different registry / routing policy / provider policy /
    planner inputs / impl version) -> a NEW plan id and hash (never a silent
    in-place mutation of the old plan).

Nothing here performs I/O; the source-derived signals arrive via the preflight.
"""
from __future__ import annotations

from typing import List, Tuple

from .complexity import classify_pages
from .contracts import (
    PDF_EXTRACTION_PLAN_V3_VERSION,
    PLANNER_V3_IMPLEMENTATION_VERSION,
    ChunkPlanEntryV3,
    PdfExtractionPlanV3,
    PdfExtractionPreflightV1,
    PdfPageComplexityV1,
    ServiceClassRegistryV1,
    ServiceRouteDecisionV1,
    ServiceRoutingPolicyV1,
    fnv1a32,
    stable_json,
)
from .fingerprint import (
    CacheFingerprintV3Input,
    classification_digest,
    compute_cache_fingerprint,
    route_digest,
)
from .routing import route_pages

# Chunk-size bounds mirror the Plan V2 clamp (1..50) for continuity.
CHUNK_SIZE_MIN = 1
CHUNK_SIZE_MAX = 50


class PlanV3RequestOptions:
    """The requested-output + implementation-version inputs to the planner."""

    __slots__ = (
        "requested_mode",
        "allow_mode_override",
        "max_chunk_pages",
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
        "remote_approved",
    )

    def __init__(
        self,
        *,
        requested_mode: str,
        allow_mode_override: bool,
        max_chunk_pages: int,
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
        remote_approved: bool = False,
    ) -> None:
        self.requested_mode = requested_mode
        self.allow_mode_override = allow_mode_override
        self.max_chunk_pages = max(CHUNK_SIZE_MIN, min(CHUNK_SIZE_MAX, int(max_chunk_pages)))
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
        self.remote_approved = remote_approved


def _effective_mode(
    requested_mode: str,
    allow_override: bool,
    pages: Tuple[PdfPageComplexityV1, ...],
) -> str:
    """Deterministically resolve the effective mode from classifications.

    Without override, the requested mode is preserved verbatim. With override,
    the mode may only ESCALATE toward pixel fidelity, never silently downgrade:
      * all pages unreadable/raster -> 'pixel-perfect';
      * any scanned/design-heavy page -> at least 'hybrid'.
    """
    if not allow_override or not pages:
        return requested_mode
    tiers = [p.tier for p in pages]
    if tiers and all(t == "unreadable" for t in tiers):
        return "pixel-perfect"
    if any(t in ("scanned", "design_heavy") for t in tiers):
        if requested_mode == "semantic":
            return "hybrid"
    return requested_mode


def _build_chunk_plan(
    route_decisions: Tuple[ServiceRouteDecisionV1, ...],
    max_chunk_pages: int,
) -> Tuple[ChunkPlanEntryV3, ...]:
    """Split each contiguous route run into bounded, deterministic chunks.

    Pages within a decision are contiguous by construction; we cut them into
    runs of at most ``max_chunk_pages`` consecutive page numbers, preserving the
    resolved class. Chunk indices are assigned in page order.
    """
    chunks: List[ChunkPlanEntryV3] = []
    # Sort decisions by their first page to get a stable global page order.
    ordered = sorted(route_decisions, key=lambda r: min(r.page_numbers) if r.page_numbers else 0)
    chunk_index = 0
    for decision in ordered:
        pages = sorted(decision.page_numbers)
        i = 0
        while i < len(pages):
            # Grow a run of consecutive page numbers up to max_chunk_pages.
            start = pages[i]
            end = start
            count = 1
            j = i + 1
            while j < len(pages) and pages[j] == end + 1 and count < max_chunk_pages:
                end = pages[j]
                count += 1
                j += 1
            chunks.append(
                ChunkPlanEntryV3(
                    chunk_index=chunk_index,
                    page_start=start,
                    page_end=end,
                    service_class=decision.resolved_class,
                )
            )
            chunk_index += 1
            i = j
    return tuple(chunks)


def build_plan_v3(
    preflight: PdfExtractionPreflightV1,
    registry: ServiceClassRegistryV1,
    routing_policy: ServiceRoutingPolicyV1,
    options: PlanV3RequestOptions,
) -> PdfExtractionPlanV3:
    """Assemble the ONE immutable Plan V3 for this (source, request, config)."""
    page_classifications = classify_pages(preflight)
    route_decisions = route_pages(
        page_classifications,
        routing_policy,
        registry,
        remote_approved=options.remote_approved,
    )
    chunk_plan = _build_chunk_plan(route_decisions, options.max_chunk_pages)
    effective_mode = _effective_mode(options.requested_mode, options.allow_mode_override, page_classifications)

    cls_digest = classification_digest(page_classifications)
    rt_digest = route_digest(route_decisions)
    fp_input = CacheFingerprintV3Input(
        source_sha256=preflight.source_sha256,
        requested_mode=options.requested_mode,
        allow_mode_override=options.allow_mode_override,
        redact_pii=options.redact_pii,
        redaction_policy_version=options.redaction_policy_version,
        description_tier=options.description_tier,
        include_markdown=options.include_markdown,
        include_doctags=options.include_doctags,
        raster_format=options.raster_format,
        raster_dpi=options.raster_dpi,
        engine_version=options.engine_version,
        artifact_contract_version=options.artifact_contract_version,
        lane_policy_version=options.lane_policy_version,
        provider_policy_id=options.provider_policy_id,
        registry_id=registry.registry_id,
        routing_policy_id=routing_policy.policy_id,
        classification_digest=cls_digest,
        route_digest=rt_digest,
    )
    cache_fingerprint = compute_cache_fingerprint(fp_input)

    # The immutable plan CORE — everything the identity depends on. plan_id and
    # plan_hash are derived from this, so they cannot disagree with the content.
    core = {
        "version": PDF_EXTRACTION_PLAN_V3_VERSION,
        "planner_impl_version": PLANNER_V3_IMPLEMENTATION_VERSION,
        "registry_id": registry.registry_id,
        "routing_policy_id": routing_policy.policy_id,
        "provider_policy_id": options.provider_policy_id,
        "source_sha256": preflight.source_sha256,
        "requested_mode": options.requested_mode,
        "allow_mode_override": options.allow_mode_override,
        "effective_mode": effective_mode,
        "page_count": preflight.page_count,
        "page_classifications": [p.to_dict() for p in page_classifications],
        "route_decisions": [r.to_dict() for r in route_decisions],
        "chunk_plan": [c.to_dict() for c in chunk_plan],
        "cache_fingerprint": cache_fingerprint,
    }
    plan_hash = fnv1a32(stable_json(core))
    plan_id = f"plan3-{plan_hash}"

    return PdfExtractionPlanV3(
        version=PDF_EXTRACTION_PLAN_V3_VERSION,
        plan_id=plan_id,
        plan_hash=plan_hash,
        planner_impl_version=PLANNER_V3_IMPLEMENTATION_VERSION,
        registry_id=registry.registry_id,
        routing_policy_id=routing_policy.policy_id,
        provider_policy_id=options.provider_policy_id,
        source_sha256=preflight.source_sha256,
        requested_mode=options.requested_mode,
        allow_mode_override=options.allow_mode_override,
        effective_mode=effective_mode,
        page_count=preflight.page_count,
        page_classifications=page_classifications,
        route_decisions=route_decisions,
        chunk_plan=chunk_plan,
        cache_fingerprint=cache_fingerprint,
    )

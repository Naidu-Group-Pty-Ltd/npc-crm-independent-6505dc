"""PDF Extraction V3 · E10 — Planner V3 versioned contracts and deterministic identity.

Thirteen versioned contracts, the logical service-class vocabulary, and the
deterministic identity primitives (FNV-1a-32 over sorted-key compact JSON) that
are byte-identical with the E1 source-scene-graph and E9 provider producers for
ASCII inputs. This module is IMPORT-SAFE (no heavy deps, no I/O, no network).

Identity discipline (same as every prior E-package):
  * hash only STRUCTURAL inputs; never a timestamp, signed URL, credential,
    temp path, UUID, job id, retry counter or wall-clock;
  * canonicalize via ``stable_json`` (sorted keys, compact separators, ASCII)
    so Python and TypeScript agree byte-for-byte;
  * a plan is IMMUTABLE — a retry reuses the same plan id/hash, a genuine
    reroute produces a NEW plan id/hash (never a silent mutation).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

# ── Version constants (13 contracts) ─────────────────────────────────────────

PDF_EXTRACTION_PREFLIGHT_VERSION = "pdf-extraction-preflight-v1"
PDF_PAGE_COMPLEXITY_VERSION = "pdf-page-complexity-v1"
PDF_EXTRACTION_PLAN_V3_VERSION = "pdf-extraction-plan-v3"
PDF_SERVICE_CLASS_REGISTRY_VERSION = "pdf-service-class-registry-v1"
PDF_SERVICE_ROUTING_POLICY_VERSION = "pdf-service-routing-policy-v1"
PDF_SERVICE_ROUTE_DECISION_VERSION = "pdf-service-route-decision-v1"
PDF_EXECUTION_TARGET_VERSION = "pdf-execution-target-v1"
PDF_EXECUTION_ATTEMPT_VERSION = "pdf-execution-attempt-v1"
PDF_CACHE_FINGERPRINT_V3_VERSION = "pdf-cache-fingerprint-v3"
PDF_CACHE_ENTRY_V3_VERSION = "pdf-cache-entry-v3"
PDF_ARTIFACT_COMPLETENESS_VERSION = "pdf-artifact-completeness-v1"
PDF_RECOVERY_PLAN_VERSION = "pdf-recovery-plan-v1"
PDF_ROUTING_AUDIT_VERSION = "pdf-routing-audit-v1"

# The planner's own implementation version. Any change to how the planner maps
# inputs -> plan MUST bump this so plan ids/hashes and cache fingerprints
# partition; consumers never silently reuse a plan built by a different planner.
PLANNER_V3_IMPLEMENTATION_VERSION = "planner-v3-impl-1"

# ── Logical service classes (SEPARATE from physical service URLs) ────────────
#
# A service class is a *capability contract*, not a host. The routing layer maps
# a class to a physical execution target at run time; the plan only ever names a
# class. This lets the same immutable plan run against different concrete URLs
# (blue/green, region failover, local emulator) without changing its identity.

ServiceClass = str

SERVICE_CLASS_FAST_CPU = "fast_cpu"
SERVICE_CLASS_HEAVY_CPU_AU = "heavy_cpu_au"
SERVICE_CLASS_DOCAI_AU = "docai_au"
SERVICE_CLASS_VLM_GPU_SG = "vlm_gpu_sg"
SERVICE_CLASS_RASTER_ONLY = "raster_only"

SERVICE_CLASSES: Tuple[ServiceClass, ...] = (
    SERVICE_CLASS_FAST_CPU,
    SERVICE_CLASS_HEAVY_CPU_AU,
    SERVICE_CLASS_DOCAI_AU,
    SERVICE_CLASS_VLM_GPU_SG,
    SERVICE_CLASS_RASTER_ONLY,
)

# Classes that leave the local trust boundary. Fail-closed: they must never be
# routable unless the policy explicitly and independently approves each risk.
REMOTE_SERVICE_CLASSES = frozenset({SERVICE_CLASS_DOCAI_AU, SERVICE_CLASS_VLM_GPU_SG})
GPU_SERVICE_CLASSES = frozenset({SERVICE_CLASS_VLM_GPU_SG})
# Data-residency region each class executes in (logical, not a host).
SERVICE_CLASS_REGION = {
    SERVICE_CLASS_FAST_CPU: "local",
    SERVICE_CLASS_HEAVY_CPU_AU: "australia-southeast1",
    SERVICE_CLASS_DOCAI_AU: "australia-southeast1",
    SERVICE_CLASS_VLM_GPU_SG: "asia-southeast1",
    SERVICE_CLASS_RASTER_ONLY: "local",
}

# ── Safe, bounded reason/error vocabulary (no free-form leakage) ─────────────

ROUTING_SAFE_REASON_CODES: Tuple[str, ...] = (
    "route_class_local_default",
    "route_class_heavy_tables",
    "route_class_ocr_scanned",
    "route_class_design_heavy",
    "route_class_raster_only",
    "route_class_docai_requested",
    "route_class_vlm_requested",
    "route_blocked_class_disabled",
    "route_blocked_remote_not_approved",
    "route_blocked_residency_not_approved",
    "route_blocked_gpu_not_approved",
    "route_blocked_budget_exhausted",
    "route_fallback_raster_only",
    "route_target_unavailable",
    "cache_hit_artifact_complete",
    "cache_miss_no_fingerprint_match",
    "cache_miss_contract_version_mismatch",
    "cache_miss_incomplete_artifacts",
    "cache_reuse_forbidden_legacy_contract",
    "recovery_retry_same_route",
    "recovery_reroute_new_plan",
    "recovery_fallback_raster_only",
    "recovery_exhausted_manual_review",
    "recovery_abort_no_source_raster",
)

# ── Deterministic hashing (FNV-1a-32, byte-identical with E1 + E9) ───────────

_FNV_OFFSET = 0x811C9DC5
_FNV_PRIME = 0x01000193
_UINT32 = 0xFFFFFFFF


def fnv1a32(text: str) -> str:
    """8-char lowercase hex FNV-1a over the UTF-8 bytes of ``text``."""
    h = _FNV_OFFSET
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * _FNV_PRIME) & _UINT32
    return f"{h:08x}"


_SIGNED_URL_PREFIXES = ("http://", "https://", "blob:", "data:")


def is_signed_url(value: Any) -> bool:
    return isinstance(value, str) and value.lower().startswith(_SIGNED_URL_PREFIXES)


def is_durable_ref(value: Any) -> bool:
    """A durable object reference: non-empty, no scheme, no traversal, not absolute."""
    return (
        isinstance(value, str)
        and len(value) > 0
        and not is_signed_url(value)
        and not value.startswith("/")
        and ".." not in value.split("/")
    )


def stable_json(value: Any) -> str:
    """Deterministic JSON with sorted keys and compact separators (ASCII)."""
    import json

    def _sort(v: Any) -> Any:
        if isinstance(v, dict):
            return {k: _sort(v[k]) for k in sorted(v)}
        if isinstance(v, (list, tuple)):
            return [_sort(x) for x in v]
        return v

    return json.dumps(_sort(value), separators=(",", ":"), ensure_ascii=True)


def strip_urls(text: str) -> str:
    import re

    return re.sub(r"(https?|blob|data):\/\/[^\"'\s]+", "URL", text)


def stable_hash(prefix: str, value: Any) -> str:
    """``<prefix>-<fnv1a32(strip_urls(stable_json(value)))>`` — the canonical id form."""
    return f"{prefix}-{fnv1a32(strip_urls(stable_json(value)))}"


# ── Preflight (pdf-extraction-preflight-v1) ──────────────────────────────────
#
# The immutable, source-derived signal bundle the planner consumes. Everything
# here is a deterministic function of the source bytes + requested output; it
# carries NO wall-clock, NO signed URL, NO job id.


@dataclass(frozen=True)
class PdfExtractionPreflightV1:
    version: str
    source_sha256: str
    byte_size: int
    page_count: int
    file_type: str  # 'pdf'
    has_selectable_text: bool
    selectable_text_ratio: float
    scanned_page_ratio: float
    ocr_hint: bool
    image_heavy: bool
    design_heavy: bool
    table_likelihood: str  # low | medium | high
    encrypted: bool
    # Per-page raw signals used by complexity classification (bounded, ordered).
    page_signals: Tuple["PdfPageSignal", ...] = field(default_factory=tuple)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "source_sha256": self.source_sha256,
            "byte_size": self.byte_size,
            "page_count": self.page_count,
            "file_type": self.file_type,
            "has_selectable_text": self.has_selectable_text,
            "selectable_text_ratio": self.selectable_text_ratio,
            "scanned_page_ratio": self.scanned_page_ratio,
            "ocr_hint": self.ocr_hint,
            "image_heavy": self.image_heavy,
            "design_heavy": self.design_heavy,
            "table_likelihood": self.table_likelihood,
            "encrypted": self.encrypted,
            "page_signals": [p.to_dict() for p in self.page_signals],
        }


@dataclass(frozen=True)
class PdfPageSignal:
    page_number: int
    text_char_count: int
    text_coverage_ratio: float
    image_area_ratio: float
    vector_op_count: int
    has_scanned_layer: bool
    table_region_count: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "page_number": self.page_number,
            "text_char_count": self.text_char_count,
            "text_coverage_ratio": self.text_coverage_ratio,
            "image_area_ratio": self.image_area_ratio,
            "vector_op_count": self.vector_op_count,
            "has_scanned_layer": self.has_scanned_layer,
            "table_region_count": self.table_region_count,
        }


# ── Page complexity (pdf-page-complexity-v1) ─────────────────────────────────

COMPLEXITY_TIERS: Tuple[str, ...] = ("native_simple", "native_rich", "scanned", "design_heavy", "unreadable")


@dataclass(frozen=True)
class PdfPageComplexityV1:
    version: str
    page_number: int
    tier: str  # one of COMPLEXITY_TIERS
    requires_ocr: bool
    requires_tables: bool
    requires_raster: bool
    requires_vlm: bool
    reason_codes: Tuple[str, ...]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "page_number": self.page_number,
            "tier": self.tier,
            "requires_ocr": self.requires_ocr,
            "requires_tables": self.requires_tables,
            "requires_raster": self.requires_raster,
            "requires_vlm": self.requires_vlm,
            "reason_codes": list(self.reason_codes),
        }


# ── Service class registry (pdf-service-class-registry-v1) ───────────────────


@dataclass(frozen=True)
class ServiceClassCapabilityV1:
    service_class: str
    region: str
    remote: bool
    gpu: bool
    supports_native: bool
    supports_ocr: bool
    supports_tables: bool
    supports_vlm: bool
    supports_raster: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "service_class": self.service_class,
            "region": self.region,
            "remote": self.remote,
            "gpu": self.gpu,
            "supports_native": self.supports_native,
            "supports_ocr": self.supports_ocr,
            "supports_tables": self.supports_tables,
            "supports_vlm": self.supports_vlm,
            "supports_raster": self.supports_raster,
        }


@dataclass(frozen=True)
class ServiceClassRegistryV1:
    version: str
    registry_id: str
    classes: Tuple[ServiceClassCapabilityV1, ...]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "registry_id": self.registry_id,
            "classes": [c.to_dict() for c in self.classes],
        }

    def get(self, service_class: str) -> Optional[ServiceClassCapabilityV1]:
        for c in self.classes:
            if c.service_class == service_class:
                return c
        return None


# ── Routing policy (pdf-service-routing-policy-v1) ───────────────────────────


@dataclass(frozen=True)
class ServiceRoutingPolicyV1:
    version: str
    policy_id: str
    enabled_classes: Tuple[str, ...]
    remote_classes_enabled: bool
    gpu_classes_enabled: bool
    approved_regions: Tuple[str, ...]
    require_explicit_remote_approval: bool
    max_remote_pages_per_job: int
    max_gpu_pages_per_job: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "policy_id": self.policy_id,
            "enabled_classes": list(self.enabled_classes),
            "remote_classes_enabled": self.remote_classes_enabled,
            "gpu_classes_enabled": self.gpu_classes_enabled,
            "approved_regions": list(self.approved_regions),
            "require_explicit_remote_approval": self.require_explicit_remote_approval,
            "max_remote_pages_per_job": self.max_remote_pages_per_job,
            "max_gpu_pages_per_job": self.max_gpu_pages_per_job,
        }


# ── Route decision (pdf-service-route-decision-v1) ───────────────────────────


@dataclass(frozen=True)
class ServiceRouteDecisionV1:
    version: str
    # The class the planner WOULD pick from complexity alone (before policy).
    desired_class: str
    # The class actually granted after fail-closed policy gating.
    resolved_class: str
    admitted: bool
    reason_codes: Tuple[str, ...]
    page_numbers: Tuple[int, ...]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "desired_class": self.desired_class,
            "resolved_class": self.resolved_class,
            "admitted": self.admitted,
            "reason_codes": list(self.reason_codes),
            "page_numbers": list(self.page_numbers),
        }


# ── Execution target (pdf-execution-target-v1) ───────────────────────────────
#
# The physical binding of a class to a concrete target. The target REFERENCE is
# a logical name / secret key, never a literal URL or credential — resolving it
# to a host is the runtime's job, kept out of the plan and out of any hash.


@dataclass(frozen=True)
class ExecutionTargetV1:
    version: str
    service_class: str
    target_ref: str  # logical binding name (e.g. env/secret key), NOT a URL
    region: str
    available: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "service_class": self.service_class,
            "target_ref": self.target_ref,
            "region": self.region,
            "available": self.available,
        }


# ── Execution attempt (pdf-execution-attempt-v1) ─────────────────────────────
#
# An audit record of one attempt. attempt_index and outcome are recorded, but
# they are DELIBERATELY excluded from every identity hash so a retry never
# changes the plan.


@dataclass(frozen=True)
class ExecutionAttemptV1:
    version: str
    plan_id: str
    route_class: str
    attempt_index: int
    outcome: str  # started | succeeded | failed | timed_out | aborted
    safe_error_code: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "plan_id": self.plan_id,
            "route_class": self.route_class,
            "attempt_index": self.attempt_index,
            "outcome": self.outcome,
            "safe_error_code": self.safe_error_code,
        }


# ── Chunk plan (part of Plan V3) ─────────────────────────────────────────────


@dataclass(frozen=True)
class ChunkPlanEntryV3:
    chunk_index: int
    page_start: int
    page_end: int
    service_class: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chunk_index": self.chunk_index,
            "page_start": self.page_start,
            "page_end": self.page_end,
            "service_class": self.service_class,
        }


# ── Plan V3 (pdf-extraction-plan-v3) ─────────────────────────────────────────


@dataclass(frozen=True)
class PdfExtractionPlanV3:
    version: str
    plan_id: str
    plan_hash: str
    planner_impl_version: str
    registry_id: str
    routing_policy_id: str
    provider_policy_id: str
    source_sha256: str
    requested_mode: str
    allow_mode_override: bool
    effective_mode: str
    page_count: int
    page_classifications: Tuple[PdfPageComplexityV1, ...]
    route_decisions: Tuple[ServiceRouteDecisionV1, ...]
    chunk_plan: Tuple[ChunkPlanEntryV3, ...]
    cache_fingerprint: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "plan_id": self.plan_id,
            "plan_hash": self.plan_hash,
            "planner_impl_version": self.planner_impl_version,
            "registry_id": self.registry_id,
            "routing_policy_id": self.routing_policy_id,
            "provider_policy_id": self.provider_policy_id,
            "source_sha256": self.source_sha256,
            "requested_mode": self.requested_mode,
            "allow_mode_override": self.allow_mode_override,
            "effective_mode": self.effective_mode,
            "page_count": self.page_count,
            "page_classifications": [p.to_dict() for p in self.page_classifications],
            "route_decisions": [r.to_dict() for r in self.route_decisions],
            "chunk_plan": [c.to_dict() for c in self.chunk_plan],
            "cache_fingerprint": self.cache_fingerprint,
        }

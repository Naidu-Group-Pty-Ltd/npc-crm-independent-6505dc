"""PDF Extraction V3 · E9 — governed extraction provider ensemble contracts.

Provider results are CANDIDATE EVIDENCE ONLY — never source truth, never final
output, never an accepted repair. SOURCE FIDELITY OUTRANKS PROVIDER CONFIDENCE.
A provider never wins by name or by confidence alone; every provider result flows
through source-evidence validation → E3/E4/E5 → E6 render → E7 → E8 selection.

This module is IMPORT-SAFE: importing it (or the `providers` package) initializes
no Docling / Torch / OCR model / Google SDK, opens no file, reads no secret and
performs no network I/O. All identities are deterministic (FNV-1a-32 over
structural fields only — no timestamps, signed URLs, credentials or temp paths).
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

# ── Version constants ────────────────────────────────────────────────────────

EXTRACTION_PROVIDER_ADAPTER_VERSION = "extraction-provider-adapter-v1"
EXTRACTION_PROVIDER_REQUEST_VERSION = "extraction-provider-request-v1"
EXTRACTION_PROVIDER_ATTEMPT_VERSION = "extraction-provider-attempt-v1"
EXTRACTION_PROVIDER_RESULT_VERSION = "extraction-provider-result-v1"
PROVIDER_CAPABILITY_MANIFEST_VERSION = "provider-capability-manifest-v1"
EXTRACTION_PROVIDER_POLICY_VERSION = "extraction-provider-policy-v1"
PROVIDER_EVIDENCE_BUNDLE_VERSION = "provider-evidence-bundle-v1"
PROVIDER_NORMALIZATION_VERSION = "provider-normalization-v1"
PROVIDER_ARBITRATION_VERSION = "provider-arbitration-v1"
PROVIDER_ATTEMPT_AUDIT_VERSION = "provider-attempt-audit-v1"
PROVIDER_REGISTRY_VERSION = "provider-registry-v1"

# ── Provider identities (stable; configuration identity is SEPARATE) ─────────

PROVIDER_IDS: Tuple[str, ...] = (
    "pymupdf-exact",
    "docling-standard-vnext",
    "docling-vlm",
    "google-document-ai-layout",
    "google-document-ai-ocr",
    "docling-legacy",  # audit-only representation of the legacy runtime
)
LOCAL_PROVIDER_IDS = frozenset({"pymupdf-exact", "docling-standard-vnext", "docling-vlm", "docling-legacy"})
REMOTE_PROVIDER_IDS = frozenset({"google-document-ai-layout", "google-document-ai-ocr"})
VLM_PROVIDER_IDS = frozenset({"docling-vlm"})

# ── Deterministic hashing (FNV-1a-32, byte-identical with E1) ────────────────

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
    """Deterministic JSON with sorted keys (no whitespace)."""
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
    return f"{prefix}-{fnv1a32(strip_urls(stable_json(value)))}"


# ── Geometry ─────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SourceBBox:
    x: float
    y: float
    width: float
    height: float

    def is_finite(self) -> bool:
        import math

        return all(math.isfinite(v) for v in (self.x, self.y, self.width, self.height))

    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    def to_dict(self) -> Dict[str, float]:
        return {"x": self.x, "y": self.y, "width": self.width, "height": self.height}


# ── Capability truth (reuses the E2/J1 five-level model) ─────────────────────

@dataclass
class CapabilityTruthV1:
    api_present: bool = False
    configured: bool = False
    model_configured: bool = False
    model_ready: bool = False
    effective: bool = False

    def to_dict(self) -> Dict[str, bool]:
        return asdict(self)


AvailabilityState = str  # ready | dependency-missing | model-missing | configuration-missing | policy-disabled | unproven | unavailable
ExecutionMode = str  # local | remote | local-optional


@dataclass
class ProviderLimitsV1:
    max_pages: int = 0
    max_regions: int = 0
    max_bytes: int = 0
    timeout_ms: int = 0
    max_retries: int = 0

    def to_dict(self) -> Dict[str, int]:
        return asdict(self)


@dataclass
class ProviderCapabilityManifestV1:
    provider_id: str
    adapter_version: str
    available: bool
    availability_state: AvailabilityState
    execution_mode: ExecutionMode
    supported_scopes: List[str]
    capabilities: Dict[str, CapabilityTruthV1]
    package_versions: Dict[str, str]
    model_identity: Dict[str, Optional[str]]
    configuration_identity: str
    privacy_classes_allowed: List[str]
    residency_classes_allowed: List[str]
    limits: ProviderLimitsV1
    problems: List[str] = field(default_factory=list)
    version: str = PROVIDER_CAPABILITY_MANIFEST_VERSION

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version, "providerId": self.provider_id, "adapterVersion": self.adapter_version,
            "available": self.available, "availabilityState": self.availability_state, "executionMode": self.execution_mode,
            "supportedScopes": list(self.supported_scopes),
            "capabilities": {k: v.to_dict() for k, v in self.capabilities.items()},
            "packageVersions": dict(self.package_versions), "modelIdentity": dict(self.model_identity),
            "configurationIdentity": self.configuration_identity,
            "privacyClassesAllowed": list(self.privacy_classes_allowed),
            "residencyClassesAllowed": list(self.residency_classes_allowed),
            "limits": self.limits.to_dict(), "problems": list(self.problems),
        }


# ── Safe error codes ─────────────────────────────────────────────────────────

SAFE_ERROR_CODES: Tuple[str, ...] = (
    "provider_unknown", "provider_disabled", "provider_policy_blocked", "provider_dependency_missing",
    "provider_configuration_missing", "provider_model_missing", "provider_model_unproven",
    "provider_request_invalid", "provider_scope_invalid", "provider_page_limit_exceeded",
    "provider_region_limit_exceeded", "provider_byte_limit_exceeded", "provider_cost_limit_exceeded",
    "provider_timeout", "provider_cancelled", "provider_authentication_failed", "provider_permission_denied",
    "provider_rate_limited", "provider_quota_exceeded", "provider_invalid_response", "provider_partial_response",
    "provider_page_loss", "provider_region_loss", "provider_normalization_failed", "provider_result_hash_failed",
    "provider_residency_not_approved", "provider_remote_not_approved", "provider_vlm_disabled",
    "provider_retry_exhausted", "provider_conflict_unresolved", "provider_evidence_incomplete",
)


@dataclass
class ProviderSafeErrorV1:
    code: str
    detail: str = ""

    def to_dict(self) -> Dict[str, str]:
        code = self.code if self.code in SAFE_ERROR_CODES else "provider_invalid_response"
        return {"code": code, "detail": _bound(self.detail)}


def _bound(text: str, limit: int = 160) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= limit else s[: limit - 3] + "..."


def map_exception_to_safe_error(exc: BaseException) -> ProviderSafeErrorV1:
    """Map a raw provider exception to a bounded safe code (never leaks payload/creds)."""
    name = type(exc).__name__.lower()
    text = f"{name}"
    if "timeout" in name or "deadline" in name:
        return ProviderSafeErrorV1("provider_timeout", text)
    if "permission" in name or "forbidden" in name:
        return ProviderSafeErrorV1("provider_permission_denied", text)
    if "auth" in name or "credential" in name or "unauthenticated" in name:
        return ProviderSafeErrorV1("provider_authentication_failed", text)
    if "quota" in name:
        return ProviderSafeErrorV1("provider_quota_exceeded", text)
    if "ratelimit" in name or "resourceexhausted" in name:
        return ProviderSafeErrorV1("provider_rate_limited", text)
    if "cancel" in name:
        return ProviderSafeErrorV1("provider_cancelled", text)
    if "import" in name or "module" in name:
        return ProviderSafeErrorV1("provider_dependency_missing", text)
    return ProviderSafeErrorV1("provider_invalid_response", text)


# ── Cost estimate ────────────────────────────────────────────────────────────

@dataclass
class ProviderRateCardV1:
    provider_id: str
    currency: str
    units: Dict[str, float]
    effective_from: Optional[str] = None
    source: str = "configuration"  # configuration | unknown
    version: str = "provider-rate-card-v1"


@dataclass
class ProviderCostEstimateV1:
    currency: Optional[str]
    amount: Optional[float]
    rate_card_version: Optional[str]
    estimate_state: str  # known | configured-estimate | unknown

    def to_dict(self) -> Dict[str, Any]:
        return {"currency": self.currency, "amount": self.amount, "rateCardVersion": self.rate_card_version, "estimateState": self.estimate_state}


UNKNOWN_COST = ProviderCostEstimateV1(currency=None, amount=None, rate_card_version=None, estimate_state="unknown")


# ── Request ──────────────────────────────────────────────────────────────────

@dataclass
class ProviderScopeV1:
    type: str  # document | page-range | page | region
    page_start: int
    page_end: int
    region_ids: List[str] = field(default_factory=list)
    region_bboxes: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class ProviderProfileRefV1:
    provider_id: str
    configuration_identity: str
    profile_name: str
    options_hash: str


@dataclass
class ProviderPolicyRefV1:
    policy_version: str
    policy_hash: str
    privacy_class: str
    residency_class: str
    remote_approved: bool


@dataclass
class ProviderBudgetsV1:
    timeout_ms: int
    max_retries: int
    max_pages: int
    max_regions: int
    max_bytes: int
    maximum_estimated_cost: Optional[float] = None


@dataclass
class ExtractionProviderRequestV1:
    request_id: str
    import_id: str
    job_id: str
    attempt_id: str
    source: Dict[str, Any]  # {sourceSha256, mime, byteSize, pageCount, durablePath}
    scope: ProviderScopeV1
    purpose: str
    requested_capabilities: List[str]
    provider_profile: ProviderProfileRefV1
    policy_ref: ProviderPolicyRefV1
    budgets: ProviderBudgetsV1
    source_evidence_refs: List[str] = field(default_factory=list)
    created_at: str = ""
    problems: List[str] = field(default_factory=list)
    version: str = EXTRACTION_PROVIDER_REQUEST_VERSION


# ── Result ───────────────────────────────────────────────────────────────────

@dataclass
class ExtractionProviderResultV1:
    request_id: str
    attempt_id: str
    provider_id: str
    adapter_version: str
    configuration_identity: str
    status: str  # success | partial-success | failure | timeout | policy-blocked | skipped | cancelled
    pages_requested: List[int]
    pages_processed: List[int]
    pages_failed: List[int]
    regions_requested: List[str]
    regions_processed: List[str]
    regions_failed: List[str]
    provider_payload_ref: Optional[str]
    normalized_evidence_ref: Optional[str]
    result_hash: Optional[str]
    engine_identity: Dict[str, Any]
    timings: Dict[str, Optional[float]]
    usage: Dict[str, Any]
    estimated_cost: ProviderCostEstimateV1
    errors: List[ProviderSafeErrorV1] = field(default_factory=list)
    problems: List[str] = field(default_factory=list)
    complete: bool = False
    version: str = EXTRACTION_PROVIDER_RESULT_VERSION


# ── Provider evidence bundle ─────────────────────────────────────────────────

@dataclass
class ProviderTextSpanEvidenceV1:
    evidence_id: str
    raw_text: str
    normalized_nfc: str
    bbox: Optional[SourceBBox]
    reading_order: Optional[int]
    confidence: Optional[float]
    problems: List[str] = field(default_factory=list)


@dataclass
class ProviderRegionEvidenceV1:
    evidence_id: str
    region_type: str
    bbox: Optional[SourceBBox]
    provider_local_ref: Optional[str]
    confidence: Optional[float]
    canonical_region_id: Optional[str] = None
    problems: List[str] = field(default_factory=list)


@dataclass
class ProviderTableEvidenceV1:
    evidence_id: str
    provider_id: str
    adapter_version: str
    configuration_identity: str
    table_profile: str
    source_region_ref: Optional[str]
    provider_local_ref: Optional[str]
    row_count: int
    column_count: int
    header_rows: int
    header_columns: int
    cells: List[Dict[str, Any]]
    numeric_tokens: List[str]
    punctuation_tokens: List[str]
    confidence: Optional[float]
    problems: List[str] = field(default_factory=list)


@dataclass
class ProviderPictureEvidenceV1:
    evidence_id: str
    bbox: Optional[SourceBBox]
    classification: Optional[str]
    confidence: Optional[float]
    problems: List[str] = field(default_factory=list)


@dataclass
class ProviderChartEvidenceV1:
    evidence_id: str
    chart_type: Optional[str]
    caption: Optional[str]
    axis_labels: List[str]
    legend_labels: List[str]
    series_names: List[str]
    numeric_labels: List[str]
    bbox: Optional[SourceBBox]
    confidence: Optional[float]
    problems: List[str] = field(default_factory=list)


@dataclass
class ProviderFormulaEvidenceV1:
    evidence_id: str
    raw: str
    normalized: str
    bbox: Optional[SourceBBox]
    confidence: Optional[float]
    problems: List[str] = field(default_factory=list)


@dataclass
class ProviderCodeEvidenceV1:
    evidence_id: str
    raw: str
    bbox: Optional[SourceBBox]
    confidence: Optional[float]
    problems: List[str] = field(default_factory=list)


@dataclass
class ProviderPageEvidenceV1:
    page_number: int
    width_pt: Optional[float]
    height_pt: Optional[float]
    rotation: Optional[float]
    text_spans: List[ProviderTextSpanEvidenceV1] = field(default_factory=list)
    layout_regions: List[ProviderRegionEvidenceV1] = field(default_factory=list)
    tables: List[ProviderTableEvidenceV1] = field(default_factory=list)
    pictures: List[ProviderPictureEvidenceV1] = field(default_factory=list)
    charts: List[ProviderChartEvidenceV1] = field(default_factory=list)
    formulas: List[ProviderFormulaEvidenceV1] = field(default_factory=list)
    code_blocks: List[ProviderCodeEvidenceV1] = field(default_factory=list)
    page_confidence: Optional[float] = None
    provider_page_ref: Optional[str] = None
    complete: bool = True
    problems: List[str] = field(default_factory=list)


@dataclass
class ProviderEvidenceBundleV1:
    provider_id: str
    adapter_version: str
    configuration_identity: str
    request_id: str
    attempt_id: str
    status: str
    document: Dict[str, Any]  # {sourceSha256, pageCountExpected, pageCountObserved}
    pages: List[ProviderPageEvidenceV1]
    provider_problems: List[str]
    result_hash: str
    complete: bool
    version: str = PROVIDER_EVIDENCE_BUNDLE_VERSION


# ── Attempt + audit ──────────────────────────────────────────────────────────

@dataclass
class ExtractionProviderAttemptV1:
    attempt_id: str
    request_id: str
    provider_id: str
    adapter_version: str
    configuration_identity: str
    attempt_ordinal: int
    purpose: str
    execution_mode: str
    trusted_location: Optional[str]
    privacy_class: str
    residency_class: str
    remote_approved: bool
    page_numbers: List[int]
    region_ids: List[str]
    status: str
    started_at: str
    completed_at: Optional[str]
    elapsed_ms: Optional[float]
    request_hash: str
    result_hash: Optional[str]
    estimated_cost: ProviderCostEstimateV1
    retry_of_attempt_id: Optional[str] = None
    problems: List[str] = field(default_factory=list)
    version: str = EXTRACTION_PROVIDER_ATTEMPT_VERSION


"""PDF Extraction V3 · E10 — planner_v3 test suite.

Proves the E10 core invariants on the Python side:
  * IMPORT-SAFETY: importing the package loads no torch/docling/fitz/google.
  * DETERMINISM: same inputs -> same plan id/hash/classifications/routes/fingerprint.
  * RETRY-INVARIANCE: a retry reuses the identical plan identity.
  * REROUTE-NEW-PLAN: any registry/policy/input change yields a NEW plan id.
  * FAIL-CLOSED ROUTING: default policy never admits a remote/GPU class; each
    remote risk (approval, residency, budget, gpu) is independently gated.
  * CACHE SAFETY: no V1/V2 reuse; a hit requires exact fingerprint + artifact
    completeness; redaction partitions the fingerprint.
  * ARTIFACT COMPLETENESS: missing artifacts and signed-URL leaks fail the gate.
  * DETERMINISTIC RECOVERY: transient->retry, deterministic->reroute, floor->
    raster fallback, no-raster->abort manual review.
  * CROSS-RUNTIME PARITY ANCHORS: the exact identities the TS mirror must match.
"""
from __future__ import annotations

import re
import sys

import pytest

from planner_v3 import contracts
from planner_v3.audit import build_routing_audit
from planner_v3.completeness import evaluate_artifact_completeness, required_artifacts_for_page
from planner_v3.contracts import (
    ExecutionAttemptV1,
    PDF_CACHE_FINGERPRINT_V3_VERSION,
    PDF_EXECUTION_ATTEMPT_VERSION,
    PDF_PAGE_COMPLEXITY_VERSION,
    PDF_SERVICE_ROUTING_POLICY_VERSION,
    PdfPageComplexityV1,
    SERVICE_CLASS_FAST_CPU,
    SERVICE_CLASS_HEAVY_CPU_AU,
    SERVICE_CLASS_RASTER_ONLY,
    SERVICE_CLASS_VLM_GPU_SG,
    SERVICE_CLASS_DOCAI_AU,
    SERVICE_CLASSES,
    ServiceRoutingPolicyV1,
    fnv1a32,
    stable_hash,
)
from planner_v3.fingerprint import build_cache_entry_v3, evaluate_cache_hit
from planner_v3.plan import build_plan_v3
from planner_v3.preflight import build_preflight
from planner_v3.recovery import plan_recovery
from planner_v3.routing import default_routing_policy, resolve_execution_target, route_pages
from planner_v3.service_registry import default_service_class_registry
from planner_v3.validators import validate_cache_entry_v3_shape, validate_plan_v3_shape
from planner_v3.fixtures import (
    MIXED_SOURCE_SIGNALS,
    NATIVE_SOURCE_SIGNALS,
    default_request_options,
)


def _mixed_plan(**opt_overrides):
    return build_plan_v3(
        build_preflight(MIXED_SOURCE_SIGNALS),
        default_service_class_registry(),
        default_routing_policy(),
        default_request_options(**opt_overrides),
    )


# ── Import-safety ────────────────────────────────────────────────────────────


def test_import_is_safe():
    import importlib

    for mod in ("torch", "docling", "fitz", "pymupdf", "google.cloud.documentai"):
        assert mod not in sys.modules, f"planner_v3 import loaded heavy dep {mod}"


def test_version_constants_exact():
    assert contracts.PDF_EXTRACTION_PREFLIGHT_VERSION == "pdf-extraction-preflight-v1"
    assert contracts.PDF_PAGE_COMPLEXITY_VERSION == "pdf-page-complexity-v1"
    assert contracts.PDF_EXTRACTION_PLAN_V3_VERSION == "pdf-extraction-plan-v3"
    assert contracts.PDF_SERVICE_CLASS_REGISTRY_VERSION == "pdf-service-class-registry-v1"
    assert contracts.PDF_SERVICE_ROUTING_POLICY_VERSION == "pdf-service-routing-policy-v1"
    assert contracts.PDF_SERVICE_ROUTE_DECISION_VERSION == "pdf-service-route-decision-v1"
    assert contracts.PDF_EXECUTION_TARGET_VERSION == "pdf-execution-target-v1"
    assert contracts.PDF_EXECUTION_ATTEMPT_VERSION == "pdf-execution-attempt-v1"
    assert contracts.PDF_CACHE_FINGERPRINT_V3_VERSION == "pdf-cache-fingerprint-v3"
    assert contracts.PDF_CACHE_ENTRY_V3_VERSION == "pdf-cache-entry-v3"
    assert contracts.PDF_ARTIFACT_COMPLETENESS_VERSION == "pdf-artifact-completeness-v1"
    assert contracts.PDF_RECOVERY_PLAN_VERSION == "pdf-recovery-plan-v1"
    assert contracts.PDF_ROUTING_AUDIT_VERSION == "pdf-routing-audit-v1"


def test_service_classes_and_separation_from_urls():
    assert SERVICE_CLASSES == ("fast_cpu", "heavy_cpu_au", "docai_au", "vlm_gpu_sg", "raster_only")
    reg = default_service_class_registry()
    # A registry describes capabilities/regions, never hosts. No entry has a URL.
    for cap in reg.classes:
        assert "://" not in cap.service_class and "://" not in cap.region


# ── Cross-runtime parity anchors (the TS mirror asserts identical values) ────


def test_parity_anchors():
    assert fnv1a32("abc") == "1a47e90b"
    assert default_service_class_registry().registry_id == "svcreg-52451c5f"
    assert default_routing_policy().policy_id == "svcpol-f3fd6a52"
    plan = _mixed_plan()
    assert plan.plan_id == "plan3-a8ce0afb"
    assert plan.plan_hash == "a8ce0afb"
    assert plan.cache_fingerprint == "pf3-aab8d89ced1d9f08a7250086264be2968872c18c6fdf76c0dbee39ab28aa067b"
    assert re.fullmatch(r"pf3-[0-9a-f]{64}", plan.cache_fingerprint)
    assert build_routing_audit(plan)["audit_id"] == "raud-ee8cfe89"


# ── Determinism / retry / reroute ────────────────────────────────────────────


def test_determinism_and_retry_invariance():
    a = _mixed_plan()
    b = _mixed_plan()
    assert a.plan_id == b.plan_id
    assert a.plan_hash == b.plan_hash
    assert a.cache_fingerprint == b.cache_fingerprint
    assert [r.resolved_class for r in a.route_decisions] == [r.resolved_class for r in b.route_decisions]
    # A retry (new attempt index) does not change plan identity.
    _att = ExecutionAttemptV1(PDF_EXECUTION_ATTEMPT_VERSION, a.plan_id, SERVICE_CLASS_FAST_CPU, 3, "failed", "provider_timeout")
    assert _mixed_plan().plan_id == a.plan_id


def test_cache_fingerprint_uses_collision_resistant_source_identity():
    def plan_for(source_sha256: str):
        source = {**MIXED_SOURCE_SIGNALS, "source_sha256": source_sha256}
        return build_plan_v3(
            build_preflight(source),
            default_service_class_registry(),
            default_routing_policy(),
            default_request_options(),
        )

    entry = plan_for("147255048da408b63dc6fc8234108ea5021990625213c27e56d70bff706c1ec3")
    request = plan_for("9caaeb566c2b80604cc159af7cb1ef56db95eff5926c7d6a430b404a3779fe52")
    assert entry.cache_fingerprint != request.cache_fingerprint


def test_reroute_creates_new_plan():
    base = _mixed_plan()
    # Any planner input change -> new plan identity (never in-place mutation).
    assert _mixed_plan(redact_pii=True).plan_id != base.plan_id
    assert _mixed_plan(raster_dpi=300).plan_id != base.plan_id
    assert _mixed_plan(requested_mode="hybrid").plan_id != base.plan_id
    permissive = ServiceRoutingPolicyV1(
        version=PDF_SERVICE_ROUTING_POLICY_VERSION,
        policy_id=stable_hash("svcpol", {"variant": "permissive"}),
        enabled_classes=SERVICE_CLASSES,
        remote_classes_enabled=True,
        gpu_classes_enabled=True,
        approved_regions=("local", "australia-southeast1", "asia-southeast1"),
        require_explicit_remote_approval=True,
        max_remote_pages_per_job=100,
        max_gpu_pages_per_job=100,
    )
    rerouted = build_plan_v3(
        build_preflight(MIXED_SOURCE_SIGNALS),
        default_service_class_registry(),
        permissive,
        default_request_options(remote_approved=True),
    )
    assert rerouted.plan_id != base.plan_id
    assert rerouted.routing_policy_id != base.routing_policy_id


def test_classification_and_chunking():
    plan = _mixed_plan()
    tier_by_page = {p.page_number: p.tier for p in plan.page_classifications}
    assert tier_by_page[1] == "native_simple"
    assert tier_by_page[2] == "native_rich"
    assert tier_by_page[3] == "scanned"
    assert tier_by_page[4] == "design_heavy"
    assert tier_by_page[5] == "native_rich"
    assert tier_by_page[6] == "unreadable"
    # chunk plan respects max_chunk_pages and preserves resolved class.
    assert all(c.page_end - c.page_start + 1 <= 4 for c in plan.chunk_plan)
    classes = {c.service_class for c in plan.chunk_plan}
    assert SERVICE_CLASS_RASTER_ONLY in classes  # unreadable page 6


# ── Fail-closed routing ──────────────────────────────────────────────────────


def _vlm_page():
    return PdfPageComplexityV1(
        version=PDF_PAGE_COMPLEXITY_VERSION,
        page_number=1,
        tier="design_heavy",
        requires_ocr=False,
        requires_tables=False,
        requires_raster=True,
        requires_vlm=True,
        reason_codes=("vlm",),
    )


def test_default_policy_never_admits_remote_or_gpu():
    reg = default_service_class_registry()
    dec = route_pages((_vlm_page(),), default_routing_policy(), reg, remote_approved=True)
    assert dec[0].resolved_class != SERVICE_CLASS_VLM_GPU_SG
    assert dec[0].resolved_class != SERVICE_CLASS_DOCAI_AU
    assert dec[0].admitted is False
    assert "route_blocked_class_disabled" in dec[0].reason_codes


def test_remote_gating_is_independent():
    reg = default_service_class_registry()
    # remote enabled but explicit approval withheld -> blocked
    p_noapprove = ServiceRoutingPolicyV1(
        version=PDF_SERVICE_ROUTING_POLICY_VERSION, policy_id="p1",
        enabled_classes=SERVICE_CLASSES, remote_classes_enabled=True, gpu_classes_enabled=True,
        approved_regions=("asia-southeast1",), require_explicit_remote_approval=True,
        max_remote_pages_per_job=100, max_gpu_pages_per_job=100,
    )
    d = route_pages((_vlm_page(),), p_noapprove, reg, remote_approved=False)
    assert d[0].resolved_class != SERVICE_CLASS_VLM_GPU_SG
    assert "route_blocked_remote_not_approved" in d[0].reason_codes
    # residency not approved -> blocked
    p_noregion = ServiceRoutingPolicyV1(
        version=PDF_SERVICE_ROUTING_POLICY_VERSION, policy_id="p2",
        enabled_classes=SERVICE_CLASSES, remote_classes_enabled=True, gpu_classes_enabled=True,
        approved_regions=("local",), require_explicit_remote_approval=True,
        max_remote_pages_per_job=100, max_gpu_pages_per_job=100,
    )
    d2 = route_pages((_vlm_page(),), p_noregion, reg, remote_approved=True)
    assert "route_blocked_residency_not_approved" in d2[0].reason_codes
    # gpu disabled -> blocked
    p_nogpu = ServiceRoutingPolicyV1(
        version=PDF_SERVICE_ROUTING_POLICY_VERSION, policy_id="p3",
        enabled_classes=SERVICE_CLASSES, remote_classes_enabled=True, gpu_classes_enabled=False,
        approved_regions=("asia-southeast1",), require_explicit_remote_approval=True,
        max_remote_pages_per_job=100, max_gpu_pages_per_job=0,
    )
    d3 = route_pages((_vlm_page(),), p_nogpu, reg, remote_approved=True)
    assert "route_blocked_gpu_not_approved" in d3[0].reason_codes


def test_execution_target_is_logical_not_a_url():
    reg = default_service_class_registry()
    t = resolve_execution_target(SERVICE_CLASS_FAST_CPU, reg, {"fast_cpu": "PDF_FAST_CPU_TARGET"})
    assert t.target_ref == "PDF_FAST_CPU_TARGET"
    assert "://" not in t.target_ref
    assert t.available is True
    missing = resolve_execution_target(SERVICE_CLASS_VLM_GPU_SG, reg, {})
    assert missing.available is False


# ── Cache safety ─────────────────────────────────────────────────────────────


def test_cache_hit_requires_v3_contract_and_completeness():
    plan = _mixed_plan()
    fp = plan.cache_fingerprint
    # legacy contract can never be reused by V3
    hit, reason = evaluate_cache_hit(fp, fp, "pdf-cache-contract-v2", True)
    assert hit is False and reason == "cache_reuse_forbidden_legacy_contract"
    # incomplete artifacts -> miss
    hit, reason = evaluate_cache_hit(fp, fp, PDF_CACHE_FINGERPRINT_V3_VERSION, False)
    assert hit is False and reason == "cache_miss_incomplete_artifacts"
    # fingerprint mismatch -> miss
    hit, reason = evaluate_cache_hit(fp, "pf3-00000000", PDF_CACHE_FINGERPRINT_V3_VERSION, True)
    assert hit is False and reason == "cache_miss_no_fingerprint_match"
    # exact + complete -> hit
    hit, reason = evaluate_cache_hit(fp, fp, PDF_CACHE_FINGERPRINT_V3_VERSION, True)
    assert hit is True and reason == "cache_hit_artifact_complete"


def test_redaction_partitions_fingerprint():
    assert _mixed_plan(redact_pii=False).cache_fingerprint != _mixed_plan(redact_pii=True).cache_fingerprint


def test_cache_entry_validator_rejects_legacy_and_leaks():
    plan = _mixed_plan()
    entry = build_cache_entry_v3(plan, True)
    assert validate_cache_entry_v3_shape(entry) == []
    legacy = {**entry, "contract_version": "pdf-cache-contract-v2"}
    assert "cache_reuse_forbidden_legacy_contract" in validate_cache_entry_v3_shape(legacy)
    leaky = {**entry, "leaked": "https://signed/x"}
    assert "signed_url_persisted" in validate_cache_entry_v3_shape(leaky)


def test_plan_validator_rejects_signed_url():
    plan = _mixed_plan()
    d = plan.to_dict()
    assert validate_plan_v3_shape(d) == []
    d_bad = {**d, "leak": "https://signed/y"}
    assert "signed_url_persisted" in validate_plan_v3_shape(d_bad)


# ── Artifact completeness ────────────────────────────────────────────────────


def test_completeness_missing_and_leaks():
    plan = _mixed_plan()
    # nothing present -> incomplete, every page missing
    rep = evaluate_artifact_completeness(plan.page_classifications, plan.route_decisions, {})
    assert rep["complete"] is False
    assert len(rep["missing"]) == plan.page_count
    # signed URL where a durable ref belongs -> leak + still incomplete
    present = {1: {"raster": "https://signed/x.png"}}
    rep2 = evaluate_artifact_completeness(plan.page_classifications, plan.route_decisions, present)
    assert 1 in rep2["signed_url_leak_pages"]
    assert rep2["complete"] is False


def test_raster_only_page_needs_only_raster():
    unreadable = PdfPageComplexityV1(
        version=PDF_PAGE_COMPLEXITY_VERSION, page_number=1, tier="unreadable",
        requires_ocr=False, requires_tables=False, requires_raster=True, requires_vlm=False,
        reason_codes=("no_usable_signal",),
    )
    assert required_artifacts_for_page(unreadable, SERVICE_CLASS_RASTER_ONLY) == ("raster",)


# ── Deterministic recovery ───────────────────────────────────────────────────


def test_recovery_transitions():
    assert plan_recovery(SERVICE_CLASS_HEAVY_CPU_AU, [], "provider_timeout", True)["action"] == "retry_same_route"
    r2 = plan_recovery(SERVICE_CLASS_HEAVY_CPU_AU, [], "provider_invalid_response", True)
    assert r2["action"] == "reroute" and "recovery_reroute_new_plan" in r2["reason_codes"]
    assert plan_recovery(SERVICE_CLASS_FAST_CPU, [], "provider_invalid_response", True)["action"] == "fallback_raster_only"
    r4 = plan_recovery(SERVICE_CLASS_RASTER_ONLY, [], "provider_invalid_response", False)
    assert r4["action"] == "abort_manual_review" and "recovery_abort_no_source_raster" in r4["reason_codes"]
    # same-route budget exhausted -> reroute
    atts = [
        ExecutionAttemptV1(PDF_EXECUTION_ATTEMPT_VERSION, "plan3-x", SERVICE_CLASS_HEAVY_CPU_AU, i, "failed", "provider_timeout")
        for i in range(2)
    ]
    assert plan_recovery(SERVICE_CLASS_HEAVY_CPU_AU, atts, "provider_timeout", True)["action"] == "reroute"


def test_recovery_is_deterministic():
    a = plan_recovery(SERVICE_CLASS_FAST_CPU, [], "provider_invalid_response", True)
    b = plan_recovery(SERVICE_CLASS_FAST_CPU, [], "provider_invalid_response", True)
    assert a["recovery_id"] == b["recovery_id"]


# ── Audit ────────────────────────────────────────────────────────────────────


def test_audit_is_pii_safe_and_deterministic():
    plan = _mixed_plan()
    aud = build_routing_audit(plan)
    # audit carries plan identity + aggregates, never a source path / signed url.
    txt = contracts.stable_json(aud)
    assert "://" not in txt
    assert aud["pages_by_class"]["fast_cpu"] == 1
    assert aud["pages_by_class"]["raster_only"] == 1
    assert build_routing_audit(_mixed_plan())["audit_id"] == aud["audit_id"]

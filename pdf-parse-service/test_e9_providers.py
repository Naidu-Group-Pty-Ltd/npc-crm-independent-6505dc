"""E9 — governed extraction provider ensemble tests (offline, no network)."""
from __future__ import annotations

import sys

import pytest

import providers
from providers import contracts as C
from providers.arbitration import (
    ArbitrationCandidateInput, arbitrate, detect_text_conflict,
)
from providers.audit import aggregate_audit
from providers.fixtures import (
    FakeGoogleClient, docling_partial_payload, docling_table_payload, google_layout_normalized_payload,
    google_ocr_payload, make_request, pymupdf_text_payload, vlm_invented_number_payload,
)
from providers.normalization import (
    NormalizationError, COORD_BOTTOM_LEFT_PT, COORD_NORMALIZED, COORD_PIXELS, COORD_TOP_LEFT_PT,
    critical_glyph_signature, normalize_bbox, normalize_text, provider_evidence_id,
)
from providers.policy import default_local_policy, gate_provider
from providers.protocol import ProviderCapabilityContext, ProviderNormalizationContext, ProviderRuntimeContext
from providers.registry import ProviderRegistry, ProviderRegistryError
from providers.request_identity import attempt_id, configuration_identity, request_id
from providers.attempt_runner import run_attempt


# ── A. Versions + import safety ──────────────────────────────────────────────

def test_version_constants_exact():
    assert C.EXTRACTION_PROVIDER_ADAPTER_VERSION == "extraction-provider-adapter-v1"
    assert C.EXTRACTION_PROVIDER_REQUEST_VERSION == "extraction-provider-request-v1"
    assert C.EXTRACTION_PROVIDER_RESULT_VERSION == "extraction-provider-result-v1"
    assert C.PROVIDER_CAPABILITY_MANIFEST_VERSION == "provider-capability-manifest-v1"
    assert C.EXTRACTION_PROVIDER_POLICY_VERSION == "extraction-provider-policy-v1"
    assert C.PROVIDER_EVIDENCE_BUNDLE_VERSION == "provider-evidence-bundle-v1"
    assert C.PROVIDER_NORMALIZATION_VERSION == "provider-normalization-v1"
    assert C.PROVIDER_ARBITRATION_VERSION == "provider-arbitration-v1"
    assert C.PROVIDER_ATTEMPT_AUDIT_VERSION == "provider-attempt-audit-v1"
    assert C.PROVIDER_REGISTRY_VERSION == "provider-registry-v1"


def test_import_is_safe_no_heavy_modules():
    for mod in ("torch", "docling", "fitz"):
        assert mod not in sys.modules  # importing providers must not pull these


# ── B. Registry ──────────────────────────────────────────────────────────────

def test_registry_allowlist_and_unknown_rejected():
    reg = ProviderRegistry()
    assert "pymupdf-exact" in reg.provider_ids()
    with pytest.raises(ProviderRegistryError):
        reg.get("not-a-provider")


def test_registry_rejects_duplicate_and_unknown_factory():
    with pytest.raises(ProviderRegistryError):
        ProviderRegistry(factories={"mystery-provider": lambda: None})


def test_registry_lazy_no_heavy_import_to_list():
    ProviderRegistry().provider_ids()
    assert "docling" not in sys.modules and "torch" not in sys.modules


# ── C. Deterministic identities ──────────────────────────────────────────────

def test_request_and_attempt_ids_deterministic_and_url_free():
    kw = dict(source_sha256="a" * 64, provider_id="pymupdf-exact", configuration_identity="cfg", purpose="primary-extraction",
              page_start=1, page_end=3, region_ids=["r2", "r1"], region_bboxes=[], requested_capabilities=["nativeText"],
              options_hash="oh", policy_hash="ph")
    assert request_id(**kw) == request_id(**kw)
    a0 = attempt_id(request_id="preq-x", attempt_ordinal=0, adapter_version="v")
    a1 = attempt_id(request_id="preq-x", attempt_ordinal=1, adapter_version="v")
    assert a0 != a1  # retry ordinal changes attempt id only
    # configuration identity changes request id
    other = dict(kw)
    other["configuration_identity"] = "cfg2"
    assert request_id(**kw) != request_id(**other)


def test_configuration_identity_excludes_secrets():
    cfg = configuration_identity(provider_id="google-document-ai-layout", adapter_version="v", engine_package_version=None,
                                 model_preset=None, processor_type="LAYOUT", processor_version="1", trusted_location="australia-southeast1",
                                 ocr_options={}, table_options={}, chart_options={}, vlm_preset=None, privacy_policy_version="v1")
    assert cfg.startswith("pcfg-") and "http" not in cfg


# ── D. Policy (fail-closed) ──────────────────────────────────────────────────

def test_default_policy_is_local_only_fail_closed():
    p = default_local_policy()
    assert p.remote_providers_enabled is False and p.remote_vlm_enabled is False
    assert p.max_remote_pages_per_job == 0 and p.approved_remote_locations == []
    # remote provider blocked by default (no live call).
    g = gate_provider(p, "google-document-ai-layout", purpose="layout-recovery", privacy_class="internal",
                      residency_class="local-only", trusted_location=None, remote_approved=True, pages=1, regions=0, byte_size=100, estimated_cost=None)
    assert g.permitted is False and g.reason == "provider_remote_not_approved"
    # vlm blocked by default.
    v = gate_provider(p, "docling-vlm", purpose="chart-metadata", privacy_class="confidential", residency_class="local-only",
                      trusted_location=None, remote_approved=False, pages=1, regions=0, byte_size=100, estimated_cost=None)
    assert v.permitted is False and v.reason == "provider_vlm_disabled"
    # local provider permitted.
    assert gate_provider(p, "pymupdf-exact", purpose="primary-extraction", privacy_class="confidential",
                         residency_class="local-only", trusted_location=None, remote_approved=False, pages=1, regions=0, byte_size=100, estimated_cost=None).permitted


def test_remote_enabled_still_needs_every_condition():
    p = default_local_policy()
    p.enabled_providers = list(p.enabled_providers) + ["google-document-ai-layout"]
    p.remote_providers_enabled = True
    p.privacy_class = "internal"
    p.residency_class = "australia-approved"
    p.approved_remote_locations = ["australia-southeast1"]
    p.approved_purposes = {"google-document-ai-layout": ["layout-recovery"]}
    p.max_remote_pages_per_job = 5
    p.max_remote_bytes_per_job = 1 << 20
    # missing trusted location → blocked
    assert gate_provider(p, "google-document-ai-layout", purpose="layout-recovery", privacy_class="internal",
                         residency_class="australia-approved", trusted_location=None, remote_approved=True, pages=1, regions=0, byte_size=100, estimated_cost=None).reason == "provider_residency_not_approved"
    # missing explicit approval → blocked
    assert gate_provider(p, "google-document-ai-layout", purpose="layout-recovery", privacy_class="internal",
                         residency_class="australia-approved", trusted_location="australia-southeast1", remote_approved=False, pages=1, regions=0, byte_size=100, estimated_cost=None).reason == "provider_remote_not_approved"
    # page limit enforced
    assert gate_provider(p, "google-document-ai-layout", purpose="layout-recovery", privacy_class="internal",
                         residency_class="australia-approved", trusted_location="australia-southeast1", remote_approved=True, pages=99, regions=0, byte_size=100, estimated_cost=None).reason == "provider_page_limit_exceeded"
    # unapproved purpose blocked
    assert gate_provider(p, "google-document-ai-layout", purpose="ocr-recovery", privacy_class="internal",
                         residency_class="australia-approved", trusted_location="australia-southeast1", remote_approved=True, pages=1, regions=0, byte_size=100, estimated_cost=None).reason == "provider_policy_blocked"
    # all conditions met → permitted
    assert gate_provider(p, "google-document-ai-layout", purpose="layout-recovery", privacy_class="internal",
                         residency_class="australia-approved", trusted_location="australia-southeast1", remote_approved=True, pages=1, regions=0, byte_size=100, estimated_cost=None).permitted


def test_remote_enabled_rejects_request_level_privacy_and_residency_restrictions():
    p = default_local_policy()
    p.enabled_providers = list(p.enabled_providers) + ["google-document-ai-layout"]
    p.remote_providers_enabled = True
    p.privacy_class = "internal"
    p.residency_class = "australia-approved"
    p.approved_remote_locations = ["australia-southeast1"]
    p.approved_purposes = {"google-document-ai-layout": ["layout-recovery"]}
    p.max_remote_pages_per_job = 5
    p.max_remote_bytes_per_job = 1 << 20
    gate_args = dict(
        purpose="layout-recovery", trusted_location="australia-southeast1", remote_approved=True,
        pages=1, regions=0, byte_size=100, estimated_cost=None,
    )

    restricted = gate_provider(
        p, "google-document-ai-layout", privacy_class="restricted",
        residency_class="australia-approved", **gate_args,
    )
    assert restricted.permitted is False and restricted.reason == "provider_policy_blocked"

    remote_prohibited = gate_provider(
        p, "google-document-ai-layout", privacy_class="internal",
        residency_class="remote-prohibited", **gate_args,
    )
    assert remote_prohibited.permitted is False
    assert remote_prohibited.reason == "provider_residency_not_approved"


# ── E. Capability truth ──────────────────────────────────────────────────────

def test_capability_truth_api_present_not_effective():
    reg = ProviderRegistry()
    # pymupdf missing dependency → dependency-missing + no effective claim.
    m = reg.capability_manifest("pymupdf-exact", ProviderCapabilityContext(installed_packages={}))
    assert m.availability_state == "dependency-missing" and m.available is False
    assert m.capabilities["nativeText"].effective is False


def test_vlm_never_effective_and_disabled():
    reg = ProviderRegistry()
    ctx = ProviderCapabilityContext(installed_packages={"docling": "2.113.0"}, model_ready={"vlm": True},
                                    configuration={"vlmConfigured": True, "vlmModelPresent": True, "vlmHardwareAvailable": True})
    m = reg.capability_manifest("docling-vlm", ctx)
    assert m.available is False
    assert m.availability_state == "unproven"  # even ready stays unproven until a live gate
    assert m.capabilities["vlm"].effective is True  # model layer ready, but adapter.available stays False


def test_google_remote_unproven_no_live_call():
    reg = ProviderRegistry()
    m = reg.capability_manifest("google-document-ai-layout", ProviderCapabilityContext(
        configuration={"injectedClientPresent": True, "processorConfigured": True, "processorType": "LAYOUT", "location": "australia-southeast1"}))
    assert m.execution_mode == "remote" and m.available is False and m.availability_state == "unproven"


# ── F. Coordinate normalization ──────────────────────────────────────────────

def test_coordinate_systems():
    # top-left passthrough
    b = normalize_bbox({"x": 10, "y": 20, "width": 30, "height": 40}, system=COORD_TOP_LEFT_PT, page_width_pt=595, page_height_pt=842)
    assert (b.x, b.y) == (10, 20)
    # bottom-left flip
    bl = normalize_bbox({"x": 10, "y": 800, "width": 30, "height": 40}, system=COORD_BOTTOM_LEFT_PT, page_width_pt=595, page_height_pt=842)
    assert bl.y == 842 - (800 + 40)
    # normalized 0..1
    n = normalize_bbox({"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.05}, system=COORD_NORMALIZED, page_width_pt=595, page_height_pt=842)
    assert abs(n.x - 59.5) < 0.1
    # off-page rejected
    with pytest.raises(NormalizationError):
        normalize_bbox({"x": 700, "y": 900, "width": 10, "height": 10}, system=COORD_TOP_LEFT_PT, page_width_pt=595, page_height_pt=842)
    # zero-area critical rejected
    with pytest.raises(NormalizationError):
        normalize_bbox({"x": 10, "y": 10, "width": 0, "height": 10}, system=COORD_TOP_LEFT_PT, page_width_pt=595, page_height_pt=842, critical=True)
    # pixels without scale rejected
    with pytest.raises(NormalizationError):
        normalize_bbox({"x": 100, "y": 100, "width": 50, "height": 50}, system=COORD_PIXELS, page_width_pt=595, page_height_pt=842)


def test_unicode_preservation():
    nt = normalize_text("10–15 years $910,000–$920,000 8×8 −$25,000")
    assert "–" in nt["raw"] and "×" in nt["raw"] and "−" in nt["raw"]  # en-dash, ×, minus preserved
    assert nt["normalizedNfc"] != "" and nt["searchNormalized"] != nt["raw"]
    # critical glyph signature captures them.
    assert "×" in critical_glyph_signature("8×8")


def test_provider_evidence_id_deterministic_provider_local():
    a = provider_evidence_id(provider_id="pymupdf-exact", request_id="preq-1", page_number=1, kind="span",
                             provider_local_ref="s1", bbox=None, ordinal=0, configuration_identity="cfg")
    b = provider_evidence_id(provider_id="docling-standard-vnext", request_id="preq-1", page_number=1, kind="span",
                             provider_local_ref="s1", bbox=None, ordinal=0, configuration_identity="cfg")
    assert a.startswith("pevd-pmu-") and b.startswith("pevd-dsv-") and a != b  # provider-local, never canonical


# ── G. Arbitration ───────────────────────────────────────────────────────────

def _cand(eid, **kw):
    base = dict(evidence_id=eid, provider_id="p", policy_permitted=True, scope_complete=True, source_visual_agreement=0.9,
                numeric_integrity=True, punctuation_integrity=True, table_integrity=None, geometry_agreement=0.9,
                region_coverage=1.0, e7_score=0.9, latency_ms=100.0, estimated_cost=0.0)
    base.update(kw)
    return ArbitrationCandidateInput(**base)


def test_arbitration_name_and_confidence_cannot_win():
    # candidate B has higher raw confidence-ish (e7_score) but LOWER source agreement.
    a = _cand("ev-a", source_visual_agreement=0.95, e7_score=0.5)
    b = _cand("ev-b", source_visual_agreement=0.6, e7_score=0.99)
    res = arbitrate(1, "region-1", [b, a], [])
    assert res.preferred_evidence_id == "ev-a"  # source agreement outranks e7/confidence


def test_arbitration_numeric_conflict_blocks_auto_preference():
    conflicts = detect_text_conflict("ev-a", "$910,000", "ev-b", "$920,000", "region-1")
    assert any(c.conflict_type == "provider_numeric_conflict" for c in conflicts)
    res = arbitrate(1, "region-1", [_cand("ev-a"), _cand("ev-b")], conflicts)
    assert res.preferred_evidence_id is None and res.resolution == "multiple-candidates"


def test_arbitration_agreement_no_conflict():
    assert detect_text_conflict("a", "same text", "b", "same text", None) == []


def test_arbitration_deterministic_tie_break_by_evidence_id():
    a = _cand("ev-zzz")
    b = _cand("ev-aaa")
    res = arbitrate(1, None, [a, b], [])
    assert res.candidate_evidence_ids[0] == "ev-aaa"  # deterministic id tie-break


# ── H. Attempt runner + adapters ─────────────────────────────────────────────

def _nctx():
    return ProviderNormalizationContext(source_sha256="a" * 64, page_count_expected=1)


def test_pymupdf_local_success_normalized():
    reg = ProviderRegistry()
    res = run_attempt(registry=reg, request=make_request(provider_id="pymupdf-exact"), policy=default_local_policy(),
                      runtime=ProviderRuntimeContext(injected_client=pymupdf_text_payload()), normalization_context=_nctx())
    assert res.result.status == "success" and res.bundle is not None
    assert res.bundle.pages[0].text_spans[0].raw_text.startswith("Projected")
    # en-dash preserved through normalization
    assert "–" in res.bundle.pages[0].text_spans[0].raw_text


def test_docling_partial_stays_partial():
    reg = ProviderRegistry()
    res = run_attempt(registry=reg, request=make_request(provider_id="docling-standard-vnext"), policy=default_local_policy(),
                      runtime=ProviderRuntimeContext(injected_client=docling_partial_payload()), normalization_context=_nctx())
    assert res.result.status == "partial-success" and res.result.complete is False
    assert res.bundle.complete is False


def test_google_blocked_by_default_no_client_call():
    reg = ProviderRegistry()
    client = FakeGoogleClient(google_layout_normalized_payload())
    req = make_request(provider_id="google-document-ai-layout", purpose="layout-recovery", remote_approved=True)
    res = run_attempt(registry=reg, request=req, policy=default_local_policy(),
                      runtime=ProviderRuntimeContext(injected_client=client), normalization_context=_nctx(), trusted_location="australia-southeast1")
    assert res.result.status == "policy-blocked"
    assert client.calls == 0  # NO live/injected call when policy blocks


def test_google_layout_with_remote_policy_injected_client_only():
    reg = ProviderRegistry()
    p = default_local_policy()
    p.enabled_providers = list(p.enabled_providers) + ["google-document-ai-layout"]
    p.remote_providers_enabled = True
    p.privacy_class = "internal"
    p.residency_class = "australia-approved"
    p.approved_remote_locations = ["australia-southeast1"]
    p.approved_purposes = {"google-document-ai-layout": ["layout-recovery"]}
    p.max_remote_pages_per_job = 5
    p.max_remote_bytes_per_job = 1 << 20
    client = FakeGoogleClient(google_layout_normalized_payload())
    req = make_request(provider_id="google-document-ai-layout", purpose="layout-recovery", remote_approved=True, byte_size=1000, policy=p)
    res = run_attempt(registry=reg, request=req, policy=p,
                      runtime=ProviderRuntimeContext(injected_client=client), normalization_context=_nctx(), trusted_location="australia-southeast1")
    assert res.result.status == "success"
    assert client.calls == 1  # only the injected fake — never a live Google API
    # normalized 0..1 coordinates converted to points
    assert res.bundle.pages[0].text_spans[0].bbox is not None


def test_ocr_page_bounded_rejects_full_document():
    reg = ProviderRegistry()
    adapter = reg.get("google-document-ai-ocr")
    req = make_request(provider_id="google-document-ai-ocr", purpose="ocr-recovery", page_start=1, page_end=40)
    val = adapter.validate_request(req, default_local_policy())
    assert "provider_page_limit_exceeded" in val.errors or "provider_scope_invalid" in val.errors


def test_google_error_mapped_to_safe_code_no_leak():
    reg = ProviderRegistry()
    p = default_local_policy()
    p.enabled_providers = list(p.enabled_providers) + ["google-document-ai-layout"]
    p.remote_providers_enabled = True
    p.privacy_class = "internal"
    p.residency_class = "australia-approved"
    p.approved_remote_locations = ["australia-southeast1"]
    p.approved_purposes = {"google-document-ai-layout": ["layout-recovery"]}
    p.max_remote_pages_per_job = 5
    p.max_remote_bytes_per_job = 1 << 20

    class QuotaError(Exception):
        pass

    client = FakeGoogleClient({}, raise_exc=QuotaError("secret-token-abc123 leaked"))
    req = make_request(provider_id="google-document-ai-layout", purpose="layout-recovery", remote_approved=True, byte_size=1000, policy=p)
    res = run_attempt(registry=reg, request=req, policy=p,
                      runtime=ProviderRuntimeContext(injected_client=client), normalization_context=_nctx(), trusted_location="australia-southeast1")
    assert res.result.status == "failure"
    assert any(e.code == "provider_quota_exceeded" for e in res.result.errors)
    # the raw exception message (with a fake secret) is NOT leaked into problems/errors.
    joined = " ".join(res.result.problems + [e.detail for e in res.result.errors])
    assert "secret-token" not in joined


# ── I. Audit (privacy-safe) ──────────────────────────────────────────────────

def test_audit_aggregate_no_source_text_or_urls():
    reg = ProviderRegistry()
    res = run_attempt(registry=reg, request=make_request(provider_id="pymupdf-exact"), policy=default_local_policy(),
                      runtime=ProviderRuntimeContext(injected_client=pymupdf_text_payload()), normalization_context=_nctx())
    agg = aggregate_audit([res.attempt])
    d = agg.to_dict()
    import json
    blob = json.dumps(d)
    assert "Projected value" not in blob and "910,000" not in blob and "http" not in blob
    assert d["successful"] == 1 and d["localCount"] == 1 and d["remoteCount"] == 0


# ── J. Existing sidecar suites remain importable / green (smoke) ─────────────

def test_docling_vnext_module_still_importable():
    import docling_capabilities  # noqa: F401
    import source_scene_graph  # noqa: F401

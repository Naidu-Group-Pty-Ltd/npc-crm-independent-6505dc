"""Pure tests for the Docling vNext compatibility layer (E2).

Run WITHOUT docling/torch installed — every docling import in the runtime is lazy,
so these exercise the contracts, converter-cache keys, lane mapping, capability
truth levels, adapter breaking-change bridges, and security invariants in CI.
"""

import dataclasses

import pytest

from docling_vnext_profiles import (
    VNextConverterProfile, VNextBuildOptions, converter_key,
    resolve_vnext_converter_profile, accurate_table_candidates,
)
from docling_capabilities import build_capability_report, FEATURE_SPECS, introspect_installed
from docling_vnext_adapter import (
    normalize_conversion_status, normalize_picture_classification, normalize_picture_chart,
    normalize_document, summarize_document, STATUS_PARTIAL, STATUS_SUCCESS, STATUS_FAILURE, STATUS_TIMEOUT,
)
from docling_runtime_legacy import resolve_runtime_profile_name, select_docling_runtime, DoclingLegacyRuntime
from docling_runtime_vnext import DoclingVNextRuntime


# ── Converter cache key (Phase 29) ──────────────────────────────────────────

def test_identical_profile_same_key():
    a, b = VNextConverterProfile(), VNextConverterProfile()
    assert converter_key(a) == converter_key(b)


CONVERTER_AFFECTING_FIELDS = [
    ("pipeline_family", "threaded_standard"),
    ("device", "cuda"),
    ("num_threads", 8),
    ("do_ocr", True),
    ("ocr_engine", "rapidocr"),
    ("ocr_languages", ("en", "fr")),
    ("force_full_page_ocr", True),
    ("bitmap_area_threshold", 0.1),
    ("do_table_structure", False),
    ("table_mode", "accurate"),
    ("table_cell_matching", False),
    ("table_model", "tableformer-v2"),
    ("do_picture_classification", True),
    ("picture_classifier_model", "efficientnet"),
    ("do_picture_description", True),
    ("picture_description_model", "smolvlm"),
    ("do_chart_extraction", True),
    ("chart_model", "chart-x"),
    ("chart_to_csv", True),
    ("chart_to_code", True),
    ("chart_to_summary", True),
    ("do_formula_enrichment", True),
    ("do_code_enrichment", True),
    ("code_formula_model", "code-x"),
    ("generate_page_images", True),
    ("generate_picture_images", True),
    ("generate_table_images", True),
    ("generate_parsed_pages", True),
    ("images_scale", 3.0),
    ("force_backend_text", False),
    ("heading_hierarchy", False),
    ("document_timeout", 120.0),
    ("ocr_batch_size", 8),
    ("layout_batch_size", 8),
    ("table_batch_size", 8),
    ("queue_max_size", 50),
    ("batch_polling_interval", 0.1),
    ("vlm_model", "granite-docling"),
    ("vlm_engine", "transformers"),
    ("vlm_scale", 3.0),
    ("vlm_response_format", "markdown"),
    ("vlm_temperature", 0.5),
    ("vlm_max_tokens", 512),
    ("vlm_local", False),
    ("model_manifest_version", "docling-model-manifest-v9"),
    ("enable_remote_services", True),
    ("allow_external_plugins", True),
    ("trust_remote_code", True),
]


@pytest.mark.parametrize("field,value", CONVERTER_AFFECTING_FIELDS)
def test_every_converter_field_changes_key(field, value):
    base = VNextConverterProfile()
    changed = base.with_overrides(**{field: value})
    assert converter_key(base) != converter_key(changed), f"{field} did not change the converter key"


def test_two_lanes_with_identical_effective_profile_share_key():
    # fast_native and a pixel lane resolving to the same fields would share; here
    # we assert the KEY is a pure function of the profile, not the lane name.
    p1 = resolve_vnext_converter_profile({"lane": "fast_native"}, None)
    p2 = resolve_vnext_converter_profile({"lane": "fast_native"}, None)
    assert converter_key(p1) == converter_key(p2)


def test_profile_is_frozen_hashable_jsonable():
    p = VNextConverterProfile()
    with pytest.raises(dataclasses.FrozenInstanceError):
        p.do_ocr = True  # type: ignore
    assert isinstance(hash(p), int)
    import json
    assert json.loads(json.dumps(p.to_json()))["pipeline_family"] == "standard"


# ── Lane mapping (Phase 8) ──────────────────────────────────────────────────

def _caps_all_ready():
    # A capability set reporting every feature effective (build ceiling still applies).
    return {"features": {name: True for name in FEATURE_SPECS}}


def test_pixel_raster_only_minimal():
    p = resolve_vnext_converter_profile({"lane": "pixel_raster_only"}, _caps_all_ready(),
                                        VNextBuildOptions(allow_chart_extraction=True, allow_picture_classification=True))
    assert p.do_ocr is False and p.do_table_structure is False
    assert p.do_chart_extraction is False and p.do_picture_classification is False


def test_fast_native_low_cost():
    p = resolve_vnext_converter_profile({"lane": "fast_native", "do_ocr": True}, _caps_all_ready())
    assert p.do_ocr is False and p.table_mode == "fast" and p.force_backend_text is True
    assert p.do_chart_extraction is False


def test_accurate_table_two_candidates():
    p = resolve_vnext_converter_profile({"lane": "accurate_table"}, _caps_all_ready())
    assert p.table_mode == "accurate"
    cands = accurate_table_candidates(p)
    assert cands["accurate_cell_matching_on"].table_cell_matching is True
    assert cands["accurate_cell_matching_off"].table_cell_matching is False
    assert converter_key(cands["accurate_cell_matching_on"]) != converter_key(cands["accurate_cell_matching_off"])


def test_ocr_scanned_full_page_ocr():
    p = resolve_vnext_converter_profile({"lane": "ocr_scanned"}, _caps_all_ready())
    assert p.do_ocr is True and p.force_full_page_ocr is True and p.table_mode == "accurate"


def test_design_heavy_charts_when_ready_and_allowed():
    opts = VNextBuildOptions(allow_chart_extraction=True, allow_chart_to_csv=True, allow_picture_classification=True)
    p = resolve_vnext_converter_profile({"lane": "design_heavy"}, _caps_all_ready(), opts)
    assert p.do_chart_extraction is True and p.chart_to_csv is True and p.chart_to_code is False
    assert p.generate_page_images is True and p.generate_picture_images is True


def test_design_heavy_chart_off_when_model_not_ready():
    # Build allows charts but capabilities report NOT ready → chart stays off.
    opts = VNextBuildOptions(allow_chart_extraction=True)
    p = resolve_vnext_converter_profile({"lane": "design_heavy"}, {"features": {}}, opts)
    assert p.do_chart_extraction is False


def test_unplanned_conservative():
    p = resolve_vnext_converter_profile({"lane": "unplanned"}, _caps_all_ready())
    assert p.do_chart_extraction is False and p.do_picture_classification is False and p.do_formula_enrichment is False


def test_unknown_lane_falls_to_unplanned():
    p = resolve_vnext_converter_profile({"lane": "totally-made-up"}, _caps_all_ready())
    assert p.do_chart_extraction is False and p.do_picture_classification is False


# ── Security invariants (Phase 18/34) ───────────────────────────────────────

def test_every_lane_keeps_security_invariants_off():
    for lane in ["unplanned", "fast_native", "accurate_table", "ocr_scanned", "design_heavy", "pixel_raster_only"]:
        p = resolve_vnext_converter_profile({"lane": lane}, _caps_all_ready(),
                                            VNextBuildOptions(allow_chart_extraction=True, allow_vlm=True))
        assert p.enable_remote_services is False
        assert p.allow_external_plugins is False
        assert p.trust_remote_code is False


def test_build_ceiling_blocks_disallowed_features():
    # Even with everything model-ready, an OFF build ceiling keeps features off.
    opts = VNextBuildOptions(allow_chart_extraction=False, allow_picture_description=False, allow_formula_enrichment=False)
    p = resolve_vnext_converter_profile({"lane": "design_heavy"}, _caps_all_ready(), opts)
    assert p.do_chart_extraction is False and p.do_picture_description is False and p.do_formula_enrichment is False


# ── Capability registry (Phase 6) ───────────────────────────────────────────

def test_capability_truth_levels_distinct():
    rep = build_capability_report("vnext", VNextBuildOptions(allow_chart_extraction=True), probe=introspect_installed())
    chart = rep.features["chart_extraction"]
    # In a no-docling environment: api absent, configured true, model not ready, not effective.
    assert chart.configured is True
    assert chart.effective is False
    assert chart.apiPresent is False or chart.modelReady is False


def test_capability_effective_requires_model_ready():
    probe = {"api_present": {"chart_extraction": True}, "package_versions": {}, "pipeline_families": {}, "device": "cpu", "problems": []}
    rep_not_ready = build_capability_report("vnext", VNextBuildOptions(allow_chart_extraction=True), probe=probe)
    assert rep_not_ready.features["chart_extraction"].effective is False
    rep_ready = build_capability_report("vnext", VNextBuildOptions(allow_chart_extraction=True), probe=probe,
                                        model_ready={"chart_extraction": True})
    assert rep_ready.features["chart_extraction"].effective is True


def test_capability_report_has_no_secrets():
    rep = build_capability_report("vnext").to_json()
    blob = str(rep).lower()
    for secret in ("token", "bearer", "service_role", "/home/", "/root/", "signed"):
        assert secret not in blob


# ── Adapter breaking-change bridges (Phase 22/23) ───────────────────────────

def test_classification_read_from_annotations_2_87():
    pic = {"self_ref": "#/pictures/0", "annotations": [
        {"kind": "classification", "predicted_classes": [
            {"class_name": "bar_chart", "confidence": 0.9}, {"class_name": "photo", "confidence": 0.1}]}]}
    c = normalize_picture_classification(pic)
    assert c["predicted_class"] == "bar_chart" and c["confidence"] == 0.9


def test_classification_legacy_2_14_still_works():
    pic = {"classification": {"predicted_class": "logo", "predicted_classes": []}}
    assert normalize_picture_classification(pic)["predicted_class"] == "logo"


def test_normalize_document_backfills_classification():
    doc = {"pages": {"1": {}}, "pictures": [{"self_ref": "#/pictures/0", "annotations": [
        {"kind": "classification", "predicted_classes": [{"class_name": "line_chart", "confidence": 0.8}]}]}]}
    out = normalize_document(doc)
    assert out["pictures"][0]["classification"]["predicted_class"] == "line_chart"
    assert out["vnext"]["picture_classification_source"] == "annotations"


def test_chart_evidence_from_annotations():
    pic = {"annotations": [{"kind": "bar_chart", "title": "Rent", "bars": [1, 2, 3]}]}
    ch = normalize_picture_chart(pic)
    assert ch["chart_type"] == "bar" and ch["has_structured_data"] is True


def test_non_chart_picture_no_chart_evidence():
    assert normalize_picture_chart({"annotations": [{"kind": "classification", "predicted_classes": []}]}) is None


def test_conversion_status_partial_not_success():
    assert normalize_conversion_status("success", pages_total=10, pages_failed=3) == STATUS_PARTIAL
    assert normalize_conversion_status("success", pages_total=10, pages_failed=0) == STATUS_SUCCESS
    assert normalize_conversion_status("failure", pages_total=10, pages_failed=10) == STATUS_FAILURE
    assert normalize_conversion_status("x", pages_total=1, pages_failed=0, timed_out=True) == STATUS_TIMEOUT


def test_summarize_document_counts_only():
    doc = {"pages": {"1": {}}, "texts": [{"text": "a"}], "tables": [{}],
           "pictures": [{"annotations": [{"kind": "pie_chart", "slices": [1]}]}]}
    s = summarize_document(doc)
    assert s["page_count"] == 1 and s["chart_evidence_count"] == 1


# ── Runtime selection (Phase 4) ─────────────────────────────────────────────

def test_default_profile_is_legacy():
    assert resolve_runtime_profile_name({}) == "legacy"
    assert isinstance(select_docling_runtime({}), DoclingLegacyRuntime)


def test_vnext_selected_only_by_explicit_env():
    assert resolve_runtime_profile_name({"DOCLING_RUNTIME_PROFILE": "vnext"}) == "vnext"
    rt = select_docling_runtime({"DOCLING_RUNTIME_PROFILE": "vnext"})
    assert rt.profile_name() == "vnext"


def test_vnext_no_silent_fallback_to_legacy():
    # With docling absent, require_docling must RAISE rather than run legacy.
    rt = DoclingVNextRuntime()
    with pytest.raises(RuntimeError):
        rt.require_docling()


def test_vnext_engine_identity_discloses_vnext():
    rt = DoclingVNextRuntime()
    ident = rt.engine_identity(VNextConverterProfile(pipeline_family="threaded_standard"))
    assert ident["runtime_profile"] == "vnext" and ident["pipeline_family"] == "threaded_standard"
    assert "converter_key" in ident

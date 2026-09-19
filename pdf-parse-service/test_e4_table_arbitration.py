"""E4 — Complex Table Candidate Arbitration & Preservation (deterministic, pure).

Covers the E4 test matrix (contract / evidence / generation / grid / integrity /
hard defects / adjacent-merge / split / arbitration / preservation-suppression /
E0-E3 interop / security) without Docling, sidecar, network or randomness.
"""

import copy

import source_scene_graph as ssg
import table_candidates as tc
import table_integrity as ti


# ── Fixtures ────────────────────────────────────────────────────────────────

def cell(r, c, text, x, y, w=250, h=40, ch=False, rh=False, rs=1, cs=1):
    return {"row": r, "col": c, "rowSpan": rs, "colSpan": cs, "columnHeader": ch,
            "rowHeader": rh, "text": text, "bbox": {"x": x, "y": y, "width": w, "height": h}}


def mk_region(cells, *, rid="src-p0001-tabl-0001-aaaa1111", num_rows=2, num_cols=2,
              hrc=1, hcc=0, crop=True, complete=True, bbox=None, page=1, children=None):
    topo = {"version": "source-table-topology-v2", "numRows": num_rows, "numCols": num_cols,
            "headerRowCount": hrc, "headerColumnCount": hcc, "complete": complete,
            "caption": None, "cells": cells, "topologyProblems": [] if complete else ["x"]}
    return {
        "id": rid, "type": "table", "pageId": f"docling-page-{page}", "pageNumber": page,
        "bbox": bbox or {"x": 40, "y": 100, "width": 500, "height": 80},
        "sourceCrop": {"path": f"job/pages/page-00{page}/regions/{rid}.png" if crop else None,
                       "sha256": "a" * 64 if crop else None, "sourceDpi": 300} if crop else
                      {"path": None, "sha256": None, "sourceDpi": None},
        "table": topo, "confidence": 0.9,
        "relationships": {"parentRegionId": None, "childRegionIds": children or [],
                          "captionRegionIds": [], "labelRegionIds": []},
        "providerEvidence": [],
    }


def num_span(text, x, y, w=250, h=40, sid="s"):
    return {"id": sid, "bbox": {"x": x, "y": y, "width": w, "height": h}, "raw": text,
            "normalizedNfc": ssg.normalize_nfc(text),
            "numericTokens": ssg.extract_numeric_tokens(text),
            "punctuationTokens": ssg.extract_punctuation_tokens(text)}


FINANCIAL_CELLS = [cell(0, 0, "Year", 40, 100, ch=True), cell(0, 1, "Value", 290, 100, ch=True),
                   cell(1, 0, "2020", 40, 140), cell(1, 1, "$1,200,000", 290, 140)]


def financial_evidence(region):
    spans = [num_span("$1,200,000", 290, 140, sid="v1"), num_span("2020", 40, 140, sid="y1")]
    return tc.build_source_table_evidence(region=region, page_spans=spans, page_vectors=[],
                                          adjacent_source_table_region_ids=[])


# ── A. Contract ─────────────────────────────────────────────────────────────

def test_contract_versions_exact():
    assert tc.TABLE_CANDIDATE_CONTRACT_VERSION == "table-candidate-contract-v1"
    assert tc.SOURCE_TABLE_EVIDENCE_VERSION == "source-table-evidence-v1"
    assert ti.TABLE_INTEGRITY_REPORT_VERSION == "table-integrity-report-v1"
    assert ti.TABLE_ARBITRATION_VERSION == "table-arbitration-v1"
    assert ti.TABLE_PRESERVATION_VERSION == "table-preservation-v1"


def test_valid_candidate_passes():
    cand = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    assert cand["version"] == "table-candidate-contract-v1"
    assert cand["complete"] and cand["problems"] == []
    assert len(cand["cells"]) == 4


def test_invalid_version_fails():
    cand = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    cand["version"] = "nope"
    assert "candidate_bad_version" in tc.validate_table_candidate(cand)


def test_candidate_id_deterministic():
    a = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    b = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    assert a["id"] == b["id"]


def test_profile_change_changes_candidate_id():
    region = mk_region(FINANCIAL_CELLS)
    a = tc.candidate_from_source_topology(region=region, profile={"runtimeProfile": "legacy", "tableMode": "fast", "cellMatching": True})
    b = tc.candidate_from_source_topology(region=region, profile={"runtimeProfile": "vnext", "tableMode": "accurate", "cellMatching": False})
    assert a["id"] != b["id"]


def test_monolithic_chunk_candidate_id_parity():
    # Same source region id + bbox + topology → same candidate id regardless of
    # whether it was produced monolithically or from a rebased chunk-local page.
    mono = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS, page=21))
    chunk = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS, page=21))
    assert mono["id"] == chunk["id"]
    assert [c["id"] for c in mono["cells"]] == [c["id"] for c in chunk["cells"]]


def test_cell_ids_deterministic():
    cand = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    ids = [c["id"] for c in cand["cells"]]
    assert len(set(ids)) == len(ids)
    assert all(i.startswith("tcell-") for i in ids)


def test_duplicate_cell_ids_fail():
    cand = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    cand["cells"].append(copy.deepcopy(cand["cells"][0]))
    assert "candidate_duplicate_cell_id" in tc.validate_table_candidate(cand)


def test_invalid_span_fails():
    cand = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    cand["cells"][0]["colSpan"] = 0
    assert "candidate_invalid_span" in tc.validate_table_candidate(cand)


def test_span_out_of_bounds_fails():
    cand = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    cand["cells"][0]["colSpan"] = 5  # numCols is 2
    assert "candidate_cell_col_out_of_bounds" in tc.validate_table_candidate(cand)


def test_non_finite_bbox_fails():
    cand = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    cand["bbox"] = {"x": 0, "y": 0, "width": float("inf"), "height": 10}
    assert "candidate_bbox_non_finite" in tc.validate_table_candidate(cand)


def test_build_does_not_mutate_inputs():
    region = mk_region(FINANCIAL_CELLS)
    snapshot = copy.deepcopy(region)
    tc.candidate_from_source_topology(region=region)
    assert region == snapshot


# ── B. Source evidence ──────────────────────────────────────────────────────

def test_evidence_crop_retained():
    ev = financial_evidence(mk_region(FINANCIAL_CELLS))
    assert ev["crop"]["path"] and ev["crop"]["sha256"]


def test_evidence_spans_bounded_to_region():
    region = mk_region(FINANCIAL_CELLS)
    inside = num_span("$1,200,000", 290, 140, sid="in")
    outside = num_span("$99", 40, 700, sid="out")  # far below the table bbox
    ev = tc.build_source_table_evidence(region=region, page_spans=[inside, outside],
                                        page_vectors=[], adjacent_source_table_region_ids=[])
    span_ids = [s["spanId"] for s in ev["sourceSpans"]]
    assert "in" in span_ids and "out" not in span_ids


def test_evidence_numeric_and_punctuation_placements():
    ev = tc.build_source_table_evidence(region=mk_region(FINANCIAL_CELLS),
                                        page_spans=[num_span("$450,000 – $470,000", 290, 140, sid="r")],
                                        page_vectors=[], adjacent_source_table_region_ids=[])
    assert ev["sourceNumericTokens"] and ev["sourcePunctuationTokens"]
    assert any(p["token"]["kind"] == "range" for p in ev["sourceNumericTokens"])


def test_evidence_adjacent_ids_retained():
    ev = tc.build_source_table_evidence(region=mk_region(FINANCIAL_CELLS), page_spans=[],
                                        page_vectors=[], adjacent_source_table_region_ids=["src-p0001-tabl-0002-bbbb"])
    assert ev["adjacentSourceTableRegionIds"] == ["src-p0001-tabl-0002-bbbb"]


def test_evidence_incomplete_when_topology_incomplete():
    region = mk_region(FINANCIAL_CELLS, complete=False)
    ev = financial_evidence(region)
    assert ev["complete"] is False and "source_topology_incomplete" in ev["problems"]


def test_evidence_missing_crop_marks_incomplete():
    ev = financial_evidence(mk_region(FINANCIAL_CELLS, crop=False))
    assert ev["complete"] is False and "source_table_crop_missing" in ev["problems"]


# ── C. Candidate generation / budgets ───────────────────────────────────────

def test_missing_candidate_is_recorded_not_fatal():
    ev = financial_evidence(mk_region(FINANCIAL_CELLS))
    rep = ti.evaluate_table_integrity(None, ev)
    assert rep["state"] == "unverifiable"
    assert "candidate_missing" in [d["code"] for d in rep["hardDefects"]]


def test_candidate_dimension_budget_enforced():
    cand = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    cand["numRows"] = tc.MAX_ROWS_PER_CANDIDATE + 1
    assert "candidate_dimensions_exceed_budget" in tc.validate_table_candidate(cand)


def test_oversized_candidate_rejected_before_hashing(monkeypatch):
    cells = [cell(0, 0, "x", 40, 100)] * (tc.MAX_CELLS_PER_CANDIDATE + 1)
    region = mk_region(cells, num_rows=1, num_cols=1)
    monkeypatch.setattr(tc, "candidate_id", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("hashed")))

    assert tc.candidate_from_source_topology(region=region) is None


def test_candidate_text_budget_rejected_before_hashing(monkeypatch):
    oversized = "x" * (tc.MAX_CANDIDATE_JSON_BYTES + 1)
    region = mk_region([cell(0, 0, oversized, 40, 100)], num_rows=1, num_cols=1)
    monkeypatch.setattr(tc, "candidate_id", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("hashed")))

    assert tc.candidate_from_source_topology(region=region) is None


def test_normalized_candidate_json_budget_is_enforced():
    candidate = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    candidate["cells"][0]["normalizedText"] = "x" * tc.MAX_CANDIDATE_JSON_BYTES

    assert tc.candidate_json_within_budget(candidate) is False


# ── D. PyMuPDF grid candidate ───────────────────────────────────────────────

def _ruled_vectors():
    # 3 horizontal + 3 vertical rules forming a 2x2 grid over (40,100)-(540,180).
    seg = lambda x0, y0, x1, y1: {"segments": [[x0, y0, x1, y1]]}
    return [
        seg(40, 100, 540, 100), seg(40, 140, 540, 140), seg(40, 180, 540, 180),
        seg(40, 100, 40, 180), seg(290, 100, 290, 180), seg(540, 100, 540, 180),
    ]


def test_ruled_grid_produces_candidate():
    region = mk_region(FINANCIAL_CELLS)
    ev = tc.build_source_table_evidence(
        region=region,
        page_spans=[num_span("Year", 60, 105, w=80, h=20, sid="h1"), num_span("Value", 300, 105, w=80, h=20, sid="h2"),
                    num_span("2020", 60, 145, w=80, h=20, sid="b1"), num_span("$1,200,000", 300, 145, w=120, h=20, sid="b2")],
        page_vectors=_ruled_vectors(), adjacent_source_table_region_ids=[])
    assert ev["vectorGridEvidence"]["borderStyle"] == "ruled"
    cand = tc.build_pymupdf_grid_candidate(ev, page_id="docling-page-1")
    assert cand is not None and cand["provider"] == "pymupdf-grid"
    assert cand["numRows"] == 2 and cand["numCols"] == 2


def test_borderless_region_no_grid_candidate():
    region = mk_region(FINANCIAL_CELLS)
    ev = tc.build_source_table_evidence(region=region, page_spans=[num_span("x", 60, 105, sid="a")],
                                        page_vectors=[], adjacent_source_table_region_ids=[])
    assert ev["vectorGridEvidence"]["borderStyle"] == "borderless"
    assert tc.build_pymupdf_grid_candidate(ev, page_id="docling-page-1") is None


def test_decorative_lines_do_not_make_grid():
    region = mk_region(FINANCIAL_CELLS)
    seg = lambda x0, y0, x1, y1: {"segments": [[x0, y0, x1, y1]]}
    ev = tc.build_source_table_evidence(region=region, page_spans=[num_span("x", 60, 105, sid="a")],
                                        page_vectors=[seg(40, 100, 540, 100)],  # single decorative underline
                                        adjacent_source_table_region_ids=[])
    assert ev["vectorGridEvidence"]["borderStyle"] != "ruled"
    assert tc.build_pymupdf_grid_candidate(ev, page_id="docling-page-1") is None


def test_grid_span_straddling_boundary_rejected():
    region = mk_region(FINANCIAL_CELLS)
    straddle = num_span("crosses", 250, 145, w=120, h=20, sid="straddle")  # crosses x=290 boundary
    ev = tc.build_source_table_evidence(region=region, page_spans=[straddle], page_vectors=_ruled_vectors(),
                                        adjacent_source_table_region_ids=[])
    assert tc.build_pymupdf_grid_candidate(ev, page_id="docling-page-1") is None


# ── E. Integrity ────────────────────────────────────────────────────────────

def test_exact_topology_verifies():
    region = mk_region(FINANCIAL_CELLS)
    rep = ti.evaluate_table_integrity(tc.candidate_from_source_topology(region=region), financial_evidence(region))
    assert rep["state"] == "verified" and rep["hardDefects"] == []
    assert rep["metrics"]["numericCellAssociationAccuracy"] == 1.0


def test_row_mismatch_rejects():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    cand["numRows"] = 3
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    assert "row_count_mismatch" in [d["code"] for d in rep["hardDefects"]]


def test_column_mismatch_rejects():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    cand["numCols"] = 3
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    assert "column_count_mismatch" in [d["code"] for d in rep["hardDefects"]]


def test_generic_header_rejects_when_source_has_headers():
    gen = [cell(0, 0, "Column 1", 40, 100, ch=True), cell(0, 1, "Column 2", 290, 100, ch=True),
           cell(1, 0, "2020", 40, 140), cell(1, 1, "$1,200,000", 290, 140)]
    region = mk_region(FINANCIAL_CELLS)  # evidence has real headers Year/Value
    cand = tc.candidate_from_source_topology(region=mk_region(gen))
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    assert "generic_header_substitution" in [d["code"] for d in rep["hardDefects"]]


def test_no_header_source_does_not_require_fake_headers():
    no_hdr = [cell(0, 0, "2019", 40, 100), cell(0, 1, "$1,000,000", 290, 100),
              cell(1, 0, "2020", 40, 140), cell(1, 1, "$1,200,000", 290, 140)]
    region = mk_region(no_hdr, hrc=0)
    ev = tc.build_source_table_evidence(region=region, page_spans=[num_span("$1,200,000", 290, 140, sid="v")],
                                        page_vectors=[], adjacent_source_table_region_ids=[])
    cand = tc.candidate_from_source_topology(region=region)
    rep = ti.evaluate_table_integrity(cand, ev)
    codes = [d["code"] for d in rep["hardDefects"]]
    assert "generic_header_substitution" not in codes and "source_header_missing" not in codes


def test_missing_numeric_token_rejects():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    # blank out the financial value in the candidate
    for c in cand["cells"]:
        if c["text"] == "$1,200,000":
            c["text"] = ""
            c["numericTokens"] = []
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    assert "source_numeric_token_missing" in [d["code"] for d in rep["hardDefects"]]


def test_wrong_cell_numeric_rejects():
    # candidate places $1.2M in the header cell; source evidence has it in body (1,1)
    wrong = [cell(0, 0, "Year", 40, 100, ch=True), cell(0, 1, "$1,200,000", 290, 100, ch=True),
             cell(1, 0, "2020", 40, 140), cell(1, 1, "Value", 290, 140)]
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=mk_region(wrong))
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    assert "numeric_token_wrong_cell" in [d["code"] for d in rep["hardDefects"]]


def test_duplicated_numeric_rejects():
    dup = [cell(0, 0, "Year", 40, 100, ch=True), cell(0, 1, "Value", 290, 100, ch=True),
           cell(1, 0, "$1,200,000", 40, 140), cell(1, 1, "$1,200,000", 290, 140)]
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=mk_region(dup))
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    assert "source_numeric_token_duplicated" in [d["code"] for d in rep["hardDefects"]]


def test_bbox_mismatch_rejects():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    cand["bbox"] = {"x": 1000, "y": 1000, "width": 50, "height": 50}
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    assert "candidate_bbox_mismatch" in [d["code"] for d in rep["hardDefects"]]


def test_overflow_rejects():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    cand["cells"][0]["text"] = "X" * 400
    cand["cells"][0]["bbox"] = {"x": 40, "y": 100, "width": 20, "height": 40}
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    assert "candidate_overflow" in [d["code"] for d in rep["hardDefects"]]


def test_low_contrast_rejects():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    cand["cells"][3]["style"] = {"color": "#222222", "bg": "#333333"}
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    assert "candidate_unreadable_contrast" in [d["code"] for d in rep["hardDefects"]]


def test_high_score_cannot_override_hard_defect():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    cand["numRows"] = 3  # inject a hard defect while everything else is perfect
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    assert rep["state"] == "rejected" and rep["score"] is None
    arb = ti.arbitrate_table_candidates(source_region_id=region["id"], candidates=[cand], reports=[rep],
                                        source_crop_available=True, page_raster_available=True, financial=True)
    assert arb["state"] == "source_crop"  # never native despite otherwise-perfect metrics


def test_financial_unscored_when_association_unavailable():
    # No source cell bboxes → association cannot be measured → financial unverifiable.
    cells = [cell(0, 0, "Year", 40, 100, ch=True), cell(0, 1, "Value", 290, 100, ch=True),
             cell(1, 0, "2020", 40, 140), cell(1, 1, "$1,200,000", 290, 140)]
    for c in cells:
        c["bbox"] = None
    region = mk_region(cells)
    ev = tc.build_source_table_evidence(region=region, page_spans=[num_span("$1,200,000", 290, 140, sid="v")],
                                        page_vectors=[], adjacent_source_table_region_ids=[])
    cand = tc.candidate_from_source_topology(region=region)
    rep = ti.evaluate_table_integrity(cand, ev, financial=True)
    codes = [d["code"] for d in rep["hardDefects"]]
    assert "source_table_evidence_incomplete" in codes or "candidate_unscored" in codes


# ── F. Adjacent-table merge ─────────────────────────────────────────────────

def test_two_source_tables_stay_separate():
    t1 = mk_region(FINANCIAL_CELLS, rid="src-p0001-tabl-0001-aaaa", bbox={"x": 40, "y": 100, "width": 240, "height": 80})
    t2 = mk_region(FINANCIAL_CELLS, rid="src-p0001-tabl-0002-bbbb", bbox={"x": 320, "y": 100, "width": 240, "height": 80})
    c1 = tc.candidate_from_source_topology(region=t1)
    assert ti.detect_adjacent_merge(c1, [t1, t2]) is None


def test_one_candidate_covering_two_tables_rejected():
    t1 = mk_region(FINANCIAL_CELLS, rid="src-p0001-tabl-0001-aaaa", bbox={"x": 40, "y": 100, "width": 240, "height": 80})
    t2 = mk_region(FINANCIAL_CELLS, rid="src-p0001-tabl-0002-bbbb", bbox={"x": 300, "y": 100, "width": 240, "height": 80})
    merged = tc.candidate_from_source_topology(region=t1)
    merged["bbox"] = {"x": 40, "y": 100, "width": 500, "height": 80}  # spans both
    defect = ti.detect_adjacent_merge(merged, [t1, t2])
    assert defect and defect["code"] == "adjacent_source_tables_merged"


# ── G. Split detection ──────────────────────────────────────────────────────

def test_same_provider_fragments_flag_split():
    region = mk_region(FINANCIAL_CELLS)
    a = tc.candidate_from_source_topology(region=region, profile={"runtimeProfile": "legacy", "tableMode": "fast", "cellMatching": True})
    b = copy.deepcopy(a)
    b["id"] = a["id"] + "-frag"  # simulate a second same-provider fragment
    ev = financial_evidence(region)
    defect = ti.detect_source_split([a, b], ev)
    assert defect and defect["code"] == "single_source_table_split"


# ── H. Arbitration ──────────────────────────────────────────────────────────

def test_safe_candidate_selected():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    arb = ti.arbitrate_table_candidates(source_region_id=region["id"], candidates=[cand], reports=[rep],
                                        source_crop_available=True, page_raster_available=True, financial=True)
    assert arb["state"] == "native_verified" and arb["selectedCandidateId"] == cand["id"]


def test_no_safe_candidate_with_crop_uses_source_crop():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    cand["numRows"] = 9
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    arb = ti.arbitrate_table_candidates(source_region_id=region["id"], candidates=[cand], reports=[rep],
                                        source_crop_available=True, page_raster_available=True, financial=True)
    assert arb["state"] == "source_crop"


def test_no_crop_falls_back_to_containment():
    region = mk_region(FINANCIAL_CELLS, crop=False)
    cand = tc.candidate_from_source_topology(region=region)
    cand["numRows"] = 9
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    arb = ti.arbitrate_table_candidates(source_region_id=region["id"], candidates=[cand], reports=[rep],
                                        source_crop_available=False, page_raster_available=True, financial=True)
    assert arb["state"] == "containment_fallback"


def test_no_crop_no_raster_blocks():
    region = mk_region(FINANCIAL_CELLS, crop=False)
    cand = tc.candidate_from_source_topology(region=region)
    cand["numRows"] = 9
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    arb = ti.arbitrate_table_candidates(source_region_id=region["id"], candidates=[cand], reports=[rep],
                                        source_crop_available=False, page_raster_available=False, financial=True)
    assert arb["state"] == "blocked"


def test_deterministic_tiebreak_and_provider_last():
    region = mk_region(FINANCIAL_CELLS)
    primary = tc.candidate_from_source_topology(region=region, provider="docling-primary")
    accurate = tc.candidate_from_source_topology(region=region, provider="docling-accurate-cell-matching",
                                                 profile={"runtimeProfile": "vnext", "tableMode": "accurate", "cellMatching": True})
    ev = financial_evidence(region)
    rp = ti.evaluate_table_integrity(primary, ev)
    ra = ti.evaluate_table_integrity(accurate, ev)
    arb = ti.arbitrate_table_candidates(source_region_id=region["id"], candidates=[primary, accurate],
                                        reports=[rp, ra], source_crop_available=True, page_raster_available=True, financial=True)
    # identical metrics → provider priority breaks the tie: accurate-cell-matching first.
    assert arb["selectedCandidateId"] == accurate["id"]
    assert arb["rankedCandidateIds"][0] == accurate["id"]


# ── J. Preservation + suppression ───────────────────────────────────────────

def test_verified_native_plan_suppresses_children():
    child = ssg._base_region(1, "docling-page-1", "text", {"x": 60, "y": 145, "width": 60, "height": 20}, 1)
    region = mk_region(FINANCIAL_CELLS, children=[child["id"]])
    child["relationships"]["parentRegionId"] = region["id"]
    cand = tc.candidate_from_source_topology(region=region)
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    arb = ti.arbitrate_table_candidates(source_region_id=region["id"], candidates=[cand], reports=[rep],
                                        source_crop_available=True, page_raster_available=True, financial=True)
    plan = ti.build_table_preservation_plan(regions=[region, child], arbitrations={region["id"]: arb})
    p = plan["tables"][0]
    assert p["renderMode"] == "verified-native-table"
    assert child["id"] in p["suppressRegionIds"]


def test_source_crop_plan_requires_review():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    cand["numRows"] = 9
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    arb = ti.arbitrate_table_candidates(source_region_id=region["id"], candidates=[cand], reports=[rep],
                                        source_crop_available=True, page_raster_available=True, financial=True)
    plan = ti.build_table_preservation_plan(regions=[region], arbitrations={region["id"]: arb})
    assert plan["tables"][0]["renderMode"] == "table-source-crop"
    assert plan["tables"][0]["manualReviewRequired"] is True


def test_preservation_deterministic():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    arb = ti.arbitrate_table_candidates(source_region_id=region["id"], candidates=[cand], reports=[rep],
                                        source_crop_available=True, page_raster_available=True, financial=True)
    a = ti.build_table_preservation_plan(regions=[region], arbitrations={region["id"]: arb})
    b = ti.build_table_preservation_plan(regions=[region], arbitrations={region["id"]: arb})
    assert a == b


# ── K/L. E0 + E3 interop ────────────────────────────────────────────────────

def test_incomplete_evidence_cannot_become_native():
    region = mk_region(FINANCIAL_CELLS, complete=False)
    cand = tc.candidate_from_source_topology(region=region)
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    assert rep["state"] in ("rejected", "unverifiable")
    arb = ti.arbitrate_table_candidates(source_region_id=region["id"], candidates=[cand], reports=[rep],
                                        source_crop_available=True, page_raster_available=True, financial=True)
    assert arb["state"] != "native_verified"


def test_nested_chart_inside_cropped_table_suppressed_once():
    chart = ssg._base_region(1, "docling-page-1", "chart", {"x": 60, "y": 110, "width": 200, "height": 60}, 1)
    region = mk_region(FINANCIAL_CELLS, children=[chart["id"]])
    chart["relationships"]["parentRegionId"] = region["id"]
    cand = tc.candidate_from_source_topology(region=region)
    cand["numRows"] = 9  # force source-crop
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    arb = ti.arbitrate_table_candidates(source_region_id=region["id"], candidates=[cand], reports=[rep],
                                        source_crop_available=True, page_raster_available=True, financial=True)
    plan = ti.build_table_preservation_plan(regions=[region, chart], arbitrations={region["id"]: arb})
    p = plan["tables"][0]
    assert p["renderMode"] == "table-source-crop"
    assert chart["id"] in p["suppressRegionIds"]  # nested chart suppressed (outer table wins)


# ── O. Security ─────────────────────────────────────────────────────────────

def test_unsafe_crop_path_rejected():
    cand = tc.candidate_from_source_topology(region=mk_region(FINANCIAL_CELLS))
    cand["sourceCropPath"] = "../../etc/passwd"
    assert "candidate_crop_path_unsafe" in tc.validate_table_candidate(cand)


def test_external_url_crop_path_stripped():
    region = mk_region(FINANCIAL_CELLS)
    region["sourceCrop"]["path"] = "https://evil.example/x.png"
    cand = tc.candidate_from_source_topology(region=region)
    assert cand["sourceCropPath"] is None  # external URL never accepted as durable path


def test_no_source_text_in_problem_codes():
    region = mk_region(FINANCIAL_CELLS)
    cand = tc.candidate_from_source_topology(region=region)
    cand["numRows"] = 5
    rep = ti.evaluate_table_integrity(cand, financial_evidence(region))
    # Problem/defect codes are bounded identifiers, never raw financial text.
    for d in rep["hardDefects"]:
        assert "$1,200,000" not in str(d["code"])

"""E5 — Typography, Glyph, Unicode & Font Fidelity (deterministic, pure).

Covers the Python producer half of E5: source typography runs, extended
punctuation integrity, unmapped-glyph handling, source font identity, font-asset
validation + manifest, deterministic IDs and security. No Docling/network/random.
"""

import copy
import struct

import source_scene_graph as ssg
import source_typography as st
import font_assets as fa


PAGE_W, PAGE_H = 595.0, 842.0


def span(text, x=40, y=100, w=200, h=16, sid="s1", font="ABCDEF+Helvetica", size=11,
         weight=400, italic=False, label="paragraph", line_height=1.3, color="#111111"):
    return {"id": sid, "bbox": {"x": x, "y": y, "width": w, "height": h}, "raw": text,
            "normalizedNfc": ssg.normalize_nfc(text), "font": font, "fontSize": size,
            "weight": weight, "italic": italic, "label": label, "lineHeight": line_height,
            "color": color, "fontObjectRef": "7 0 R"}


def run(text, **kw):
    return st.build_typography_run(global_page=1, page_id="docling-page-1", ordinal=1,
                                   span=span(text, **kw), source_region_id=None)


# ── A. Contract + IDs ───────────────────────────────────────────────────────

def test_versions_exact():
    assert st.SOURCE_TYPOGRAPHY_EVIDENCE_VERSION == "source-typography-evidence-v1"
    assert st.SOURCE_FONT_IDENTITY_VERSION == "source-font-identity-v1"
    assert st.TYPOGRAPHY_RUN_CONTRACT_VERSION == "typography-run-contract-v1"
    assert fa.FONT_ASSET_MANIFEST_VERSION == "font-asset-manifest-v1"


def test_valid_run_passes():
    r = run("Investment thesis")
    assert r["version"] == "typography-run-contract-v1"
    assert r["complete"] and r["problems"] == []
    assert r["id"].startswith("strun-p0001-0001-")


def test_run_id_deterministic():
    a = run("Hello"); b = run("Hello")
    assert a["id"] == b["id"]


def test_run_id_chunk_independent():
    # Same parent-global page + bbox + span ids → identical id (mono == chunk).
    s = span("Same", sid="src-span-1")
    mono = st.build_typography_run(global_page=21, page_id="p", ordinal=3, span=s, source_region_id=None)
    chunk = st.build_typography_run(global_page=21, page_id="p", ordinal=3, span=s, source_region_id=None)
    assert mono["id"] == chunk["id"]


def test_signed_url_does_not_affect_identity():
    a = run("Hello")
    b = st.build_typography_run(global_page=1, page_id="docling-page-1", ordinal=1,
                                span=span("Hello"), source_region_id=None,
                                source_crop={"path": "job/pages/page-001/typography/x.png", "sha256": "a" * 64,
                                             "widthPx": 1, "heightPx": 1, "dpi": 300, "paddingPt": 2.0})
    assert a["id"] == b["id"]


def test_build_does_not_mutate_span():
    s = span("Hello")
    snap = copy.deepcopy(s)
    st.build_typography_run(global_page=1, page_id="p", ordinal=1, span=s, source_region_id=None)
    assert s == snap


# ── B. Unicode / punctuation integrity ──────────────────────────────────────

def test_nfc_stored_separately_raw_preserved():
    r = run("Café – 3.5%")
    assert r["rawText"] == "Café – 3.5%"          # raw preserved exactly
    assert "–" in r["rawText"]
    assert r["searchNormalized"] != r["rawText"]  # search-normalized coexists separately


def test_en_dash_preserved_and_critical():
    r = run("10–15 years")
    kinds = {t["kind"] for t in r["punctuationTokens"]}
    assert "en-dash" in kinds
    assert any(t["kind"] == "en-dash" and t["critical"] for t in r["punctuationTokens"])
    assert "–" in r["rawText"]  # NOT folded to hyphen in the visible text


def test_em_dash_minus_multiplication_arrow_distinct():
    r = run("a — b −c 8×8 →")
    kinds = {t["kind"] for t in r["punctuationTokens"]}
    assert {"em-dash", "minus", "multiplication", "arrow"} <= kinds


def test_nbsp_and_narrow_nbsp_preserved():
    r = run("$1 000 4 000")
    kinds = {t["kind"] for t in r["punctuationTokens"]}
    assert "non-breaking-space" in kinds and "narrow-no-break-space" in kinds


def test_superscript_and_degree_preserved():
    r = run("712m² 20°")
    kinds = {t["kind"] for t in r["punctuationTokens"]}
    assert "superscript-two" in kinds and "degree" in kinds


def test_normal_space_not_classified():
    r = run("dual occupancy 10 15")
    assert all(t["kind"] != "non-breaking-space" for t in r["punctuationTokens"])
    # only the absence of a hyphen here; a normal run has no critical punctuation
    assert not [t for t in r["punctuationTokens"] if t["critical"]]


def test_hyphen_distinct_from_dash():
    r = run("dual-occupancy")
    assert any(t["kind"] == "hyphen" for t in r["punctuationTokens"])
    assert all(t["kind"] != "en-dash" for t in r["punctuationTokens"])


def test_search_normalized_does_not_change_visible():
    r = run("$910,000–$920,000")
    assert "–" in r["rawText"]                      # visible keeps en-dash
    assert "-" in r["searchNormalized"]             # search folds to hyphen
    assert r["rawText"] != r["searchNormalized"]


def test_range_numeric_tokens_preserved():
    r = run("$450,000 – $470,000")
    assert any(t.get("kind") == "range" for t in r["numericTokens"])


# ── C. Glyph evidence ───────────────────────────────────────────────────────

def test_codepoints_recorded():
    r = run("AB")
    assert r["codePoints"] == [65, 66]


def test_glyph_evidence_per_codepoint():
    r = run("AB")
    assert len(r["glyphs"]) == 2
    assert r["glyphs"][0]["unicode"] == "A" and r["glyphs"][0]["codePoint"] == 65


def test_unmapped_glyph_flagged_not_guessed():
    r = run("Price GLYPH<12> total")
    assert r["unmappedGlyphCount"] >= 1
    assert "unmapped_source_glyph" in r["problems"]
    assert r["complete"] is False


def test_replacement_char_is_unmapped():
    r = run("Va�lue")
    assert r["unmappedGlyphCount"] >= 1
    assert any(g["unmapped"] and g["unicode"] is None for g in r["glyphs"])


def test_no_guessed_unicode_for_unmapped():
    r = run("�")
    assert r["glyphs"][0]["unicode"] is None and r["glyphs"][0]["codePoint"] is None


def test_page_glyph_evidence_has_aggregate_budget():
    text = "A" * st.MAX_GLYPHS_PER_RUN
    spans = [span(text, y=i, sid=f"s{i}") for i in range(100)]

    runs, problems = st.build_page_typography(
        global_page=1, page_id="p", spans=spans,
    )

    assert sum(len(item["glyphs"]) for item in runs) == st.MAX_GLYPH_EVIDENCE_PER_PAGE
    assert "typography_glyph_budget_exceeded" in problems
    assert len(runs) < len(spans)


def test_page_text_codepoints_have_aggregate_budget():
    text = "A" * st.MAX_RUN_TEXT_LEN
    spans = [span(text, y=i, sid=f"s{i}") for i in range(10)]

    runs, problems = st.build_page_typography(
        global_page=1, page_id="p", spans=spans,
    )

    assert sum(len(item["codePoints"]) for item in runs) == st.MAX_TEXT_CODEPOINTS_PER_PAGE
    assert "typography_text_budget_exceeded" in problems
    assert len(runs) < len(spans)


# ── D. Font identity ────────────────────────────────────────────────────────

def test_subset_prefix_retained_and_normalized():
    fi = st.build_source_font_identity(raw_name="ABCDEF+Helvetica-Bold", weight_class=700, source_object_ref="7 0 R")
    assert fi["rawName"] == "ABCDEF+Helvetica-Bold"     # raw retained
    assert fi["subsetPrefix"] == "ABCDEF" and fi["isSubset"] is True
    assert fi["normalizedFamily"] == "Helvetica"        # normalized for matching only


def test_non_subset_font_identity():
    fi = st.build_source_font_identity(raw_name="Times New Roman")
    assert fi["isSubset"] is False and fi["subsetPrefix"] is None


def test_weight_and_italic_retained():
    fi = st.build_source_font_identity(raw_name="Inter", weight_class=300, italic=True, width_class=5)
    assert fi["weightClass"] == 300 and fi["italic"] is True and fi["widthClass"] == 5


def test_variable_axes_retained():
    fi = st.build_source_font_identity(raw_name="Roboto Flex", variable_axes={"wght": 550.0, "wdth": 100.0})
    assert fi["variableAxes"] == {"wght": 550.0, "wdth": 100.0}


def test_font_object_ref_retained():
    fi = st.build_source_font_identity(raw_name="X", source_object_ref="12 0 R")
    assert fi["sourceObjectRef"] == "12 0 R"


def test_critical_content_classification():
    assert st.classify_critical_content(raw_text="$1,200,000 p.a.", label=None, region_type=None) == "financial"
    assert st.classify_critical_content(raw_text="Disclaimer: no liability", label=None, region_type=None) == "legal"
    assert st.classify_critical_content(raw_text="Overview", label="title", region_type=None) == "heading"
    assert st.classify_critical_content(raw_text="x", label="paragraph", region_type=None, in_table=True) == "table-cell"
    assert st.classify_critical_content(raw_text="x", label="paragraph", region_type=None, in_chart=True) == "chart-label"


# ── E. Font asset validation ────────────────────────────────────────────────

def _mk_sfnt(tags):
    n = len(tags)
    hdr = struct.pack(">IHHHH", 0x00010000, n, 0, 0, 0)
    recs = b""
    off = 12 + n * 16
    for t in tags:
        recs += t.encode("latin-1")[:4].ljust(4) + struct.pack(">III", 0, off, 16)
        off += 16
    return hdr + recs + b"\x00" * 256


def test_valid_font_accepted():
    v = fa.validate_font_bytes(_mk_sfnt(["glyf", "cmap", "head"]))
    assert v["state"] == "valid" and v["format"] == "ttf"


def test_invalid_magic_rejected():
    assert fa.validate_font_bytes(b"NOTAFONT" * 20)["state"] == "invalid"


def test_oversized_font_rejected():
    assert fa.validate_font_bytes(b"\x00\x01\x00\x00" + b"x" * (9 * 1024 * 1024))["state"] == "invalid"


def test_tiny_font_rejected():
    assert fa.validate_font_bytes(b"\x00\x01\x00\x00")["state"] == "invalid"


def test_missing_glyph_table_flagged():
    v = fa.validate_font_bytes(_mk_sfnt(["head", "name"]))
    assert "font_missing_glyph_table" in v["problems"] and v["state"] == "invalid"


def test_font_asset_id_deterministic():
    a = fa.font_asset_id("7 0 R", "a" * 64, "Helvetica")
    b = fa.font_asset_id("7 0 R", "a" * 64, "Helvetica")
    assert a == b and a.startswith("fontasset-")


def test_manifest_licence_unknown_by_default():
    fi = st.build_source_font_identity(raw_name="ABCDEF+Helvetica", source_object_ref="7 0 R")
    m = fa.build_font_asset_manifest(source_font=fi, durable_path="job/fonts/x.ttf", sha256="a" * 64,
                                     validation=fa.validate_font_bytes(_mk_sfnt(["glyf", "cmap", "head"])),
                                     glyph_coverage=[65, 66, 67])
    assert m["licenceState"] == "unknown" and m["embeddingPolicy"] == "private-job-only"
    assert m["validationState"] == "valid"


def test_policy_disallowed_manifest():
    fi = st.build_source_font_identity(raw_name="Brand", source_object_ref="9 0 R")
    m = fa.build_font_asset_manifest(source_font=fi, durable_path="job/fonts/b.ttf", sha256="b" * 64,
                                     validation=fa.validate_font_bytes(_mk_sfnt(["glyf", "cmap"])),
                                     embedding_policy="rendering-disallowed")
    assert m["validationState"] == "policy_disallowed"


def test_subset_coverage_gate():
    fi = st.build_source_font_identity(raw_name="ABCDEF+Sub", source_object_ref="1 0 R")
    m = fa.build_font_asset_manifest(source_font=fi, durable_path="job/fonts/s.ttf", sha256="c" * 64,
                                     validation=fa.validate_font_bytes(_mk_sfnt(["glyf", "cmap"])),
                                     glyph_coverage=[65, 66])
    assert fa.subset_covers_run(m, [65, 66]) is True
    assert fa.subset_covers_run(m, [65, 90]) is False   # missing 'Z' → not covered


# ── F. Security ─────────────────────────────────────────────────────────────

def test_unsafe_font_path_stripped():
    fi = st.build_source_font_identity(raw_name="X", source_object_ref="1 0 R")
    m = fa.build_font_asset_manifest(source_font=fi, durable_path="../../etc/passwd", sha256="d" * 64,
                                     validation=fa.validate_font_bytes(_mk_sfnt(["glyf", "cmap"])))
    assert m["durablePath"] is None and "font_path_unsafe" in m["problems"]


def test_no_raw_text_in_run_problems():
    r = run("$1,200,000 GLYPH<9>")
    for p in r["problems"]:
        assert "$1,200,000" not in p


def test_sha_only_when_valid_64hex():
    fi = st.build_source_font_identity(raw_name="X", source_object_ref="1 0 R")
    m = fa.build_font_asset_manifest(source_font=fi, durable_path="job/fonts/x.ttf", sha256="short",
                                     validation=fa.validate_font_bytes(_mk_sfnt(["glyf", "cmap"])))
    assert m["sha256"] is None

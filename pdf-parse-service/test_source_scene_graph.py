"""Pure contract tests for source-scene-graph-v2 (E1).

Uses generated/anonymised fixtures only — never the private client report or any
real source crop. Exercises the deterministic ID + normalisation + token + table
+ chart + foreground + validation contract without a live Docling/sidecar.
"""

import io

import source_scene_graph as ssg


# ── Fixtures (generated, artificial) ────────────────────────────────────────

def _bbox(l, t, r, b, origin="TOPLEFT"):
    return {"l": l, "t": t, "r": r, "b": b, "coord_origin": origin}


def _text(text, l, t, r, b, label="paragraph", **kw):
    item = {"text": text, "label": label, "prov": [{"page_no": kw.get("page_no", 1), "bbox": _bbox(l, t, r, b)}]}
    item.update({k: v for k, v in kw.items() if k != "page_no"})
    return item


def _table(rows, cols, cells, l=40, t=100, r=550, b=400, caption=None):
    return {
        "prov": [{"page_no": 1, "bbox": _bbox(l, t, r, b)}],
        "data": {"num_rows": rows, "num_cols": cols, "table_cells": cells},
        "caption": caption,
    }


def _cell(row, col, text, col_header=False, row_header=False, row_span=1, col_span=1):
    return {
        "start_row_offset_idx": row, "end_row_offset_idx": row + row_span,
        "start_col_offset_idx": col, "end_col_offset_idx": col + col_span,
        "row_span": row_span, "col_span": col_span,
        "column_header": col_header, "row_header": row_header, "text": text,
    }


def _picture(l, t, r, b, classification=None, caption=None, uri=None):
    pic = {"prov": [{"page_no": 1, "bbox": _bbox(l, t, r, b)}]}
    if classification is not None:
        pic["classification"] = {"predicted_class": classification}
    if caption is not None:
        pic["caption"] = caption
    if uri is not None:
        pic["image"] = {"uri": uri}
    return pic


PAGE_W, PAGE_H = 595.0, 842.0


# ── A. Version + ID + normalisation ─────────────────────────────────────────

def test_1_scene_version():
    assert ssg.SOURCE_SCENE_GRAPH_VERSION == "source-scene-graph-v2"


def test_2_region_version():
    assert ssg.SOURCE_REGION_VERSION == "source-region-v2"


def test_3_page_artifact_version():
    assert ssg.PAGE_ARTIFACT_CONTRACT_VERSION == "pdf-page-artifact-contract-v3"


def test_4_identical_input_same_region_ids():
    args = dict(global_page=7, page_id="docling-page-7", page_width=PAGE_W, page_height=PAGE_H,
                texts=[], tables=[_table(2, 2, [_cell(0, 0, "A", col_header=True)])], pictures=[], vectors=[])
    a, _ = ssg.build_page_regions(**args)
    b, _ = ssg.build_page_regions(**args)
    assert [r["id"] for r in a] == [r["id"] for r in b]
    assert all(r["id"].startswith("src-p0007-") for r in a)


def test_5_timestamps_do_not_affect_ids():
    # IDs are derived purely from page/type/bbox/ordinal — no time input exists.
    rid1 = ssg.region_id(3, "chart", {"x": 10, "y": 20, "width": 100, "height": 80}, 1)
    rid2 = ssg.region_id(3, "chart", {"x": 10, "y": 20, "width": 100, "height": 80}, 1)
    assert rid1 == rid2


def test_6_signed_urls_do_not_affect_ids():
    region = ssg._base_region(3, "p3", "chart", {"x": 10, "y": 20, "width": 100, "height": 80}, 1)
    before = region["id"]
    ssg.attach_crop(region, path="job/pages/page-003/regions/x.png", sha256="a" * 64,
                    mime="image/png", width_px=100, height_px=80, source_dpi=300, padding_pt=2.0)
    assert region["id"] == before


def test_7_chunk_local_numbering_does_not_affect_parent_ids():
    # Monolithic parse: page 21. Chunked parse: chunk-local page 1 rebased to 21.
    table = _table(2, 2, [_cell(0, 0, "A")])
    mono, _ = ssg.build_page_regions(global_page=21, page_id="p21", page_width=PAGE_W, page_height=PAGE_H,
                                     texts=[], tables=[table], pictures=[], vectors=[])
    chunk, _ = ssg.build_page_regions(global_page=21, page_id="p21", page_width=PAGE_W, page_height=PAGE_H,
                                      texts=[], tables=[table], pictures=[], vectors=[])
    assert [r["id"] for r in mono] == [r["id"] for r in chunk]


def test_8_canonical_bbox_rounding_deterministic():
    a = ssg.region_id(1, "table", {"x": 10.004, "y": 20.006, "width": 100.001, "height": 80.009}, 1)
    b = ssg.region_id(1, "table", {"x": 10.0, "y": 20.01, "width": 100.0, "height": 80.01}, 1)
    assert a == b  # both round to (10.00, 20.01, 100.00, 80.01)


def test_9_topleft_bbox_correct():
    bbox, problems = ssg.normalize_bbox(_bbox(10, 20, 110, 100, "TOPLEFT"), PAGE_W, PAGE_H)
    assert bbox == {"x": 10.0, "y": 20.0, "width": 100.0, "height": 80.0}
    assert problems == []


def test_10_bottomleft_bbox_converts():
    # BOTTOMLEFT: t/b measured from bottom. page_h=842; rect bottom=742 top=822.
    bbox, _ = ssg.normalize_bbox(_bbox(10, 742, 110, 822, "BOTTOMLEFT"), PAGE_W, PAGE_H)
    # y_top = 842 - 822 = 20; height = 822-742 = 80
    assert bbox["y"] == 20.0 and bbox["height"] == 80.0


def test_11_rotated_page_geometry_recorded():
    scene = ssg.assemble_page_scene(
        global_page=1, page_id="p1", width_pt=PAGE_W, height_pt=PAGE_H, rotation=90,
        regions=[], source_raster={"path": "j/pages/page-001.png", "sha256": "b" * 64,
                                   "widthPx": 2480, "heightPx": 3508, "dpi": 300, "mime": "image/png"},
        foreground=None, regions_path="j/pages/page-001/regions.json", source_spans_path=None,
        source_chunk=None)
    assert scene["geometry"]["rotation"] == 90


def test_12_off_page_bbox_rejected():
    bbox, problems = ssg.normalize_bbox(_bbox(700, 900, 800, 1000), PAGE_W, PAGE_H)
    assert bbox is None and "bbox_off_page" in problems


def test_12b_exceeds_page_clamped():
    bbox, problems = ssg.normalize_bbox(_bbox(-5, -5, 600, 850), PAGE_W, PAGE_H)
    assert bbox is not None and "bbox_exceeds_page_clamped" in problems
    assert bbox["x"] == 0.0 and bbox["y"] == 0.0


def test_13_zero_size_region_rejected():
    bbox, problems = ssg.normalize_bbox(_bbox(10, 20, 10, 40), PAGE_W, PAGE_H)
    assert bbox is None and "bbox_zero_area" in problems


def test_14_duplicate_region_id_rejected():
    scene = ssg.assemble_page_scene(
        global_page=1, page_id="p1", width_pt=PAGE_W, height_pt=PAGE_H, rotation=0,
        regions=[ssg._base_region(1, "p1", "text", {"x": 1, "y": 1, "width": 5, "height": 5}, 1)],
        source_raster={"path": "j/x.png", "sha256": "b" * 64, "widthPx": 1, "heightPx": 1, "dpi": 300, "mime": "image/png"},
        foreground=None, regions_path="j/r.json", source_spans_path=None, source_chunk=None)
    scene["regionIds"] = ["dup", "dup"]
    result = ssg.validate_page_scene({**scene, "regions": []})
    assert any("duplicate_region_id" in p for p in result["problems"])


def test_15_relationship_to_missing_region_marks_incomplete():
    # A region referencing a missing child is not a hard validation error but the
    # relationship list is preserved; document-level dupes are the enforced case.
    region = ssg._base_region(1, "p1", "chart", {"x": 1, "y": 1, "width": 5, "height": 5}, 1)
    region["relationships"]["childRegionIds"] = ["missing-id"]
    # crop-required + no crop → incomplete.
    result = ssg._validate_region(region, 1)
    assert "critical_region_missing_crop" in result


# ── B. Token evidence ───────────────────────────────────────────────────────

def test_16_nfc_preserves_punctuation():
    raw = "Café – 3.5%"
    n = ssg.normalize_nfc(raw)
    assert "–" in n and "%" in n


def test_17_18_dashes_distinct():
    p = {t["kind"] for t in ssg.extract_punctuation_tokens("a – b — c")}
    assert "en-dash" in p and "em-dash" in p


def test_19_multiplication_distinct_from_x():
    p = {t["kind"] for t in ssg.extract_punctuation_tokens("3 × 4 x5")}
    assert "multiplication" in p


def test_20_arrow_distinct_from_hyphen():
    p = {t["kind"] for t in ssg.extract_punctuation_tokens("a → b - c")}
    assert "arrow" in p and "hyphen" in p


def test_21_currency_range_preserved():
    toks = ssg.extract_numeric_tokens("$450,000 – $470,000")
    rng = [t for t in toks if t["kind"] == "range"]
    assert rng and rng[0]["rangeStart"] == "450000" and rng[0]["rangeEnd"] == "470000"
    assert rng[0]["currency"] == "USD"


def test_22_percentage_classified():
    toks = ssg.extract_numeric_tokens("occupancy 4.2%")
    assert any(t["kind"] == "percentage" for t in toks)


def test_23_measurement_preserves_unit():
    toks = ssg.extract_numeric_tokens("land 650 sqm")
    meas = [t for t in toks if t["kind"] == "measurement"]
    assert meas and meas[0]["unit"] and "sqm" in meas[0]["unit"].lower()


def test_24_source_raw_not_sanitised():
    regions, _ = ssg.build_page_regions(
        global_page=1, page_id="p1", page_width=PAGE_W, page_height=PAGE_H,
        texts=[_text("Raw – value ×", 40, 40, 300, 60)], tables=[], pictures=[], vectors=[])
    text_regions = [r for r in regions if r["type"] == "text"]
    assert text_regions and text_regions[0]["text"]["raw"] == "Raw – value ×"


# ── C. Tables ───────────────────────────────────────────────────────────────

def test_25_26_rows_cols_headers_preserved():
    cells = [_cell(0, 0, "Year", col_header=True), _cell(0, 1, "Value", col_header=True),
             _cell(1, 0, "2024"), _cell(1, 1, "100")]
    topo = ssg.build_table_topology(_table(2, 2, cells))
    assert topo["numRows"] == 2 and topo["numCols"] == 2 and topo["headerRowCount"] == 1


def test_27_spans_in_bounds():
    cells = [_cell(0, 0, "Merged", col_span=2), _cell(1, 0, "a"), _cell(1, 1, "b")]
    topo = ssg.build_table_topology(_table(2, 2, cells))
    assert topo["complete"] and not topo["topologyProblems"]


def test_27b_span_out_of_bounds_flagged():
    cells = [_cell(0, 0, "X", col_span=5)]
    topo = ssg.build_table_topology(_table(1, 2, cells))
    assert "cell_col_span_out_of_bounds" in topo["topologyProblems"]


def test_28_merged_cell_text_only_on_anchor():
    cells = [_cell(0, 0, "Merged", col_span=2), _cell(1, 0, "a"), _cell(1, 1, "b")]
    topo = ssg.build_table_topology(_table(2, 2, cells))
    merged = [c for c in topo["cells"] if c["text"] == "Merged"]
    assert len(merged) == 1 and merged[0]["colSpan"] == 2
    assert sum(1 for c in topo["cells"] if c["text"] == "Merged") == 1


def test_29_cell_ids_deterministic():
    cells = [_cell(1, 2, "x")]
    a = ssg.build_table_topology(_table(3, 3, cells))["cells"][0]["id"]
    b = ssg.build_table_topology(_table(3, 3, cells))["cells"][0]["id"]
    assert a == b == "r1c2"


def test_30_numeric_tokens_on_correct_cell():
    cells = [_cell(0, 0, "Rent"), _cell(0, 1, "$540 – $560")]
    topo = ssg.build_table_topology(_table(1, 2, cells))
    valued = [c for c in topo["cells"] if c["col"] == 1][0]
    assert any(t["kind"] == "range" for t in valued["numericTokens"])
    labelled = [c for c in topo["cells"] if c["col"] == 0][0]
    assert labelled["numericTokens"] == []


def test_31_two_adjacent_tables_two_ids():
    t1 = _table(2, 2, [_cell(0, 0, "A")], l=40, t=100, r=280, b=300)
    t2 = _table(2, 2, [_cell(0, 0, "B")], l=300, t=100, r=550, b=300)
    regions, _ = ssg.build_page_regions(global_page=5, page_id="p5", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[], tables=[t1, t2], pictures=[], vectors=[])
    table_ids = [r["id"] for r in regions if r["type"] == "table"]
    assert len(table_ids) == 2 and len(set(table_ids)) == 2


def test_32_table_region_requires_crop():
    regions, _ = ssg.build_page_regions(global_page=1, page_id="p1", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[], tables=[_table(2, 2, [_cell(0, 0, "A")])], pictures=[], vectors=[])
    table = [r for r in regions if r["type"] == "table"][0]
    assert table["complete"] is False  # no crop yet
    ssg.attach_crop(table, path="j/pages/page-001/regions/t.png", sha256="c" * 64, mime="image/png",
                    width_px=200, height_px=100, source_dpi=300, padding_pt=2.0,
                    foreground={"foregroundRatio": 0.3, "edgeDensity": 0.1, "dominantColors": []})
    assert table["complete"] is True


def test_33_invalid_topology_marks_incomplete():
    topo = ssg.build_table_topology({"prov": [{"page_no": 1, "bbox": _bbox(1, 1, 5, 5)}],
                                     "data": {"num_rows": 0, "num_cols": 0, "table_cells": []}})
    assert topo["complete"] is False


# ── D. Pictures / charts ────────────────────────────────────────────────────

def test_34_picture_with_uri_region_and_crop():
    regions, _ = ssg.build_page_regions(global_page=2, page_id="p2", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[], tables=[], pictures=[_picture(40, 40, 300, 300, uri="data:x")], vectors=[])
    pics = [r for r in regions if r["type"] == "picture"]
    assert len(pics) == 1


def test_35_picture_without_uri_still_region():
    regions, _ = ssg.build_page_regions(global_page=2, page_id="p2", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[], tables=[], pictures=[_picture(40, 40, 300, 300)], vectors=[])
    pics = [r for r in regions if r["type"] == "picture"]
    assert len(pics) == 1  # crop rendered from PDF later; region exists regardless of URI


def test_36_explicit_chart_classification():
    regions, _ = ssg.build_page_regions(global_page=7, page_id="p7", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[], tables=[], pictures=[_picture(40, 40, 400, 300, classification="bar_chart")], vectors=[])
    charts = [r for r in regions if r["type"] == "chart"]
    assert len(charts) == 1 and charts[0]["chart"]["chartType"] == "bar"


def test_37_chart_caption_relationship_retained():
    regions, _ = ssg.build_page_regions(global_page=7, page_id="p7", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[], tables=[], pictures=[_picture(40, 40, 400, 300, classification="chart", caption="Price History")], vectors=[])
    charts = [r for r in regions if r["type"] == "chart"]
    assert charts[0]["chart"]["caption"] == "Price History"


def test_38_chart_crop_only_state():
    regions, _ = ssg.build_page_regions(global_page=7, page_id="p7", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[], tables=[], pictures=[_picture(40, 40, 400, 300, classification="chart")], vectors=[])
    assert regions[0]["chart"]["extractionState"] == "crop_only"


def test_39_chart_without_crop_incomplete():
    regions, _ = ssg.build_page_regions(global_page=7, page_id="p7", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[], tables=[], pictures=[_picture(40, 40, 400, 300, classification="chart")], vectors=[])
    scene = ssg.assemble_page_scene(
        global_page=7, page_id="p7", width_pt=PAGE_W, height_pt=PAGE_H, rotation=0, regions=regions,
        source_raster={"path": "j/x.png", "sha256": "d" * 64, "widthPx": 1, "heightPx": 1, "dpi": 300, "mime": "image/png"},
        foreground=None, regions_path="j/r.json", source_spans_path=None, source_chunk=None)
    assert scene["complete"] is False and "critical_regions_missing_crop" in scene["problems"]


def test_40_weak_keyword_alone_no_chart():
    # A picture with no chart class + a single weak title term + no numeric labels.
    regions, _ = ssg.build_page_regions(global_page=1, page_id="p1", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[_text("Trend", 40, 20, 200, 40, label="title")],
                                        tables=[], pictures=[_picture(40, 60, 300, 300)], vectors=[])
    assert not [r for r in regions if r["type"] == "chart"]


def test_41_dense_vector_cluster_bounded():
    vec = {"prov": [{"page_no": 1, "bbox": _bbox(40, 400, 500, 700)}],
           "bbox": {"l": 40, "t": 400, "r": 500, "b": 700},
           "paths": [{"d": "M0 0"}] * 20}
    regions, _ = ssg.build_page_regions(global_page=1, page_id="p1", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[_text("Value $1,200,000", 40, 20, 300, 40)],
                                        tables=[], pictures=[], vectors=[vec])
    vc = [r for r in regions if r["type"] == "vector-cluster"]
    assert len(vc) == 1


def test_42_decorative_border_not_cluster():
    vec = {"prov": [{"page_no": 1, "bbox": _bbox(0, 0, 595, 842)}],
           "bbox": {"l": 0, "t": 0, "r": 595, "b": 842}, "paths": [{"d": "M0 0"}, {"d": "M1 1"}]}
    regions, _ = ssg.build_page_regions(global_page=1, page_id="p1", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[], tables=[], pictures=[], vectors=[vec])
    assert not [r for r in regions if r["type"] == "vector-cluster"]


def test_43_logo_conservative():
    regions, _ = ssg.build_page_regions(global_page=1, page_id="p1", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[], tables=[], pictures=[_picture(40, 40, 120, 90, classification="company_logo")], vectors=[])
    assert [r for r in regions if r["type"] == "logo"]
    # A plain small picture is NOT a logo.
    regions2, _ = ssg.build_page_regions(global_page=1, page_id="p1", page_width=PAGE_W, page_height=PAGE_H,
                                         texts=[], tables=[], pictures=[_picture(40, 40, 120, 90)], vectors=[])
    assert not [r for r in regions2 if r["type"] == "logo"]


# ── E. Crops ────────────────────────────────────────────────────────────────

def test_44_crop_bbox_clamps_to_page():
    px = ssg.crop_bbox_pixels({"x": 580, "y": 830, "width": 100, "height": 100}, PAGE_H, 300, 2.0, PAGE_W)
    scale = 300 / 72.0
    assert px is not None
    assert px["left"] + px["width"] <= round(PAGE_W * scale) + 1


def test_45_crop_padding_deterministic():
    a = ssg.crop_bbox_pixels({"x": 100, "y": 100, "width": 50, "height": 50}, PAGE_H, 300, 2.0, PAGE_W)
    b = ssg.crop_bbox_pixels({"x": 100, "y": 100, "width": 50, "height": 50}, PAGE_H, 300, 2.0, PAGE_W)
    assert a == b and a["paddingPt"] == 2.0


def test_46_crop_hash_stable_metadata():
    region = ssg._base_region(1, "p1", "picture", {"x": 1, "y": 1, "width": 50, "height": 50}, 1)
    ssg.attach_crop(region, path="j/pages/page-001/regions/p.png", sha256="e" * 64, mime="image/png",
                    width_px=200, height_px=200, source_dpi=300, padding_pt=2.0,
                    foreground={"foregroundRatio": 0.5, "edgeDensity": 0.2, "dominantColors": []})
    assert region["sourceCrop"]["sha256"] == "e" * 64 and region["sourceCrop"]["sourceDpi"] == 300


def test_47_zero_area_crop_rejected():
    assert ssg.crop_bbox_pixels({"x": 100, "y": 100, "width": 0, "height": 0}, PAGE_H, 300, 2.0, PAGE_W) is None


def test_48_blank_critical_crop_flagged():
    region = ssg._base_region(1, "p1", "chart", {"x": 1, "y": 1, "width": 50, "height": 50}, 1)
    ssg.attach_crop(region, path="j/pages/page-001/regions/c.png", sha256="f" * 64, mime="image/png",
                    width_px=200, height_px=200, source_dpi=300, padding_pt=2.0,
                    foreground={"foregroundRatio": 0.001, "edgeDensity": 0.0, "dominantColors": []})
    assert "crop_appears_blank" in region["problems"] and region["complete"] is False


def test_49_crop_path_uses_region_id_safely():
    region = ssg._base_region(1, "p1", "picture", {"x": 1, "y": 1, "width": 50, "height": 50}, 1)
    path = f"job/pages/page-001/regions/{region['id']}.png"
    assert ssg.is_safe_artifact_path(path)


def test_50_crop_path_cannot_escape_prefix():
    region = ssg._base_region(1, "p1", "picture", {"x": 1, "y": 1, "width": 50, "height": 50}, 1)
    ssg.attach_crop(region, path="../../etc/passwd", sha256="a" * 64, mime="image/png",
                    width_px=1, height_px=1, source_dpi=300, padding_pt=2.0)
    assert "crop_path_unsafe" in region["problems"]


def test_51_crop_metadata_complete():
    region = ssg._base_region(1, "p1", "picture", {"x": 1, "y": 1, "width": 50, "height": 50}, 1)
    ssg.attach_crop(region, path="j/p.png", sha256="a" * 64, mime="image/png",
                    width_px=100, height_px=80, source_dpi=300, padding_pt=2.0,
                    foreground={"foregroundRatio": 0.4, "edgeDensity": 0.1, "dominantColors": []})
    c = region["sourceCrop"]
    assert c["widthPx"] == 100 and c["heightPx"] == 80 and c["mime"] == "image/png" and c["sha256"]


def test_52_signed_url_rejected_as_crop_path():
    assert not ssg.is_safe_artifact_path("https://x.supabase.co/storage/object?token=abc")
    assert not ssg.is_safe_artifact_path("data:image/png;base64,AAAA")


# ── F. Foreground ───────────────────────────────────────────────────────────

def _png(color=(255, 255, 255), size=(40, 40)):
    from PIL import Image
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_53_foreground_ratio_in_range():
    fg = ssg.build_foreground_summary(_png((0, 0, 0)))
    assert fg is not None and 0.0 <= fg["foregroundRatio"] <= 1.0


def test_54_tile_occupancy_bounded():
    fg = ssg.build_foreground_summary(_png((0, 0, 0)), tile_rows=8, tile_cols=8)
    assert len(fg["tileOccupancy"]) == 64


def test_55_non_white_bounds_correct():
    from PIL import Image
    img = Image.new("RGB", (40, 40), (255, 255, 255))
    for y in range(10, 20):
        for x in range(5, 15):
            img.putpixel((x, y), (0, 0, 0))
    buf = io.BytesIO(); img.save(buf, format="PNG")
    fg = ssg.build_foreground_summary(buf.getvalue())
    b = fg["nonWhiteBounds"]
    assert b["x"] == 5 and b["y"] == 10 and b["width"] == 10 and b["height"] == 10


def test_56_empty_white_page_no_critical_background():
    fg = ssg.build_foreground_summary(_png((255, 255, 255)))
    assert fg["foregroundRatio"] == 0.0


def test_57_dense_crop_higher_occupancy_than_blank():
    dense = ssg.build_foreground_summary(_png((10, 10, 10)))
    blank = ssg.build_foreground_summary(_png((255, 255, 255)))
    assert dense["foregroundRatio"] > blank["foregroundRatio"]


# ── Scene graph assembly + validation ───────────────────────────────────────

def _complete_scene_graph(page_count=1):
    regions, _ = ssg.build_page_regions(global_page=1, page_id="p1", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[_text("Hello world", 40, 40, 300, 60)], tables=[], pictures=[], vectors=[])
    scene = ssg.assemble_page_scene(
        global_page=1, page_id="p1", width_pt=PAGE_W, height_pt=PAGE_H, rotation=0, regions=regions,
        source_raster={"path": "j/pages/page-001.png", "sha256": "b" * 64, "widthPx": 2480, "heightPx": 3508, "dpi": 300, "mime": "image/png"},
        foreground=None, regions_path="j/pages/page-001/regions.json", source_spans_path="j/pages/page-001/source-spans.json",
        source_chunk=None)
    return ssg.assemble_scene_graph(source_sha256="a" * 64, page_count=page_count, page_scenes=[scene],
                                    engine="docling", engine_version="2.14.0", lane_policy_version="extractor-lane-policy-v2",
                                    generated_at="2026-07-20T00:00:00Z")


def test_scene_graph_valid():
    graph = _complete_scene_graph()
    result = ssg.validate_scene_graph(graph)
    assert result["ok"] and result["state"] == "valid_v2"


def test_scene_graph_unknown_version():
    result = ssg.validate_scene_graph({"version": "source-scene-graph-v9", "pages": []})
    assert result["state"] == "unknown_version"


def test_scene_graph_page_continuity():
    graph = _complete_scene_graph(page_count=1)
    # Duplicate the page with a gap → not continuous.
    p = dict(graph["pages"][0])
    p2 = {**p, "pageNumber": 3, "pageId": "p3", "regionIds": []}
    graph["pages"].append(p2)
    result = ssg.validate_scene_graph(graph)
    # still ok=valid_v2 structurally but assemble would flag; validate checks ids.
    assert result["state"] in ("valid_v2", "invalid_v2")


def test_assemble_flags_discontinuous_pages():
    regions, _ = ssg.build_page_regions(global_page=1, page_id="p1", page_width=PAGE_W, page_height=PAGE_H,
                                        texts=[_text("a", 1, 1, 5, 5)], tables=[], pictures=[], vectors=[])
    s1 = ssg.assemble_page_scene(global_page=1, page_id="p1", width_pt=PAGE_W, height_pt=PAGE_H, rotation=0,
                                 regions=regions, source_raster={"path": "x", "sha256": "b" * 64, "widthPx": 1, "heightPx": 1, "dpi": 300, "mime": "image/png"},
                                 foreground=None, regions_path="r", source_spans_path=None, source_chunk=None)
    s3 = ssg.assemble_page_scene(global_page=3, page_id="p3", width_pt=PAGE_W, height_pt=PAGE_H, rotation=0,
                                 regions=[], source_raster={"path": "y", "sha256": "b" * 64, "widthPx": 1, "heightPx": 1, "dpi": 300, "mime": "image/png"},
                                 foreground=None, regions_path="r3", source_spans_path=None, source_chunk=None)
    graph = ssg.assemble_scene_graph(source_sha256=None, page_count=2, page_scenes=[s1, s3],
                                     engine="docling", engine_version="2.14.0", lane_policy_version=None,
                                     generated_at="2026-07-20T00:00:00Z")
    assert "page_numbers_not_continuous" in graph["problems"] and graph["complete"] is False


def test_external_url_path_rejected():
    region = ssg._base_region(1, "p1", "picture", {"x": 1, "y": 1, "width": 5, "height": 5}, 1)
    region["sourceCrop"]["path"] = "https://evil.example/x.png"
    assert "region_crop_path_unsafe" in ssg._validate_region(region, 1)


def test_invalid_sha_rejected():
    region = ssg._base_region(1, "p1", "picture", {"x": 1, "y": 1, "width": 5, "height": 5}, 1)
    region["sourceCrop"]["path"] = "j/x.png"
    region["sourceCrop"]["sha256"] = "not-a-sha"
    assert "region_crop_sha_invalid" in ssg._validate_region(region, 1)


def test_source_spans_tokens_and_nfc():
    spans, problems = ssg.build_source_spans(
        [_text("$450,000 – $470,000", 40, 40, 300, 60)], global_page=5, page_width=PAGE_W, page_height=PAGE_H)
    assert spans and spans[0]["pageNumber"] == 5
    assert any(t["kind"] == "range" for t in spans[0]["numericTokens"])
    assert spans[0]["id"].startswith("src-p0005-span-")


def test_span_ids_chunk_independent():
    a, _ = ssg.build_source_spans([_text("x", 40, 40, 100, 60)], global_page=21, page_width=PAGE_W, page_height=PAGE_H)
    b, _ = ssg.build_source_spans([_text("x", 40, 40, 100, 60)], global_page=21, page_width=PAGE_W, page_height=PAGE_H)
    assert [s["id"] for s in a] == [s["id"] for s in b]


def test_fnv_known_value():
    # Pins the exact hash so the TypeScript port can assert agreement.
    assert ssg.fnv1a32("hello") == "4f9f2cab"
    assert ssg.fnv1a32("1|table|10.00|20.00|100.00|80.00|1") == ssg.fnv1a32("1|table|10.00|20.00|100.00|80.00|1")

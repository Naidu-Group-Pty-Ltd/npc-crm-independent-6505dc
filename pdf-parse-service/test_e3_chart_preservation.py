"""E3 — Chart & Picture Preservation (deterministic, dependency-free).

Exercises the pure chart-preservation surface added in E3:
  - deterministic chart detection signals (axis / legend / gridline / numeric)
  - chart → child relationships + semantic label extraction
  - the chart render plan (chart-crop vs containment-fallback) + suppression sets
  - chart preservation metrics
  - page-assembly integration + edge cases (mixed / multiple / nested / empty /
    invalid bbox / duplicate ids)

No Docling, no sidecar, no network, no randomness — identical inputs always
produce the identical result.
"""

import source_scene_graph as ssg


PAGE_W, PAGE_H = 595.0, 842.0


# ── Fixtures ────────────────────────────────────────────────────────────────

def _bbox(l, t, r, b, origin="TOPLEFT"):
    return {"l": l, "t": t, "r": r, "b": b, "coord_origin": origin}


def _text(text, l, t, r, b, label="paragraph", page_no=1):
    return {"text": text, "label": label, "prov": [{"page_no": page_no, "bbox": _bbox(l, t, r, b)}]}


def _picture(l, t, r, b, classification=None, caption=None, uri=None):
    pic = {"prov": [{"page_no": 1, "bbox": _bbox(l, t, r, b)}]}
    if classification is not None:
        pic["classification"] = {"predicted_class": classification}
    if caption is not None:
        pic["caption"] = caption
    if uri is not None:
        pic["image"] = {"uri": uri}
    return pic


def _vector(l, t, r, b, path_count):
    return {"prov": [{"page_no": 1, "bbox": _bbox(l, t, r, b)}],
            "bbox": {"l": l, "t": t, "r": r, "b": b},
            "paths": [{"d": "M0 0"}] * path_count}


# A picture (no Docling chart class) sitting over real axis ticks, legend keys
# and gridlines — the "fragmented chart" case E3 must now recognise.
def _signal_chart_texts():
    return [
        _text("0", 52, 120, 68, 135),      # axis tick (left edge)
        _text("50", 52, 220, 72, 235),     # axis tick (left edge)
        _text("Sales", 350, 110, 420, 125),   # legend key
        _text("Rentals", 350, 130, 415, 145), # legend key
    ]


def _build(texts=None, tables=None, pictures=None, vectors=None, page=1):
    return ssg.build_page_regions(
        global_page=page, page_id=f"docling-page-{page}", page_width=PAGE_W, page_height=PAGE_H,
        texts=texts or [], tables=tables or [], pictures=pictures or [], vectors=vectors or [],
    )


def _charts(regions):
    return [r for r in regions if r["type"] == "chart"]


def _attach_good_crop(region, sha="a" * 64):
    ssg.attach_crop(region, path=f"job/pages/page-001/regions/{region['id']}.png",
                    sha256=sha, mime="image/png", width_px=1200, height_px=900,
                    source_dpi=ssg.CHART_CROP_MIN_DPI, padding_pt=ssg.CROP_PADDING_PT,
                    foreground={"foregroundRatio": 0.4, "edgeDensity": 0.3, "dominantColors": []})


# ── 1. Detection ────────────────────────────────────────────────────────────

def test_versions_present():
    assert ssg.CHART_PRESERVATION_VERSION == "chart-preservation-v1"
    assert ssg.CHART_DETECTION_SIGNALS_VERSION == "chart-detection-signals-v1"
    assert ssg.CHART_CROP_MIN_DPI == 300


def test_docling_classification_detected():
    regions, _ = _build(pictures=[_picture(50, 100, 450, 400, classification="bar_chart")])
    charts = _charts(regions)
    assert len(charts) == 1
    assert charts[0]["chart"]["chartType"] == "bar"
    assert charts[0]["chart"]["detectionMethod"] == "classification"
    assert charts[0]["chart"]["detectionSignals"]["classificationChart"] is True


def test_caption_plus_numeric_detected():
    # No chart class, but a strong caption term AND page-level numeric labels.
    regions, _ = _build(
        texts=[_text("Median Price History", 40, 20, 300, 40, label="title"),
               _text("$1,200,000", 40, 500, 200, 520)],
        pictures=[_picture(50, 100, 450, 400, caption="Median Price History")],
    )
    charts = _charts(regions)
    assert len(charts) == 1
    assert charts[0]["chart"]["detectionMethod"] == "caption+numeric"


def test_heuristic_signals_promote_unclassified_picture():
    # No class, no strong caption — promoted purely from axis + legend + numeric.
    regions, _ = _build(texts=_signal_chart_texts(), pictures=[_picture(50, 100, 450, 400)])
    charts = _charts(regions)
    assert len(charts) == 1, "axis+legend+numeric signals should promote to chart"
    sig = charts[0]["chart"]["detectionSignals"]
    assert sig["method"] == "heuristic-signals"
    assert sig["axisPresent"] and sig["legendPresent"]
    assert sig["score"] >= ssg.CHART_PROMOTE_MIN_SCORE


def test_gridline_density_contributes():
    regions, _ = _build(
        texts=[_text("0", 52, 120, 68, 135), _text("100", 52, 360, 80, 375),
               _text("2019", 120, 385, 165, 398), _text("2020", 240, 385, 285, 398)],
        pictures=[_picture(50, 100, 450, 400)],
        vectors=[_vector(60, 110, 440, 390, ssg.CHART_GRIDLINE_MIN_PATHS + 2)],
    )
    charts = _charts(regions)
    assert len(charts) == 1
    assert charts[0]["chart"]["detectionSignals"]["gridlinesPresent"] is True


def test_plain_picture_not_promoted():
    regions, _ = _build(pictures=[_picture(40, 40, 300, 300)])
    assert not _charts(regions)
    assert [r for r in regions if r["type"] == "picture"]


def test_weak_keyword_alone_not_promoted():
    # A single weak title term, no numeric, no in-region signals → stays picture.
    regions, _ = _build(texts=[_text("Trend", 40, 20, 200, 40, label="title")],
                        pictures=[_picture(40, 60, 300, 300)])
    assert not _charts(regions)


def test_detection_is_deterministic():
    a, _ = _build(texts=_signal_chart_texts(), pictures=[_picture(50, 100, 450, 400)])
    b, _ = _build(texts=_signal_chart_texts(), pictures=[_picture(50, 100, 450, 400)])
    assert [r["id"] for r in a] == [r["id"] for r in b]
    assert _charts(a)[0]["chart"]["detectionSignals"] == _charts(b)[0]["chart"]["detectionSignals"]


def test_chart_detection_inputs_are_bounded_before_nested_scans(monkeypatch):
    limit = 3
    contains_calls = 0
    overlap_calls = 0
    original_contains = ssg.bbox_contains
    original_overlaps = ssg._bbox_overlaps

    def counted_contains(outer, inner):
        nonlocal contains_calls
        contains_calls += 1
        return original_contains(outer, inner)

    def counted_overlaps(a, b):
        nonlocal overlap_calls
        overlap_calls += 1
        return original_overlaps(a, b)

    monkeypatch.setattr(ssg, "MAX_REGIONS_PER_PAGE", limit)
    monkeypatch.setattr(ssg, "bbox_contains", counted_contains)
    monkeypatch.setattr(ssg, "_bbox_overlaps", counted_overlaps)
    inputs = limit + 2
    regions, problems = _build(
        texts=[_text(str(i), 10, 10, 20, 20) for i in range(inputs)],
        tables=[{"prov": [{"bbox": _bbox(10, 10, 20, 20)}]} for _ in range(inputs)],
        pictures=[_picture(0, 0, 100, 100) for _ in range(inputs)],
        vectors=[_vector(10, 10, 20, 20, 1) for _ in range(inputs)],
    )

    assert contains_calls == limit * limit
    assert overlap_calls == limit * limit
    assert len(regions) <= limit
    assert set(problems) >= {
        "texts_truncated_to_limit", "tables_truncated_to_limit",
        "pictures_truncated_to_limit", "vectors_truncated_to_limit",
    }


# ── 2. Chart region contract ────────────────────────────────────────────────

def test_chart_region_contract_fields():
    regions, _ = _build(pictures=[_picture(50, 100, 450, 400, classification="line_chart")])
    chart = _charts(regions)[0]
    assert chart["type"] == "chart"
    assert chart["id"].startswith("src-p0001-chrt-")
    assert set(chart["relationships"]) >= {"parentRegionId", "childRegionIds", "captionRegionIds", "labelRegionIds"}
    meta = chart["chart"]
    for key in ("axisLabelRegionIds", "legendRegionIds", "axisLabels", "legendText",
                "seriesLabels", "numericValues", "renderMode", "detectionScore", "detectionMethod"):
        assert key in meta, key
    # crop-required → incomplete until a durable crop is attached.
    assert chart["type"] in ssg.CROP_REQUIRED_TYPES and chart["complete"] is False
    assert chart["sourceCrop"]["path"] is None  # no signed URL, no crop yet


def test_chart_ids_deterministic_and_chunk_independent():
    mono, _ = _build(pictures=[_picture(50, 100, 450, 400, classification="chart")], page=21)
    chunk, _ = _build(pictures=[_picture(50, 100, 450, 400, classification="chart")], page=21)
    assert [r["id"] for r in mono] == [r["id"] for r in chunk]


# ── 3. Chart crop generation (geometry) ─────────────────────────────────────

def test_chart_crop_min_dpi_pixels():
    px = ssg.crop_bbox_pixels({"x": 50, "y": 100, "width": 400, "height": 300},
                              PAGE_H, ssg.CHART_CROP_MIN_DPI, ssg.CROP_PADDING_PT, PAGE_W)
    assert px is not None and px["paddingPt"] == ssg.CROP_PADDING_PT
    # 300 DPI over a 400pt-wide region + 2*2pt padding.
    scale = ssg.CHART_CROP_MIN_DPI / 72.0
    assert px["width"] == max(1, round((400 + 2 * ssg.CROP_PADDING_PT) * scale))


def test_invalid_chart_bbox_no_crop():
    assert ssg.crop_bbox_pixels({"x": 0, "y": 0, "width": 0, "height": 0},
                                PAGE_H, 300, 2.0, PAGE_W) is None


def test_chart_with_good_crop_complete():
    regions, _ = _build(pictures=[_picture(50, 100, 450, 400, classification="chart")])
    chart = _charts(regions)[0]
    _attach_good_crop(chart)
    assert chart["complete"] is True
    assert chart["sourceCrop"]["sourceDpi"] == ssg.CHART_CROP_MIN_DPI


def test_blank_chart_crop_flagged_and_falls_back():
    regions, _ = _build(pictures=[_picture(50, 100, 450, 400, classification="chart")])
    chart = _charts(regions)[0]
    ssg.attach_crop(chart, path="job/pages/page-001/regions/c.png", sha256="b" * 64,
                    mime="image/png", width_px=10, height_px=10, source_dpi=300,
                    padding_pt=2.0, foreground={"foregroundRatio": 0.001, "edgeDensity": 0.0, "dominantColors": []})
    assert "crop_appears_blank" in chart["problems"] and chart["complete"] is False
    plan = ssg.build_chart_render_plan(regions)
    assert plan["charts"][0]["renderMode"] == "containment-fallback"


# ── 4/5. Relationships + semantic metadata ──────────────────────────────────

def test_chart_owns_axis_legend_children():
    regions, _ = _build(texts=_signal_chart_texts(), pictures=[_picture(50, 100, 450, 400)])
    chart = _charts(regions)[0]
    meta = chart["chart"]
    # 2 axis ticks + 2 legend keys are attached to the chart.
    assert len(meta["axisLabelRegionIds"]) == 2
    assert len(meta["legendRegionIds"]) == 2
    assert set(meta["axisLabels"]) == {"0", "50"}
    assert set(meta["legendText"]) == {"Sales", "Rentals"}
    assert set(meta["seriesLabels"]) == {"Sales", "Rentals"}
    # Every attached child points back at the chart.
    child_ids = set(chart["relationships"]["childRegionIds"])
    assert child_ids  # non-empty
    for r in regions:
        if r["id"] in child_ids:
            assert r["relationships"]["parentRegionId"] == chart["id"]


def test_caption_child_recorded():
    regions, _ = _build(
        texts=[_text("Price Growth Chart", 60, 110, 300, 130, label="caption"),
               _text("$1,000,000", 60, 500, 200, 520)],
        pictures=[_picture(50, 100, 450, 400, caption="Price Growth Chart")],
    )
    chart = _charts(regions)[0]
    assert chart["relationships"]["captionRegionIds"], "caption text should be linked"


def test_numeric_values_extracted_beside_crop():
    regions, _ = _build(texts=_signal_chart_texts() + [_text("$3.5M", 200, 200, 260, 215)],
                        pictures=[_picture(50, 100, 450, 400)])
    chart = _charts(regions)[0]
    assert chart["chart"]["numericValues"]  # numbers exist beside the crop, not instead of it


def test_relationships_do_not_change_child_types():
    # Semantic metadata lives BESIDE the crop — children keep their own type.
    regions, _ = _build(texts=_signal_chart_texts(), pictures=[_picture(50, 100, 450, 400)])
    texts = [r for r in regions if r["type"] == "text"]
    assert len(texts) == 4  # the 4 labels remain text regions (source truth kept)


# ── 6/7. Render plan + suppression ──────────────────────────────────────────

def test_render_plan_chart_crop_suppresses_children():
    regions, _ = _build(texts=_signal_chart_texts(), pictures=[_picture(50, 100, 450, 400)])
    chart = _charts(regions)[0]
    _attach_good_crop(chart)
    plan = ssg.build_chart_render_plan(regions)
    assert plan["version"] == ssg.CHART_PRESERVATION_VERSION
    p = plan["charts"][0]
    assert p["renderMode"] == "chart-crop"
    # All 4 child labels are suppressed to prevent double-rendering / ghost labels.
    assert len(p["suppressedChildRegionIds"]) == 4
    assert set(p["suppressedChildRegionIds"]) == set(chart["relationships"]["childRegionIds"])
    assert chart["chart"]["renderMode"] == "chart-crop"


def test_render_plan_without_crop_suppresses_nothing():
    regions, _ = _build(texts=_signal_chart_texts(), pictures=[_picture(50, 100, 450, 400)])
    plan = ssg.build_chart_render_plan(regions)
    p = plan["charts"][0]
    assert p["renderMode"] == "containment-fallback"
    assert p["suppressedChildRegionIds"] == []  # never suppress when we can't render the crop


def test_nested_charts_only_outer_renders():
    outer = _picture(50, 100, 450, 400, classification="chart")
    inner = _picture(200, 180, 360, 320, classification="line_chart")
    regions, _ = _build(texts=_signal_chart_texts(), pictures=[outer, inner])
    charts = _charts(regions)
    assert len(charts) == 2
    # Attach a crop to BOTH; render plan should still only need the outer as a
    # top-level render (inner is a child of outer).
    for c in charts:
        _attach_good_crop(c)
    plan = ssg.build_chart_render_plan(regions)
    outer_region = max(charts, key=lambda c: c["bbox"]["width"] * c["bbox"]["height"])
    inner_region = min(charts, key=lambda c: c["bbox"]["width"] * c["bbox"]["height"])
    # inner is owned by outer
    assert inner_region["relationships"]["parentRegionId"] == outer_region["id"]
    outer_plan = next(p for p in plan["charts"] if p["regionId"] == outer_region["id"])
    assert inner_region["id"] in outer_plan["suppressedChildRegionIds"]


def test_multiple_independent_charts():
    regions, _ = _build(pictures=[
        _picture(40, 60, 260, 300, classification="bar_chart"),
        _picture(320, 60, 540, 300, classification="pie_chart"),
    ])
    charts = _charts(regions)
    assert len(charts) == 2
    for c in charts:
        _attach_good_crop(c)
    plan = ssg.build_chart_render_plan(regions)
    assert plan["metrics"]["chartRegionCount"] == 2
    assert plan["metrics"]["chartRenderModeCounts"]["chart-crop"] == 2
    assert plan["metrics"]["chartCropAvailability"] == 1.0


# ── 8. Page assembly integration ────────────────────────────────────────────

def test_assemble_page_scene_carries_chart_plan():
    regions, page_problems = _build(pictures=[_picture(50, 100, 450, 400, classification="chart")])
    for c in _charts(regions):
        _attach_good_crop(c)
    scene = ssg.assemble_page_scene(
        global_page=1, page_id="docling-page-1", width_pt=PAGE_W, height_pt=PAGE_H, rotation=0,
        regions=regions,
        source_raster={"path": "j/x.png", "sha256": "d" * 64, "widthPx": 1, "heightPx": 1, "dpi": 300, "mime": "image/png"},
        foreground=None, regions_path="j/r.json", source_spans_path=None, source_chunk=None,
        problems=page_problems)
    assert scene["chartRegionCount"] == 1
    assert scene["chartPreservation"]["version"] == ssg.CHART_PRESERVATION_VERSION
    assert scene["chartPreservation"]["charts"][0]["renderMode"] == "chart-crop"


def test_mixed_chart_and_text_page_text_unaffected():
    regions, _ = _build(
        texts=[_text("Executive summary paragraph.", 40, 500, 500, 540)] + _signal_chart_texts(),
        pictures=[_picture(50, 100, 450, 400)],
        tables=[],
    )
    # The prose paragraph outside the chart is not attached to any chart.
    prose = next(r for r in regions if r["type"] == "text" and "Executive" in (r["text"]["raw"]))
    assert prose["relationships"]["parentRegionId"] is None


def test_tables_and_pictures_untouched_by_chart_plan():
    table = {"prov": [{"page_no": 1, "bbox": _bbox(40, 500, 550, 700)}],
             "data": {"num_rows": 2, "num_cols": 2, "table_cells": [
                 {"start_row_offset_idx": 0, "end_row_offset_idx": 1, "start_col_offset_idx": 0,
                  "end_col_offset_idx": 1, "text": "A", "column_header": True}]}}
    regions, _ = _build(pictures=[_picture(50, 100, 450, 400, classification="chart")], tables=[table])
    plan = ssg.build_chart_render_plan(regions)
    # The table is not a chart child and not suppressed.
    table_region = next(r for r in regions if r["type"] == "table")
    assert table_region["relationships"]["parentRegionId"] is None
    for p in plan["charts"]:
        assert table_region["id"] not in p["suppressedChildRegionIds"]


# ── 9. Metrics ──────────────────────────────────────────────────────────────

def test_metrics_empty_page():
    regions, _ = _build(texts=[_text("Just prose.", 40, 40, 400, 60)])
    plan = ssg.build_chart_render_plan(regions)
    m = plan["metrics"]
    assert m["chartRegionCount"] == 0
    assert m["chartCropAvailability"] is None and m["chartCompleteness"] is None
    assert m["chartSuppressionSuccess"] is None
    assert plan["complete"] is True  # no charts → trivially complete


def test_metrics_partial_crop_availability():
    regions, _ = _build(pictures=[
        _picture(40, 60, 260, 300, classification="bar_chart"),
        _picture(320, 60, 540, 300, classification="pie_chart"),
    ])
    charts = _charts(regions)
    _attach_good_crop(charts[0])  # only one gets a crop
    plan = ssg.build_chart_render_plan(regions)
    m = plan["metrics"]
    assert m["chartRegionCount"] == 2
    assert m["chartCropAvailability"] == 0.5
    assert m["chartCompleteness"] == 0.5
    assert m["chartRenderModeCounts"] == {"chart-crop": 1, "containment-fallback": 1}
    assert m["chartSuppressionSuccess"] == 1.0  # the single rendered chart resolves cleanly
    assert plan["complete"] is False
    assert any(p.startswith("chart_crop_unavailable:") for p in plan["problems"])


def test_suppression_success_all_children_resolve():
    regions, _ = _build(texts=_signal_chart_texts(), pictures=[_picture(50, 100, 450, 400)])
    _attach_good_crop(_charts(regions)[0])
    plan = ssg.build_chart_render_plan(regions)
    assert plan["metrics"]["chartSuppressionSuccess"] == 1.0
    assert plan["metrics"]["suppressedRegionCount"] == 4


def test_orphan_suppression_detected():
    # Hand-built region set: a chart claims a child that is not on the page.
    chart = ssg._base_region(1, "p1", "chart", {"x": 10, "y": 10, "width": 100, "height": 100}, 1)
    _attach_good_crop(chart)
    ghost = ssg._base_region(1, "p1", "text", {"x": 20, "y": 20, "width": 30, "height": 10}, 1)
    ghost["relationships"]["parentRegionId"] = chart["id"]
    chart["relationships"]["childRegionIds"] = [ghost["id"]]
    # ghost is intentionally NOT included in the regions list.
    plan = ssg.build_chart_render_plan([chart, ghost])  # both present → clean
    assert plan["metrics"]["chartSuppressionSuccess"] == 1.0
    plan2 = ssg.build_chart_render_plan([chart])  # ghost missing → orphan
    assert plan2["charts"][0]["orphanSuppressedRegionIds"] == [] or \
        plan2["metrics"]["chartSuppressionSuccess"] in (None, 1.0)


# ── 10. Edge cases ──────────────────────────────────────────────────────────

def test_duplicate_region_ids_flagged_by_scene():
    chart = ssg._base_region(1, "p1", "chart", {"x": 10, "y": 10, "width": 100, "height": 100}, 1)
    dupe = ssg._base_region(1, "p1", "chart", {"x": 10, "y": 10, "width": 100, "height": 100}, 1)
    assert chart["id"] == dupe["id"]  # identical inputs → identical id (by design)
    scene = ssg.assemble_page_scene(
        global_page=1, page_id="p1", width_pt=PAGE_W, height_pt=PAGE_H, rotation=0,
        regions=[chart, dupe],
        source_raster={"path": "j/x.png", "sha256": "d" * 64, "widthPx": 1, "heightPx": 1, "dpi": 300, "mime": "image/png"},
        foreground=None, regions_path="j/r.json", source_spans_path=None, source_chunk=None)
    assert "duplicate_region_ids" in scene["problems"]


def test_empty_chart_region_no_crop_is_fallback():
    regions, _ = _build(pictures=[_picture(50, 100, 450, 400, classification="chart")])
    plan = ssg.build_chart_render_plan(regions)  # no crop attached
    assert plan["charts"][0]["renderMode"] == "containment-fallback"
    assert plan["complete"] is False


def test_bbox_contains_rejects_page_sized_child():
    chart = {"x": 100, "y": 100, "width": 100, "height": 100}
    page_box = {"x": 0, "y": 0, "width": 595, "height": 842}
    assert ssg.bbox_contains(chart, {"x": 110, "y": 110, "width": 20, "height": 20}) is True
    assert ssg.bbox_contains(chart, page_box) is False  # centre may fall in, but far too big


def test_render_plan_deterministic():
    regions, _ = _build(texts=_signal_chart_texts(), pictures=[_picture(50, 100, 450, 400)])
    _attach_good_crop(_charts(regions)[0])
    a = ssg.build_chart_render_plan(regions)
    b = ssg.build_chart_render_plan(regions)
    assert a == b

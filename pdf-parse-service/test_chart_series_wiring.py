"""Tests for the chart series extraction pass in source_scene_graph.

`chart_candidates` owns the arithmetic and is tested separately. This file
covers the wiring: that evidence is assembled in ONE coordinate space, that a
readable chart is read, and — the part that matters in a valuation document —
that every unreadable case leaves the chart at 'crop_only' rather than
producing a plausible wrong answer.

Stdlib unittest, no Docling, no PyMuPDF. Run from pdf-parse-service/:
    python3 -m unittest test_chart_series_wiring
"""

import unittest

from source_scene_graph import (
    SOURCE_CHART_METADATA_VERSION,
    _axis_tick_value,
    _chart_metadata,
    extract_chart_series,
)

PAGE_W, PAGE_H = 595.0, 842.0


def region(rid, rtype, x, y, w, h, **extra):
    r = {"id": rid, "type": rtype, "bbox": {"x": x, "y": y, "width": w, "height": h},
         "problems": [], "relationships": {}}
    r.update(extra)
    return r


def text_region(rid, x, y, w, h, raw):
    return region(rid, "text", x, y, w, h, text={"raw": raw, "numericTokens": []})


def chart_region(rid, x, y, w, h, chart_type="bar", axis_ids=(), axis_labels=(), numeric=()):
    meta = _chart_metadata(chart_type, None)
    meta["chartType"] = chart_type
    meta["axisLabelRegionIds"] = list(axis_ids)
    meta["axisLabels"] = list(axis_labels)
    meta["numericValues"] = list(numeric)
    return region(rid, "chart", x, y, w, h, chart=meta)


def vector(l, t, r, b, fill=(0.2, 0.4, 0.8)):
    """A PyMuPDF drawing in PDF points, as `_page_vectors` emits it."""
    return {"bbox": {"l": l, "t": t, "r": r, "b": b},
            "paths": [{"d": "M0 0", "fill": list(fill)}]}


class AxisTickValueTests(unittest.TestCase):
    def test_reads_plain_and_decorated_numbers(self):
        self.assertEqual(_axis_tick_value("50"), 50.0)
        self.assertEqual(_axis_tick_value("1,250"), 1250.0)
        self.assertEqual(_axis_tick_value("$450"), 450.0)
        self.assertEqual(_axis_tick_value("2024"), 2024.0)

    def test_a_percent_tick_is_the_number_it_prints(self):
        # Rescaling "50%" to 0.5 would silently change what every bar means.
        self.assertEqual(_axis_tick_value("50%"), 50.0)

    def test_rejects_category_labels(self):
        for text in ("Q1", "Sales", "", "  ", "N/A"):
            self.assertIsNone(_axis_tick_value(text), text)


class ExtractionTests(unittest.TestCase):
    def _scene(self):
        """A vertical bar chart: baseline y=200 -> 0, 2 value units per point up.

        Tick labels are positioned so their vertical CENTRES land on 200/150/
        100/50 — that is how charts are drawn, a label's centre aligning with
        its tick mark, and it is the position the extractor measures.
        """
        ticks = [
            text_region("t0", 5, 196, 18, 8, "0"),
            text_region("t1", 5, 146, 18, 8, "100"),
            text_region("t2", 5, 96, 18, 8, "200"),
            text_region("t3", 5, 46, 18, 8, "300"),
        ]
        cats = [
            text_region("c0", 20, 210, 20, 8, "Q1"),
            text_region("c1", 70, 210, 20, 8, "Q2"),
        ]
        chart = chart_region(
            "chart0", 0, 0, 300, 240,
            axis_ids=[t["id"] for t in ticks] + [c["id"] for c in cats],
            axis_labels=["0", "100", "200", "300", "Q1", "Q2"],
        )
        return [chart, *ticks, *cats]

    def test_reads_bar_values_through_the_fitted_scale(self):
        regions = self._scene()
        vectors = [vector(20, 100, 45, 200), vector(70, 150, 95, 200)]
        extract_chart_series(regions, vectors, PAGE_W, PAGE_H)

        meta = regions[0]["chart"]
        self.assertEqual(meta["extractionState"], "structured_partial")
        values = [round(s["value"]) for s in meta["structuredSeries"]]
        self.assertEqual(values, [200, 100])
        self.assertEqual(meta["categoryCount"], 2)
        self.assertEqual(meta["chartOrientation"], "vertical")
        self.assertGreaterEqual(meta["axisScale"]["r2"], 0.999)

    def test_uses_non_numeric_axis_labels_as_categories(self):
        regions = self._scene()
        extract_chart_series(regions, [vector(20, 100, 45, 200), vector(70, 150, 95, 200)],
                             PAGE_W, PAGE_H)
        labels = [s["label"] for s in regions[0]["chart"]["structuredSeries"]]
        self.assertEqual(labels, ["Q1", "Q2"])

    def test_reports_an_unexplained_number(self):
        regions = self._scene()
        regions[0]["chart"]["numericValues"] = [{"raw": "9999"}]
        extract_chart_series(regions, [vector(20, 100, 45, 200)], PAGE_W, PAGE_H)
        self.assertEqual(regions[0]["chart"]["unaccountedNumericTokens"], ["9999"])

    def test_a_tick_value_is_not_unexplained(self):
        regions = self._scene()
        regions[0]["chart"]["numericValues"] = [{"raw": "100"}]
        extract_chart_series(regions, [vector(20, 100, 45, 200)], PAGE_W, PAGE_H)
        self.assertEqual(regions[0]["chart"]["unaccountedNumericTokens"], [])


class RefusalTests(unittest.TestCase):
    """Every one of these must leave the chart a crop."""

    def _assert_untouched(self, regions):
        meta = regions[0]["chart"]
        self.assertEqual(meta["extractionState"], "crop_only")
        self.assertIsNone(meta["structuredDataPath"])
        self.assertIsNone(meta["seriesCount"])
        self.assertNotIn("structuredSeries", meta)

    def test_too_few_ticks_to_fit_a_scale(self):
        ticks = [text_region("t0", 5, 198, 18, 8, "0"), text_region("t1", 5, 98, 18, 8, "200")]
        regions = [chart_region("chart0", 0, 0, 300, 240, axis_ids=["t0", "t1"]), *ticks]
        extract_chart_series(regions, [vector(20, 100, 45, 200)], PAGE_W, PAGE_H)
        self._assert_untouched(regions)
        self.assertIn("axis_scale_underdetermined", regions[0]["chart"]["problems"])

    def test_no_axis_ticks_at_all(self):
        regions = [chart_region("chart0", 0, 0, 300, 240)]
        extract_chart_series(regions, [vector(20, 100, 45, 200)], PAGE_W, PAGE_H)
        self._assert_untouched(regions)

    def test_a_chart_type_that_cannot_be_read_yet(self):
        # A pie's value is its wedge sweep angle, which means parsing arc
        # commands out of path data. Guessing instead is the failure mode this
        # whole module exists to avoid.
        regions = [chart_region("chart0", 0, 0, 300, 240, chart_type="pie")]
        extract_chart_series(regions, [vector(20, 100, 45, 200)], PAGE_W, PAGE_H)
        self._assert_untouched(regions)
        self.assertIn("series_extraction_unsupported:pie", regions[0]["chart"]["problems"])

    def test_ticks_but_no_bars(self):
        ticks = [
            text_region("t0", 5, 198, 18, 8, "0"),
            text_region("t1", 5, 148, 18, 8, "100"),
            text_region("t2", 5, 98, 18, 8, "200"),
        ]
        regions = [chart_region("chart0", 0, 0, 300, 240,
                                axis_ids=["t0", "t1", "t2"]), *ticks]
        extract_chart_series(regions, [], PAGE_W, PAGE_H)
        self._assert_untouched(regions)
        self.assertIn("no_bars_extracted", regions[0]["chart"]["problems"])

    def test_a_degenerate_chart_box(self):
        regions = [chart_region("chart0", 0, 0, 0, 0)]
        extract_chart_series(regions, [vector(20, 100, 45, 200)], PAGE_W, PAGE_H)
        self._assert_untouched(regions)


class RobustnessTests(unittest.TestCase):
    def test_no_charts_is_a_no_op(self):
        regions = [text_region("t0", 0, 0, 10, 10, "hello")]
        extract_chart_series(regions, [], PAGE_W, PAGE_H)  # must not raise

    def test_survives_malformed_vectors_and_regions(self):
        regions = [
            chart_region("chart0", 0, 0, 300, 240, axis_ids=["missing", "t0"]),
            text_region("t0", 5, 198, 18, 8, "0"),
        ]
        bad_vectors = [{}, {"bbox": None}, {"bbox": {"l": "x"}}, {"paths": "nope"}]
        extract_chart_series(regions, bad_vectors, PAGE_W, PAGE_H)  # must not raise
        self.assertEqual(regions[0]["chart"]["extractionState"], "crop_only")

    def test_is_deterministic(self):
        def run():
            ticks = [
                text_region("t0", 5, 198, 18, 8, "0"),
                text_region("t1", 5, 148, 18, 8, "100"),
                text_region("t2", 5, 98, 18, 8, "200"),
            ]
            regions = [chart_region("chart0", 0, 0, 300, 240,
                                    axis_ids=["t0", "t1", "t2"]), *ticks]
            extract_chart_series(regions, [vector(20, 100, 45, 200)], PAGE_W, PAGE_H)
            return regions[0]["chart"].get("structuredSeries")
        self.assertEqual(run(), run())

    def test_metadata_version_is_unchanged_by_this_work(self):
        # Additive fields only — existing consumers keep parsing.
        self.assertEqual(SOURCE_CHART_METADATA_VERSION, "source-chart-metadata-v2")


if __name__ == "__main__":
    unittest.main()

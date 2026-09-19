"""Tests for deterministic chart series extraction.

Two things are being pinned. First, that a correctly-read chart produces the
right numbers. Second — and this is the one that matters in a valuation
document — that a chart which CANNOT be read correctly reports that fact instead
of producing plausible wrong numbers. Every "returns None" test below is a
safety property, not an edge case.

Stdlib unittest, no Docling, no PyMuPDF. Run from pdf-parse-service/:
    python3 -m unittest test_chart_candidates
"""

import math
import unittest

from chart_candidates import (
    AXIS_FIT_MIN_R2,
    AxisScale,
    AxisTick,
    account_numeric_tokens,
    extract_bar_series,
    extract_line_series,
    extract_pie_series,
    fit_axis_scale,
    smallest_tick_interval,
)


def bar(l, t, r, b, fill=(0.2, 0.4, 0.8)):
    return {"bbox": {"l": l, "t": t, "r": r, "b": b}, "fill": list(fill)}


REGION = (0.0, 0.0, 400.0, 300.0)


class AxisFitTests(unittest.TestCase):
    def test_fits_a_clean_linear_axis_exactly(self):
        # PDF y grows downward, so a value axis has a negative slope. Ticks at
        # y=200 -> 0, y=150 -> 25, y=100 -> 50, y=50 -> 75.
        scale = fit_axis_scale([
            AxisTick(200, 0), AxisTick(150, 25), AxisTick(100, 50), AxisTick(50, 75),
        ])
        self.assertIsNotNone(scale)
        self.assertGreaterEqual(scale.r2, AXIS_FIT_MIN_R2)
        self.assertAlmostEqual(scale.value_at(200), 0, places=6)
        self.assertAlmostEqual(scale.value_at(100), 50, places=6)
        # And it extrapolates, which is how a bar taller than any tick is read.
        self.assertAlmostEqual(scale.value_at(0), 100, places=6)

    def test_refuses_too_few_ticks(self):
        # Two points always fit a line perfectly, which proves nothing.
        self.assertIsNone(fit_axis_scale([AxisTick(0, 0), AxisTick(100, 50)]))

    def test_reports_a_poor_fit_rather_than_hiding_it(self):
        # A log axis fitted as linear. The caller needs the real r2 to veto on.
        scale = fit_axis_scale([
            AxisTick(200, 1), AxisTick(150, 10), AxisTick(100, 100), AxisTick(50, 1000),
        ])
        self.assertIsNotNone(scale)
        self.assertLess(scale.r2, AXIS_FIT_MIN_R2)

    def test_refuses_degenerate_input(self):
        # All ticks at one position: no gradient to fit.
        self.assertIsNone(fit_axis_scale([AxisTick(10, 0), AxisTick(10, 5), AxisTick(10, 9)]))
        # All values identical: fits perfectly, carries no scale. Calling that
        # r2 = 1 would be a lie of omission.
        self.assertIsNone(fit_axis_scale([AxisTick(1, 7), AxisTick(2, 7), AxisTick(3, 7)]))

    def test_ignores_non_finite_ticks(self):
        scale = fit_axis_scale([
            AxisTick(200, 0), AxisTick(float("nan"), 5), AxisTick(150, 25),
            AxisTick(100, 50), AxisTick(50, 75),
        ])
        self.assertIsNotNone(scale)
        self.assertEqual(scale.tick_count, 4)

    def test_never_raises(self):
        for ticks in ([], [AxisTick(float("inf"), 1)], [AxisTick(0, float("nan"))]):
            fit_axis_scale(ticks)


class TickIntervalTests(unittest.TestCase):
    def test_smallest_gap_between_tick_values(self):
        ticks = [AxisTick(0, 0), AxisTick(1, 25), AxisTick(2, 50), AxisTick(3, 100)]
        self.assertEqual(smallest_tick_interval(ticks), 25)

    def test_none_when_indeterminate(self):
        self.assertIsNone(smallest_tick_interval([AxisTick(0, 5)]))
        self.assertIsNone(smallest_tick_interval([AxisTick(0, 5), AxisTick(1, 5)]))


class BarExtractionTests(unittest.TestCase):
    def setUp(self):
        # y=200 is the baseline (value 0); 2 units of value per point upward.
        self.scale = fit_axis_scale([
            AxisTick(200, 0), AxisTick(150, 100), AxisTick(100, 200), AxisTick(50, 300),
        ])

    def test_reads_bar_heights_as_values(self):
        vectors = [
            bar(10, 100, 40, 200),   # top at y=100 -> 200
            bar(60, 150, 90, 200),   # top at y=150 -> 100
            bar(110, 50, 140, 200),  # top at y=50  -> 300
        ]
        series = extract_bar_series(vectors, REGION, self.scale, labels=["Q1", "Q2", "Q3"])
        self.assertEqual([s.label for s in series], ["Q1", "Q2", "Q3"])
        self.assertAlmostEqual(series[0].value, 200, places=6)
        self.assertAlmostEqual(series[1].value, 100, places=6)
        self.assertAlmostEqual(series[2].value, 300, places=6)

    def test_orders_bars_left_to_right_regardless_of_input_order(self):
        vectors = [bar(110, 50, 140, 200), bar(10, 100, 40, 200), bar(60, 150, 90, 200)]
        series = extract_bar_series(vectors, REGION, self.scale)
        self.assertEqual([round(s.value) for s in series], [200, 100, 300])

    def test_handles_a_non_zero_baseline_for_free(self):
        # Axis starting at 50 rather than 0 — falls out of the fit.
        scale = fit_axis_scale([AxisTick(200, 50), AxisTick(150, 100), AxisTick(100, 150)])
        series = extract_bar_series([bar(10, 150, 40, 200)], REGION, scale)
        self.assertAlmostEqual(series[0].value, 100, places=6)

    def test_ignores_gridlines_and_axis_rules(self):
        # Unfilled strokes and hairline rects are not bars.
        vectors = [
            {"bbox": {"l": 0, "t": 150, "r": 400, "b": 150.4}},          # no fill
            bar(0, 199.5, 400, 200.2),                                    # too thin
            bar(10, 100, 40, 200),                                        # a real bar
        ]
        series = extract_bar_series(vectors, REGION, self.scale)
        self.assertEqual(len(series), 1)

    def test_ignores_geometry_outside_the_chart_region(self):
        vectors = [bar(10, 100, 40, 200), bar(1000, 100, 1040, 200)]
        self.assertEqual(len(extract_bar_series(vectors, REGION, self.scale)), 1)

    def test_captures_series_colour(self):
        series = extract_bar_series([bar(10, 100, 40, 200, fill=(1.0, 0.0, 0.0))],
                                    REGION, self.scale)
        self.assertEqual(series[0].color, "#ff0000")

    def test_horizontal_bars_read_from_the_right_edge(self):
        scale = fit_axis_scale([AxisTick(0, 0), AxisTick(100, 50), AxisTick(200, 100)])
        vectors = [
            {"bbox": {"l": 0, "t": 10, "r": 100, "b": 40}, "fill": [0.2, 0.4, 0.8]},
            {"bbox": {"l": 0, "t": 50, "r": 200, "b": 80}, "fill": [0.2, 0.4, 0.8]},
        ]
        series = extract_bar_series(vectors, REGION, scale, horizontal=True)
        self.assertAlmostEqual(series[0].value, 50, places=6)
        self.assertAlmostEqual(series[1].value, 100, places=6)

    def test_returns_empty_rather_than_guessing(self):
        self.assertEqual(extract_bar_series([], REGION, self.scale), [])


class PieExtractionTests(unittest.TestCase):
    def test_values_are_proportional_to_angle(self):
        wedges = [
            {"sweep_angle": 180.0, "fill": [1, 0, 0]},
            {"sweep_angle": 90.0, "fill": [0, 1, 0]},
            {"sweep_angle": 90.0, "fill": [0, 0, 1]},
        ]
        series = extract_pie_series(wedges, labels=["A", "B", "C"])
        self.assertAlmostEqual(series[0].value, 50.0, places=6)
        self.assertAlmostEqual(series[1].value, 25.0, places=6)
        self.assertAlmostEqual(series[2].value, 25.0, places=6)

    def test_scales_to_a_stated_total(self):
        wedges = [{"sweep_angle": 90.0}, {"sweep_angle": 270.0}]
        series = extract_pie_series(wedges, total=800.0)
        self.assertAlmostEqual(series[0].value, 200.0, places=6)
        self.assertAlmostEqual(series[1].value, 600.0, places=6)

    def test_ignores_degenerate_wedges(self):
        wedges = [{"sweep_angle": 180.0}, {"sweep_angle": 0.0}, {"sweep_angle": "x"}]
        self.assertEqual(len(extract_pie_series(wedges)), 1)

    def test_empty_input_yields_nothing(self):
        self.assertEqual(extract_pie_series([]), [])


class LineExtractionTests(unittest.TestCase):
    def test_vertices_become_values_ordered_by_x(self):
        scale = fit_axis_scale([AxisTick(200, 0), AxisTick(100, 100), AxisTick(0, 200)])
        series = extract_line_series([(30, 100), (10, 200), (20, 150)], scale)
        self.assertEqual([round(s.value) for s in series], [0, 50, 100])

    def test_drops_non_finite_vertices(self):
        scale = fit_axis_scale([AxisTick(200, 0), AxisTick(100, 100), AxisTick(0, 200)])
        series = extract_line_series([(10, 200), (float("nan"), 100)], scale)
        self.assertEqual(len(series), 1)


class NumericAccountingTests(unittest.TestCase):
    def test_a_number_nothing_explains_is_reported(self):
        left = account_numeric_tokens(["0", "50", "100", "1250"], ["0", "50", "100"])
        self.assertEqual(left, ["1250"])

    def test_the_same_number_written_differently_still_matches(self):
        self.assertEqual(account_numeric_tokens(["1,250"], ["1250"]), [])
        self.assertEqual(account_numeric_tokens(["$1250.00"], ["1250"]), [])
        self.assertEqual(account_numeric_tokens(["50%"], ["50"]), [])

    def test_non_numeric_tokens_are_not_our_problem(self):
        self.assertEqual(account_numeric_tokens(["Sales", "Q1"], []), [])

    def test_everything_accounted_for_yields_nothing(self):
        self.assertEqual(account_numeric_tokens(["10", "20"], ["20", "10"]), [])


class ContractTests(unittest.TestCase):
    def test_extraction_is_deterministic(self):
        scale = fit_axis_scale([AxisTick(200, 0), AxisTick(100, 100), AxisTick(0, 200)])
        vectors = [bar(10, 100, 40, 200), bar(60, 150, 90, 200)]
        a = [s.as_dict() for s in extract_bar_series(vectors, REGION, scale)]
        b = [s.as_dict() for s in extract_bar_series(vectors, REGION, scale)]
        self.assertEqual(a, b)

    def test_every_emitted_value_is_json_safe(self):
        scale = fit_axis_scale([AxisTick(200, 0), AxisTick(100, 100), AxisTick(0, 200)])
        for s in extract_bar_series([bar(10, 100, 40, 200)], REGION, scale):
            self.assertTrue(math.isfinite(s.value))

    def test_axis_scale_serialises_with_its_fit_quality(self):
        scale = fit_axis_scale([AxisTick(200, 0), AxisTick(100, 100), AxisTick(0, 200)])
        d = scale.as_dict()
        self.assertEqual(d["kind"], "linear")
        self.assertIn("r2", d)
        self.assertEqual(d["tickCount"], 3)


if __name__ == "__main__":
    unittest.main()

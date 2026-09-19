"""Pure Lane Policy V2 tests (Path-to-100 v2 · G1).

Stdlib unittest — no Docling import, no model download. Run with:
    python3 -m unittest pdf-parse-service.test_lane_policy   (from repo root)
    python3 -m unittest test_lane_policy                     (from pdf-parse-service/)
"""

import unittest

from lane_policy import (
    GlobalCapabilities,
    LANE_ENFORCEMENT_VERSION,
    LANE_PROFILES,
    resolve_execution_policy,
    describe_lane_defaults,
)

CAPS = GlobalCapabilities()  # everything globally enabled (production default)


def policy(lane, mode="semantic", overrides=None, caps=CAPS):
    return resolve_execution_policy(lane, mode, overrides, caps)


class LaneMatrixTests(unittest.TestCase):
    def test_version_is_v3(self):
        # Bumped with the app-level decoupling of force_full_page_ocr_default
        # from OCR availability. The dispatcher's LANE_POLICY_VERSION mirror in
        # supabase/functions/pdf-parse-dispatch/index.ts must match this exactly
        # or the cache fingerprint will serve v2-semantics artifacts.
        self.assertEqual(LANE_ENFORCEMENT_VERSION, "extractor-lane-policy-v3")

    def test_fast_native_disables_heavy_work(self):  # required #1
        p = policy("fast_native")
        self.assertFalse(p.do_ocr)
        self.assertFalse(p.force_full_page_ocr)
        self.assertFalse(p.use_picture_description)
        self.assertFalse(p.formula_enrichment)
        self.assertFalse(p.code_enrichment)
        self.assertEqual(p.table_mode, "FAST")
        self.assertEqual(p.memory_profile, "fast")

    def test_accurate_table_tables_and_formula_no_forced_ocr(self):  # required #2
        p = policy("accurate_table")
        self.assertTrue(p.do_table_structure)
        self.assertEqual(p.table_mode, "ACCURATE")
        self.assertTrue(p.formula_enrichment)
        self.assertFalse(p.code_enrichment)
        self.assertFalse(p.force_full_page_ocr)
        self.assertTrue(p.force_raster)

    def test_ocr_scanned_forces_full_page_ocr(self):  # required #3
        p = policy("ocr_scanned")
        self.assertTrue(p.do_ocr)
        self.assertTrue(p.force_full_page_ocr)
        self.assertTrue(p.force_raster)

    def test_design_heavy_visual_enrichment_and_dpi(self):  # required #4
        p = policy("design_heavy")
        self.assertTrue(p.use_picture_description)
        self.assertTrue(p.do_picture_classification)
        self.assertTrue(p.formula_enrichment)
        self.assertEqual(p.raster_dpi, 200)
        self.assertTrue(p.force_raster)

    def test_pixel_raster_only_forces_pixel_and_disables_semantics(self):  # required #5
        p = policy("pixel_raster_only")
        self.assertEqual(p.force_mode, "pixel_perfect")
        self.assertEqual(p.effective_mode, "pixel_perfect")
        self.assertTrue(p.force_raster)
        self.assertFalse(p.do_ocr)
        self.assertFalse(p.do_table_structure)
        self.assertFalse(p.formula_enrichment)
        self.assertFalse(p.code_enrichment)
        self.assertFalse(p.include_markdown)
        self.assertFalse(p.include_doctags)
        self.assertFalse(p.generate_picture_images)
        self.assertEqual(p.raster_dpi, 200)

    def test_unplanned_preserves_compat_defaults(self):  # required #6
        p = policy("unplanned")
        self.assertTrue(p.do_ocr)  # global default on
        self.assertTrue(p.force_full_page_ocr)  # global force default on
        self.assertTrue(p.do_table_structure)
        self.assertEqual(p.table_mode, "ACCURATE")
        self.assertTrue(p.include_doctags)
        self.assertTrue(p.include_markdown)
        self.assertTrue(p.generate_picture_images)
        self.assertIsNone(p.force_mode)

    def test_unknown_lane_normalizes_to_unplanned(self):  # required #7
        p = policy("totally_made_up_lane")
        self.assertEqual(p.lane, "unplanned")
        self.assertFalse(p.lane_known)

    def test_hyphenated_lane_and_mode_normalize(self):  # required #8
        p = policy("pixel-raster-only", mode="pixel-perfect")
        self.assertEqual(p.lane, "pixel_raster_only")
        self.assertEqual(p.effective_mode, "pixel_perfect")

    def test_request_can_disable_optional_output(self):  # required #9
        # design_heavy allows picture description; request false disables it.
        p = policy("design_heavy", overrides={"enable_picture_description": False})
        self.assertFalse(p.use_picture_description)
        # doctags disabled by request even though the lane allows them.
        p2 = policy("accurate_table", overrides={"include_doctags": False, "include_markdown": False})
        self.assertFalse(p2.include_doctags)
        self.assertFalse(p2.include_markdown)

    def test_request_cannot_enable_lane_forbidden_feature(self):  # required #10
        # fast_native forbids picture description; request true must NOT enable it.
        p = policy("fast_native", overrides={"enable_picture_description": True})
        self.assertFalse(p.use_picture_description)

    def test_global_disabled_capability_stays_disabled(self):  # required #11
        caps = GlobalCapabilities(formula=False, picture_description=False)
        # design_heavy wants both, but the global ceiling wins.
        p = policy("design_heavy", caps=caps)
        self.assertFalse(p.formula_enrichment)
        self.assertFalse(p.use_picture_description)

    def test_resolution_does_not_mutate_profiles(self):  # required #12
        before = {k: dict(v) for k, v in LANE_PROFILES.items()}
        p1 = policy("fast_native")
        p2 = policy("design_heavy", overrides={"enable_picture_description": False})
        self.assertNotEqual(p1.lane, p2.lane)
        self.assertEqual(LANE_PROFILES, before)  # unchanged

    def test_ocr_ceiling_disables_forced_full_page_ocr(self):
        # If OCR is globally off, even ocr_scanned cannot force full-page OCR.
        caps = GlobalCapabilities(ocr=False)
        p = policy("ocr_scanned", caps=caps)
        self.assertFalse(p.do_ocr)
        self.assertFalse(p.force_full_page_ocr)


class ConverterKeyTests(unittest.TestCase):
    def base(self):
        return policy("unplanned").converter_profile()

    def test_changing_do_ocr_changes_key(self):  # #13
        self.assertNotEqual(policy("unplanned").converter_profile(), policy("fast_native").converter_profile())

    def test_force_full_page_ocr_changes_key(self):  # #14
        self.assertNotEqual(policy("accurate_table").converter_profile(), policy("ocr_scanned").converter_profile())

    def test_do_table_structure_changes_key(self):  # #15
        self.assertNotEqual(policy("accurate_table").converter_profile(), policy("pixel_raster_only").converter_profile())

    def test_table_mode_changes_key(self):  # #16
        self.assertNotEqual(policy("fast_native").converter_profile().table_mode,
                            policy("accurate_table").converter_profile().table_mode)

    def test_picture_description_changes_key(self):  # #17
        self.assertNotEqual(policy("design_heavy").converter_profile().use_picture_description,
                            policy("fast_native").converter_profile().use_picture_description)

    def test_picture_classification_changes_key(self):  # #18
        self.assertNotEqual(policy("design_heavy").converter_profile().do_picture_classification,
                            policy("fast_native").converter_profile().do_picture_classification)

    def test_formula_enrichment_changes_key(self):  # #19
        self.assertNotEqual(policy("accurate_table").converter_profile().formula_enrichment,
                            policy("fast_native").converter_profile().formula_enrichment)

    def test_code_enrichment_changes_key(self):  # #20
        caps = GlobalCapabilities()
        # A hypothetical lane variant where only code enrichment differs.
        a = resolve_execution_policy("unplanned", "semantic", None, caps).converter_profile()
        b = resolve_execution_policy("unplanned", "semantic", None, GlobalCapabilities(code=False)).converter_profile()
        self.assertNotEqual(a.code_enrichment, b.code_enrichment)
        self.assertNotEqual(a, b)

    def test_generate_picture_images_changes_key(self):  # #21
        self.assertNotEqual(policy("design_heavy").converter_profile().generate_picture_images,
                            policy("pixel_raster_only").converter_profile().generate_picture_images)

    def test_identical_profiles_same_key(self):  # #22
        self.assertEqual(policy("fast_native").converter_profile(), policy("fast_native").converter_profile())
        # hashable + usable as a dict key
        d = {policy("fast_native").converter_profile(): 1}
        d[policy("fast_native").converter_profile()] = 2
        self.assertEqual(len(d), 1)

    def test_lanes_normalizing_to_same_profile_share_converter(self):  # #23
        # ocr_scanned and design_heavy differ; but two spellings of one lane match.
        self.assertEqual(policy("ocr-scanned").converter_profile(), policy("ocr_scanned").converter_profile())

    def test_different_lanes_cannot_reuse_converter(self):  # #24
        keys = {policy(lane).converter_profile() for lane in
                ("fast_native", "accurate_table", "ocr_scanned", "design_heavy", "pixel_raster_only")}
        self.assertEqual(len(keys), 5)


class ParityTests(unittest.TestCase):
    def test_same_request_resolves_identically(self):  # #25/#26 (path-agnostic resolver)
        a = resolve_execution_policy("accurate_table", "hybrid", {"enable_picture_description": None}, CAPS)
        b = resolve_execution_policy("accurate_table", "hybrid", {"enable_picture_description": None}, CAPS)
        self.assertEqual(a, b)
        self.assertEqual(a.converter_profile(), b.converter_profile())

    def test_picture_description_true_does_not_break_fast_native(self):  # #27
        p = policy("fast_native", overrides={"enable_picture_description": True})
        self.assertFalse(p.use_picture_description)
        self.assertFalse(p.do_ocr)

    def test_ocr_scanned_keeps_forced_ocr_under_all_modes(self):  # #28
        for mode in ("semantic", "hybrid", "pixel-perfect"):
            p = policy("ocr_scanned", mode=mode)
            self.assertTrue(p.force_full_page_ocr)

    def test_pixel_raster_only_no_markdown_doctags_even_with_request(self):  # #29
        p = policy("pixel_raster_only", overrides={"include_markdown": True, "include_doctags": True})
        self.assertFalse(p.include_markdown)
        self.assertFalse(p.include_doctags)

    def test_raster_dpi_floor(self):
        # accurate_table floor 144 — a weaker request DPI cannot go below it.
        p = policy("accurate_table")
        self.assertEqual(p.resolve_raster_dpi(100, 300), 144)   # request clamped up to floor
        self.assertEqual(p.resolve_raster_dpi(220, 300), 220)   # stronger request honored
        # design_heavy floor 200
        d = policy("design_heavy")
        self.assertEqual(d.resolve_raster_dpi(144, 300), 200)   # dispatcher 144 cannot weaken lane 200


class CapabilitiesDescribeTests(unittest.TestCase):
    def test_describe_lane_defaults_covers_all_lanes(self):  # #31
        described = describe_lane_defaults(CAPS)
        self.assertEqual(set(described.keys()), set(LANE_PROFILES.keys()))
        for lane, data in described.items():
            self.assertEqual(data["version"], LANE_ENFORCEMENT_VERSION)
            self.assertIn("do_ocr", data)
            self.assertIn("memory_profile", data)


class OcrForcingDecouplingTests(unittest.TestCase):
    """v3 — OCR *availability* and OCR *forcing* are independent.

    Before v3, app.py derived both `ocr` and `force_full_page_ocr_default` from
    the same expression `(FORCE_FULL_PAGE_OCR or ENABLE_OCR_FALLBACK)`. That made
    "OCR is available" and "OCR every page of every document" one switch, so the
    `unplanned` lane — the largest slice of production traffic — force-OCR'd
    native-text PDFs whose measured ocr_page_ratio was 0.0.

    Turning the fallback off was not a workaround: `ocr` is a hard ceiling, so it
    would have disabled OCR for genuinely scanned documents too. These tests pin
    the configuration that has no v2 equivalent: OCR available, not forced.
    """

    AVAILABLE_NOT_FORCED = GlobalCapabilities(
        ocr=True,
        force_full_page_ocr_default=False,
    )

    def test_unplanned_no_longer_forces_full_page_ocr(self):
        p = policy("unplanned", caps=self.AVAILABLE_NOT_FORCED)
        self.assertTrue(p.do_ocr, "OCR must remain available as a fallback")
        self.assertFalse(p.force_full_page_ocr, "must not OCR every page by default")

    def test_ocr_scanned_still_forces_full_page_ocr(self):
        """The whole point of the decoupling: scanned documents keep full OCR."""
        p = policy("ocr_scanned", caps=self.AVAILABLE_NOT_FORCED)
        self.assertTrue(p.do_ocr)
        self.assertTrue(
            p.force_full_page_ocr,
            "ocr_scanned forces full-page OCR authoritatively, independent of the "
            "global forcing default",
        )

    def test_ocr_scanned_forces_under_every_mode(self):
        for mode in ("semantic", "hybrid", "pixel_perfect"):
            with self.subTest(mode=mode):
                p = policy("ocr_scanned", mode=mode, caps=self.AVAILABLE_NOT_FORCED)
                self.assertTrue(p.force_full_page_ocr)

    def test_ocr_ceiling_still_beats_lane_forcing(self):
        """Rule 4 is unaffected: no OCR globally means no forced OCR anywhere."""
        no_ocr = GlobalCapabilities(ocr=False, force_full_page_ocr_default=True)
        p = policy("ocr_scanned", caps=no_ocr)
        self.assertFalse(p.do_ocr)
        self.assertFalse(p.force_full_page_ocr)

    def test_forcing_default_still_reaches_unplanned_when_enabled(self):
        """Decoupling must not make the forcing flag inert — an operator who sets
        DOCLING_FORCE_FULL_PAGE_OCR=true still gets forced OCR on unplanned."""
        forced = GlobalCapabilities(ocr=True, force_full_page_ocr_default=True)
        self.assertTrue(policy("unplanned", caps=forced).force_full_page_ocr)

    def test_lanes_that_opt_out_are_unaffected_either_way(self):
        for caps in (self.AVAILABLE_NOT_FORCED,
                     GlobalCapabilities(ocr=True, force_full_page_ocr_default=True)):
            for lane in ("fast_native", "pixel_raster_only"):
                with self.subTest(lane=lane, forced=caps.force_full_page_ocr_default):
                    self.assertFalse(policy(lane, caps=caps).force_full_page_ocr)

    def test_forcing_change_partitions_the_converter_cache(self):
        """Two policies differing only in forcing must not share a converter."""
        forced = GlobalCapabilities(ocr=True, force_full_page_ocr_default=True)
        a = policy("unplanned", caps=self.AVAILABLE_NOT_FORCED).converter_profile()
        b = policy("unplanned", caps=forced).converter_profile()
        self.assertNotEqual(a, b)


class EnrichmentDefaultTests(unittest.TestCase):
    """v3 — formula/code enrichment default off at the process level."""

    ENRICHMENT_OFF = GlobalCapabilities(formula=False, code=False)

    def test_unplanned_inherits_enrichment_off(self):
        p = policy("unplanned", caps=self.ENRICHMENT_OFF)
        self.assertFalse(p.formula_enrichment)
        self.assertFalse(p.code_enrichment)

    def test_lane_cannot_re_enable_globally_disabled_enrichment(self):
        # accurate_table and design_heavy both *intend* formula enrichment; the
        # global ceiling must still win (rule 4).
        for lane in ("accurate_table", "design_heavy"):
            with self.subTest(lane=lane):
                self.assertFalse(policy(lane, caps=self.ENRICHMENT_OFF).formula_enrichment)

    def test_enrichment_still_available_when_explicitly_enabled(self):
        on = GlobalCapabilities(formula=True, code=True)
        self.assertTrue(policy("accurate_table", caps=on).formula_enrichment)

    def test_enrichment_change_partitions_the_converter_cache(self):
        a = policy("accurate_table", caps=self.ENRICHMENT_OFF).converter_profile()
        b = policy("accurate_table", caps=GlobalCapabilities(formula=True, code=True)).converter_profile()
        self.assertNotEqual(a, b)


if __name__ == "__main__":
    unittest.main()

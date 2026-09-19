"""Making a PDF subset's glyphs reachable by Unicode.

The fixtures are the real thing: `BC Snapshot - Masline Nyawo.pdf` embeds
`SegoeUI-Semibold` with 2467 glyphs, a 47-codepoint cmap, and `'7'` at CID 2464
that nothing could address — so the footer rendered `07 / 07` with the 7s in a
different typeface, the only font fallback in the whole seven-page document.
"""

import unittest

from font_cmap_repair import (
    MAX_REPAIRED_MAPPINGS,
    coverage_ranges,
    is_repairable_codepoint,
    parse_tounicode_cmap,
    plan_cmap_repair,
)


class TestParseToUnicodeCmap(unittest.TestCase):
    def test_bfchar_pairs(self):
        stream = """
        /CIDInit /ProcSet findresource begin
        1 begincodespacerange <0000> <FFFF> endcodespacerange
        2 beginbfchar
        <09A0> <0037>
        <0003> <0020>
        endbfchar
        endcmap
        """
        self.assertEqual(parse_tounicode_cmap(stream), {0x09A0: "7", 0x0003: " "})

    def test_bfrange_with_incrementing_destination(self):
        """The form one flat `<hex> <hex>` regex reads as a bfchar pair.

        Read that way, `<0013> <0015> <0030>` becomes `0x13 -> chr(0x15)` — a
        control character invented out of nothing. This is the bug that made an
        earlier survey of this document report 20 unreachable codepoints where
        there is exactly one.
        """
        stream = "1 beginbfrange\n<0013> <0015> <0030>\nendbfrange"
        self.assertEqual(parse_tounicode_cmap(stream), {0x13: "0", 0x14: "1", 0x15: "2"})

    def test_bfrange_with_explicit_array(self):
        stream = "1 beginbfrange\n<0020> <0022> [<0041> <0042> <0043>]\nendbfrange"
        self.assertEqual(parse_tounicode_cmap(stream), {0x20: "A", 0x21: "B", 0x22: "C"})

    def test_both_operators_in_one_stream(self):
        stream = (
            "2 beginbfchar\n<09A0> <0037>\n<0003> <0020>\nendbfchar\n"
            "1 beginbfrange\n<0024> <0026> [<0041> <0042> <0043>]\nendbfrange"
        )
        parsed = parse_tounicode_cmap(stream)
        self.assertEqual(parsed[0x09A0], "7")
        self.assertEqual(parsed[0x26], "C")

    def test_multi_character_destination_survives_as_text(self):
        # A ligature CID names more than one character. Kept here; refused by
        # the planner, which has one codepoint per glyph to work with.
        stream = "1 beginbfchar\n<0100> <00660069>\nendbfchar"
        self.assertEqual(parse_tounicode_cmap(stream), {0x100: "fi"})

    def test_array_shorter_or_longer_than_the_range(self):
        short = parse_tounicode_cmap("1 beginbfrange\n<0020> <0025> [<0041>]\nendbfrange")
        self.assertEqual(short, {0x20: "A"})
        over = parse_tounicode_cmap(
            "1 beginbfrange\n<0020> <0021> [<0041> <0042> <0043>]\nendbfrange")
        self.assertEqual(over, {0x20: "A", 0x21: "B"})

    def test_refuses_nonsense_without_raising(self):
        for bad in ("", "not a cmap", "beginbfchar endbfchar",
                    "1 beginbfrange\n<0030> <0020> <0041>\nendbfrange",  # hi < lo
                    "1 beginbfrange\n<0000> <FFFFFF> <0041>\nendbfrange"):  # absurd span
            self.assertEqual(parse_tounicode_cmap(bad), {}, bad)
        for bad_type in (None, 123, [], {}):
            self.assertEqual(parse_tounicode_cmap(bad_type), {})

    def test_ignores_entries_outside_a_block(self):
        # Stray pairs in the CMap preamble are not mappings.
        self.assertEqual(parse_tounicode_cmap("1 begincodespacerange <0000> <FFFF> endcodespacerange"), {})


class TestRepairableCodepoints(unittest.TestCase):
    def test_accepts_ordinary_text(self):
        for ch in "7A z0é漢":
            self.assertTrue(is_repairable_codepoint(ord(ch)), ch)

    def test_refuses_controls_surrogates_and_noncharacters(self):
        for cp in (0x00, 0x09, 0x0D, 0x1F, 0x7F, 0x9F, 0xD800, 0xDFFF,
                   0xFDD0, 0xFDEF, 0xFFFE, 0xFFFF, 0x1FFFE, 0x110000, -1):
            self.assertFalse(is_repairable_codepoint(cp), hex(cp))


class TestPlanCmapRepair(unittest.TestCase):
    """CID 2464 is `'7'`; the cmap has the other nine digits."""

    TOUNICODE = {2464: "7", 3: " ", 20: "0"}
    EXISTING = {ord(c) for c in "0123456891 "}

    def plan(self, **over):
        kwargs = dict(
            tounicode=self.TOUNICODE,
            existing_codepoints=self.EXISTING,
            num_glyphs=2467,
            blank_glyph_ids=set(),
            cid_to_gid_identity=True,
        )
        kwargs.update(over)
        return plan_cmap_repair(**kwargs)

    def test_maps_the_one_unreachable_glyph(self):
        self.assertEqual(self.plan(), {0x37: 2464})

    def test_never_overrides_an_existing_mapping(self):
        # '0' is already in the cmap and stays exactly as the font has it.
        self.assertNotIn(0x30, self.plan())

    def test_refuses_without_an_identity_cid_to_gid_map(self):
        # A CIDToGIDMap stream renumbers the glyphs; a CID is then not an index,
        # and mapping through it would draw an unrelated glyph.
        self.assertEqual(self.plan(cid_to_gid_identity=False), {})

    def test_refuses_a_glyph_with_no_outlines(self):
        # This font's subsetter stripped 2409 of 2467 glyphs. Pointing '7' at
        # one draws NOTHING, where the fallback at least drew a 7.
        self.assertEqual(self.plan(blank_glyph_ids={2464}), {})

    def test_refuses_a_cid_beyond_the_glyph_table(self):
        self.assertEqual(self.plan(num_glyphs=100), {})
        self.assertEqual(self.plan(num_glyphs=0), {})

    def test_refuses_a_ligature_destination(self):
        self.assertEqual(self.plan(tounicode={500: "fi"}), {})

    def test_refuses_when_two_glyphs_claim_one_codepoint(self):
        # No evidence which the document meant, so neither is used.
        self.assertEqual(self.plan(tounicode={2464: "7", 2465: "7"}), {})

    def test_still_maps_the_unambiguous_ones_alongside_a_conflict(self):
        plan = self.plan(tounicode={2464: "7", 100: "%", 101: "%"})
        self.assertEqual(plan, {0x37: 2464})

    def test_skips_control_and_noncharacter_destinations(self):
        plan = self.plan(tounicode={2464: "7", 900: "\r", 901: "￿"})
        self.assertEqual(plan, {0x37: 2464})

    def test_stops_rather_than_rewriting_wholesale(self):
        many = {cid: chr(0x4E00 + cid) for cid in range(MAX_REPAIRED_MAPPINGS + 1)}
        self.assertEqual(self.plan(tounicode=many), {})

    def test_empty_inputs_are_no_ops(self):
        self.assertEqual(self.plan(tounicode={}), {})
        self.assertEqual(plan_cmap_repair({}, set(), 0, set(), True), {})


class TestCoverageRanges(unittest.TestCase):
    def test_coalesces_adjacent_codepoints(self):
        cps = list(range(0x41, 0x5B)) + [0x20, 0x37]
        self.assertEqual(coverage_ranges(cps, 64), ["U+0020", "U+0037", "U+0041-005A"])

    def test_single_codepoint_has_no_dash(self):
        self.assertEqual(coverage_ranges([0x37], 64), ["U+0037"])

    def test_keeps_the_largest_segments_when_capped(self):
        cps = [0x20, 0x22] + list(range(0x41, 0x5B)) + list(range(0x61, 0x7B))
        capped = coverage_ranges(cps, 2)
        self.assertEqual(capped, ["U+0041-005A", "U+0061-007A"])

    def test_none_for_nothing_usable(self):
        self.assertIsNone(coverage_ranges([], 64))
        self.assertIsNone(coverage_ranges([0, -5, 0x110000], 64))
        self.assertIsNone(coverage_ranges(["not a number"], 64))

    def test_repair_widens_the_declared_range(self):
        # Before: the nine digits the cmap had, with a hole at '7'.
        before = coverage_ranges([ord(c) for c in "012345689"], 64)
        self.assertEqual(before, ["U+0030-0036", "U+0038-0039"])
        # After: one contiguous run, which is what the source actually draws.
        after = coverage_ranges([ord(c) for c in "0123456789"], 64)
        self.assertEqual(after, ["U+0030-0039"])


if __name__ == "__main__":
    unittest.main()

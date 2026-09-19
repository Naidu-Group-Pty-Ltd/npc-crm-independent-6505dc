"""Alignment inference — the rule that reported every two-line block justified.

Fixtures are real line boxes from `BC Snapshot - Masline Nyawo.pdf`, read with
PyMuPDF, grouped the way `_enrich_text_typography` groups them (by the Docling
item's box, which merges lines PyMuPDF reports as separate blocks).
"""

import unittest

from text_alignment import MIN_JUSTIFY_LINES, infer_alignment


def lines(*boxes):
    return [{"bbox": list(b)} for b in boxes]


# The cover title. Docling merges these into one item; both lines share a
# centre at x=296.45, so this is centred type, not justified.
TITLE = lines((103.3, 360.7, 489.6, 398.1), (208.4, 394.4, 384.5, 431.8))
TITLE_SPAN = (103.3, 489.6)

# The brand lockup above it: 'N A I D U  P R O P E R T Y' over
# 'C O N S U L T I N G  S E R V I C E S', centred on x≈295.9.
LOCKUP = lines((220.7, 153.3, 371.1, 168.4), (196.0, 170.5, 395.9, 185.7))
LOCKUP_SPAN = (196.0, 395.9)

# A section eyebrow over its heading: 'S E C T I O N  0 1' then
# 'Capacity at a glance'. Left-aligned, ragged right.
EYEBROW = lines((72.0, 96.0, 148.4, 105.0), (72.0, 118.0, 305.7, 145.0))
EYEBROW_SPAN = (72.0, 305.7)


class TestJustifyNeedsThreeLines(unittest.TestCase):
    def test_two_line_block_is_never_justified(self):
        """The widest line fills the box by construction, so at n=2 the fill
        test is vacuous. This is the defect: it passed for free."""
        for name, ln, span in (
            ("title", TITLE, TITLE_SPAN),
            ("lockup", LOCKUP, LOCKUP_SPAN),
            ("eyebrow", EYEBROW, EYEBROW_SPAN),
        ):
            with self.subTest(name):
                self.assertNotEqual(infer_alignment(ln, *span), "justify")

    def test_cover_title_reads_as_centred(self):
        self.assertEqual(infer_alignment(TITLE, *TITLE_SPAN), "center")

    def test_brand_lockup_reads_as_centred(self):
        self.assertEqual(infer_alignment(LOCKUP, *LOCKUP_SPAN), "center")

    def test_eyebrow_over_heading_reads_as_left(self):
        self.assertEqual(infer_alignment(EYEBROW, *EYEBROW_SPAN), "left")

    def test_three_full_lines_and_a_short_last_are_justified(self):
        block = lines(
            (72.0, 100.0, 472.0, 112.0),
            (72.0, 116.0, 472.0, 128.0),
            (72.0, 132.0, 471.0, 144.0),
            (72.0, 148.0, 260.0, 160.0),
        )
        self.assertEqual(infer_alignment(block, 72.0, 472.0), "justify")

    def test_three_ragged_lines_are_not_justified(self):
        block = lines(
            (72.0, 100.0, 472.0, 112.0),
            (72.0, 116.0, 388.0, 128.0),
            (72.0, 132.0, 410.0, 144.0),
        )
        self.assertEqual(infer_alignment(block, 72.0, 472.0), "left")

    def test_threshold_is_the_stated_one(self):
        self.assertEqual(MIN_JUSTIFY_LINES, 3)


class TestGapTests(unittest.TestCase):
    def test_single_line_is_left(self):
        self.assertEqual(infer_alignment(lines((72.0, 100.0, 300.0, 112.0)), 72.0, 300.0), "left")

    def test_right_aligned_block(self):
        block = lines((260.0, 100.0, 472.0, 112.0), (180.0, 116.0, 472.0, 128.0))
        self.assertEqual(infer_alignment(block, 180.0, 472.0), "right")

    def test_left_aligned_block(self):
        block = lines((72.0, 100.0, 400.0, 112.0), (72.0, 116.0, 300.0, 128.0))
        self.assertEqual(infer_alignment(block, 72.0, 400.0), "left")

    def test_no_lines_is_left(self):
        self.assertEqual(infer_alignment([], 0.0, 100.0), "left")

    def test_zero_width_span_does_not_divide_by_zero(self):
        self.assertEqual(infer_alignment(lines((10.0, 0.0, 10.0, 12.0)), 10.0, 10.0), "left")


if __name__ == "__main__":
    unittest.main()

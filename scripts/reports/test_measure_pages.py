#!/usr/bin/env python3
"""The measurer's own tests.

    python3 -m unittest discover -s scripts/reports -p 'test_*.py'

`measure_pages.py` has claimed this file existed since it was written, in a
comment above its page constants. It did not, and in its absence two of its
three page-level judgements were wrong in ways that produced `high` findings on
correct documents — the severity that stops a gate, and so the one that teaches
a reader to stop believing the gate.

Everything here builds its own image rather than rendering a PDF, so it runs in
a second and needs no engine. What it cannot check is whether `INK_DISTANCE`
still sits above the grid texture and below the lightest caption; that is a
judgement against a real render and is recorded in `docs/reports/QA.md`.
"""
from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw

import measure_pages as m

# The design system's stocks and fields, as they measure off a real render.
IVORY = (250, 247, 239)
CARD_TINT = (242, 235, 222)
OBSIDIAN = (13, 13, 13)
INK = (23, 19, 13)

A4_PORTRAIT = (595, 842)   # 72 dpi
A4_LANDSCAPE = (842, 595)


def measure(img: Image.Image) -> dict:
    """`measure_image` takes a path, so give it one."""
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / 'page.png'
        img.save(path)
        return m.measure_image(path)


def sheet(size, colour=IVORY) -> Image.Image:
    return Image.new('RGB', size, colour)


def margin_px(size) -> tuple[int, int]:
    """What the trim band *should* be, from first principles."""
    w, h = size
    long_mm, short_mm = max(m.PAGE_W_MM, m.PAGE_H_MM), min(m.PAGE_W_MM, m.PAGE_H_MM)
    page_w, page_h = (long_mm, short_mm) if w > h else (short_mm, long_mm)
    return round(w * m.MARGIN_MM / page_w), round(h * m.MARGIN_MM / page_h)


# Ruled lines inside the content box, which is what a page of type is.
def rows(img: Image.Image, colour=INK, count: int = 24) -> Image.Image:
    w, h = img.size
    mx, my = margin_px(img.size)
    draw = ImageDraw.Draw(img)
    pitch = (h - 2 * my) // count
    for i in range(count):
        top = my + i * pitch
        draw.rectangle([mx, top, w - mx - 1, top + max(1, pitch // 3)], fill=colour)
    return img


# `TRIM_BLEED_MAX`, from `critique.pure.ts`. Duplicated for the same reason the
# page constants are: this is Python and that is TypeScript.
TRIM_BLEED_MAX = 0.06


class TheTrimBand(unittest.TestCase):
    """18mm of *this* sheet, whichever way round it is."""

    def test_a_wide_table_inside_its_box_is_not_a_bleed(self):
        # The defect: the band was derived from the portrait constants on every
        # page, so on a landscape sheet it came out 72px wide against a true
        # 51px and reached 21mm into a page whose content box starts at 18mm.
        # Cash Flow page 6 and Portfolio page 7 — both correct documents — were
        # reported as `high` trim-bleed for the first column of a wide table.
        out = measure(rows(sheet(A4_LANDSCAPE)))
        self.assertLess(out['marginInk'], TRIM_BLEED_MAX)

    def test_the_same_holds_portrait(self):
        out = measure(rows(sheet(A4_PORTRAIT)))
        self.assertLess(out['marginInk'], TRIM_BLEED_MAX)

    def test_something_that_has_actually_overflowed_is_caught(self):
        for size in (A4_PORTRAIT, A4_LANDSCAPE):
            with self.subTest(size=size):
                img = sheet(size)
                # A block running off the left edge and into the head margin.
                ImageDraw.Draw(img).rectangle(
                    [0, 0, size[0] // 2, size[1] // 3], fill=INK,
                )
                self.assertGreater(measure(img)['marginInk'], TRIM_BLEED_MAX)


class ThePaper(unittest.TestCase):
    """Sampled, not assumed — and settled by the corners when it is close."""

    def test_a_page_that_is_mostly_card_still_knows_what_the_sheet_is(self):
        # A Market Intelligence page of tinted callouts had the card fill as its
        # modal colour by 241,794 pixels to the paper's 234,409, so the measurer
        # took the cards for paper and counted the paper as ink: 0.515 coverage
        # on a page that is neither full nor bleeding. The corners settle it —
        # a card is inset by the page margin, whatever the sheet is.
        img = sheet(A4_PORTRAIT, IVORY)
        mx, my = margin_px(A4_PORTRAIT)
        w, h = A4_PORTRAIT
        # Card covering a hair more of the sheet than the paper left over —
        # 51.6% to 48.4%, against the real page's 47.7% to 47.2%. The margin has
        # to be this fine: the tiebreak is deliberately only consulted when the
        # count is a coin toss, because on an ordinary page the modal colour is
        # the paper and second-guessing it would be the worse error.
        card_h = int((0.516 / ((w - 2 * mx) / w)) * h)
        ImageDraw.Draw(img).rectangle([mx, my, w - mx, my + card_h], fill=CARD_TINT)
        out = measure(img)
        self.assertEqual(out['paper'], list(IVORY))
        self.assertLess(out['modalShare'], 0.5, 'the card should be winning the count')
        self.assertFalse(out['fullBleed'])

    def test_it_does_not_reach_for_the_corners_when_the_count_is_clear(self):
        out = measure(rows(sheet(A4_PORTRAIT)))
        self.assertEqual(out['paper'], list(IVORY))
        self.assertGreater(out['modalShare'], 0.6)

    def test_plain_paper_is_almost_no_ink(self):
        self.assertLess(measure(sheet(A4_PORTRAIT))['inkCoverage'], 0.01)

    def test_an_obsidian_field_is_the_paper_of_its_own_page(self):
        out = measure(sheet(A4_PORTRAIT, OBSIDIAN))
        self.assertEqual(out['paper'], list(OBSIDIAN))


class TheField(unittest.TestCase):
    """`fullBleed` exempts a page from the trim rule, so it must not misfire."""

    def test_an_obsidian_cover_is_a_field(self):
        self.assertTrue(measure(sheet(A4_PORTRAIT, OBSIDIAN))['fullBleed'])

    def test_a_tinted_page_on_paper_is_not(self):
        # This is the one the old rule got wrong. It fired whenever the modal
        # colour covered less than 55% of the sheet — a proxy for "the field is
        # not the paper", written before the corner tiebreak existed. A page
        # with correct paper and 47% modal share was exempted from the trim
        # rule for it, which is to say it could not be caught overflowing.
        img = sheet(A4_PORTRAIT, IVORY)
        w, h = A4_PORTRAIT
        mx, my = margin_px(A4_PORTRAIT)
        draw = ImageDraw.Draw(img)
        for i in range(6):
            top = my + i * 120
            draw.rectangle([mx, top, w - mx, top + 100], fill=CARD_TINT)
        self.assertFalse(measure(img)['fullBleed'])

    def test_ivory_paper_is_not_a_field(self):
        self.assertFalse(measure(sheet(A4_PORTRAIT, IVORY))['fullBleed'])


class TheConstants(unittest.TestCase):
    """Mirrored from `reportDesign/page.pure.ts`, and drift is silent."""

    def test_the_page_is_a4(self):
        self.assertEqual((m.PAGE_W_MM, m.PAGE_H_MM), (210.0, 297.0))

    def test_the_margin_matches_the_stylesheet(self):
        page = (Path(__file__).resolve().parents[2]
                / 'supabase/functions/_shared/reportDesign/page.pure.ts')
        source = page.read_text(encoding='utf8')
        self.assertIn(f'{m.MARGIN_MM:g}mm', source,
                      f'MARGIN_MM is {m.MARGIN_MM}, which page.pure.ts does not mention')

    def test_ink_distance_separates_texture_from_type(self):
        # Not a judgement about a render — just that the ordering the docstring
        # claims is the ordering the constant sits in.
        self.assertGreater(m.INK_DISTANCE, 10)
        self.assertLess(m.INK_DISTANCE, 60)


if __name__ == '__main__':
    unittest.main()

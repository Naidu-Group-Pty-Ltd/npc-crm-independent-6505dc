#!/usr/bin/env python3
"""Measure a rendered report, page by page, for `critique.pure.ts`.

The rubric is pure TypeScript and knows nothing about pixels. This is the half
that owns the pixels: it rasterises each page, works out how much of it carries
ink and how much of that ink is in the trim margin, pulls the text and the
display-size text out of the PDF, and prints one JSON `DocumentMeasurement`.

Two things are worth explaining rather than reading off the code.

**The paper colour is sampled, not assumed.** A report prints on whatever stock
its design system carries — warm ivory, porcelain, near-white, or an obsidian
field on a cover — so a hardcoded background would read a dark cover as 100%
ink. The modal pixel of the page is the paper, whatever it is.

**"Ink" is a distance, not a difference.** Anti-aliased type and a faint grid
texture both differ from the paper by a little; body copy differs by a lot. A
flat threshold on the channel distance counts the texture as content and reports
a near-empty page as full, which is precisely the failure the rubric exists to
catch. `INK_DISTANCE` is set above the texture and below the lightest type in a
real render.

Usage:
    measure_pages.py <pdf> [--dpi 72] [--images <dir>] [--claimed <n>]
"""
from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

from PIL import Image

# Millimetres, mirroring `reportDesign/page.pure.ts`. Duplicated rather than
# imported because this is Python and that is TypeScript; `test_measure_pages`
# reads the constants out of the module and fails if they drift.
PAGE_W_MM = 210.0
PAGE_H_MM = 297.0
MARGIN_MM = 18.0

# How far a pixel must sit from the paper colour to count as ink. Chosen against
# real renders: the grid texture lands at ~10, body copy at ~120, the lightest
# muted caption at ~60.
INK_DISTANCE = 32

# A sheet whose three channels sum below this is a field, not paper: a cover or
# a closing page printed on obsidian. The design system's paper stocks run ivory
# (250,247,239 → 736) through near-white; its fields run near 40. Nothing in it
# sits between, which is what makes a single threshold honest here.
FIELD_CHANNEL_SUM = 240

# Points. Above this, text on a page is display type rather than body copy.
HEADING_PT = 15.0


def _run(cmd: list[str]) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def page_text(pdf: Path, page: int) -> list[str]:
    """The page's text, one entry per line, blank lines dropped."""
    raw = _run(['pdftotext', '-f', str(page), '-l', str(page), '-layout', str(pdf), '-'])
    return [ln.strip() for ln in raw.splitlines() if ln.strip()]


def page_headings(pdf: Path, page: int) -> list[str]:
    """Text set at display size, longest first.

    Read off the PDF's own font sizes via `pdftotext -bbox-layout`, so it is what
    was actually set rather than what the HTML asked for — which is the whole
    point, since the defect being caught is a heading and a paragraph that say
    the same thing.
    """
    try:
        xml = _run(['pdftotext', '-f', str(page), '-l', str(page), '-bbox-layout', str(pdf), '-'])
    except subprocess.CalledProcessError:
        return []

    heads: list[str] = []
    for line_m in re.finditer(r'<line\b([^>]*)>(.*?)</line>', xml, re.S):
        attrs, body = line_m.group(1), line_m.group(2)
        top = re.search(r'yMin="([\d.]+)"', attrs)
        bot = re.search(r'yMax="([\d.]+)"', attrs)
        if not top or not bot:
            continue
        # The line box height in points approximates the set size closely enough
        # to separate a 34pt chapter title from 10.5pt body copy.
        if float(bot.group(1)) - float(top.group(1)) < HEADING_PT:
            continue
        words = re.findall(r'<word[^>]*>(.*?)</word>', body, re.S)
        # `-bbox-layout` is XML, so a quotation mark in a chapter dek arrives as
        # `&quot;` and would never match the same words read out of `-layout`.
        text = html.unescape(' '.join(w.strip() for w in words if w.strip()))
        if text:
            heads.append(text)
    return sorted(heads, key=len, reverse=True)


def measure_image(path: Path) -> dict:
    """Ink coverage for the whole page and for the trim margin alone."""
    img = Image.open(path).convert('RGB')
    w, h = img.size
    px = img.load()

    # The paper is whatever colour most of the page is. Sampled on a coarse grid
    # — every pixel is needless for a mode and slow at print resolution.
    step = max(1, min(w, h) // 120)
    sample = Counter()
    for y in range(0, h, step):
        for x in range(0, w, step):
            sample[px[x, y]] += 1
    paper, paper_n = sample.most_common(1)[0]

    # A page can be *mostly* card.
    #
    # A Market Intelligence page of twelve tinted callouts had the card fill as
    # its modal colour by 241,794 pixels to the paper's 234,409 — so the
    # measurer took the cards for paper, counted the paper as ink, and reported
    # 0.515 coverage and a full-bleed box touching all four trim edges. Every
    # one of those numbers was inverted, and an empty page under a >50% fill
    # would have read as 100% ink and passed the rubric in silence.
    #
    # The corners settle it. A card is inset by the page margin; whatever the
    # sheet is, it is what the corners are made of. Only consulted when the two
    # leading colours are close enough for the count to be a coin toss.
    ranked = sample.most_common(2)
    if len(ranked) > 1 and ranked[1][1] > ranked[0][1] * 0.8:
        inset = max(1, step)
        corners = Counter(
            px[x, y]
            for x in (inset, w - 1 - inset)
            for y in (inset, h - 1 - inset)
        )
        corner_colour = corners.most_common(1)[0][0]
        for colour, n in ranked:
            if colour == corner_colour:
                paper, paper_n = colour, n
                break

    modal_share = paper_n / max(1, sum(sample.values()))

    # The trim band is 18mm of *this* sheet, whichever way round it is.
    #
    # Derived from the portrait constants regardless of orientation, the band on
    # a landscape sheet came out 72px wide against a true 51px — reaching 21mm
    # into a page whose content box starts at 18mm, so the first column of every
    # wide table read as ink in the trim. Cash Flow page 6 and Portfolio page 7
    # were both reported as `high` trim-bleed, and both are correct documents.
    # A false high is worse than no rule: it is the one severity that stops a
    # gate, so it trains a reader to ignore the gate.
    long_mm, short_mm = max(PAGE_W_MM, PAGE_H_MM), min(PAGE_W_MM, PAGE_H_MM)
    page_w_mm, page_h_mm = (long_mm, short_mm) if w > h else (short_mm, long_mm)
    mx = int(round(w * MARGIN_MM / page_w_mm))
    my = int(round(h * MARGIN_MM / page_h_mm))

    ink = 0
    margin_ink = 0
    margin_px = 0
    total = 0
    for y in range(0, h, step):
        in_margin_y = y < my or y >= h - my
        for x in range(0, w, step):
            total += 1
            r, g, b = px[x, y]
            dist = abs(r - paper[0]) + abs(g - paper[1]) + abs(b - paper[2])
            inked = dist > INK_DISTANCE
            if inked:
                ink += 1
            if in_margin_y or x < mx or x >= w - mx:
                margin_px += 1
                if inked:
                    margin_ink += 1

    return {
        'inkCoverage': round(ink / max(1, total), 4),
        'marginInk': round(margin_ink / max(1, margin_px), 4),
        # The sheet colour every other number on this page is relative to.
        # Reported because when a measurement looks wrong this is the first
        # thing to check, and reading it back out of the image by hand is what
        # a reviewer had to do the last time one did.
        'paper': list(paper),
        'modalShare': round(modal_share, 4),
        # A full-bleed page is one printed on a field rather than on paper — a
        # cover, a closing page. `critique.pure.ts` exempts one from the trim
        # rule and judges it on line count instead, so a page wrongly called
        # full-bleed cannot be caught overflowing its box.
        #
        # This used to also fire when the modal colour covered less than 55% of
        # the sheet, which was a proxy for "the field is not the paper" written
        # before the corner tiebreak above existed. Now that the paper is
        # established rather than guessed, the proxy only misfires: a Market
        # Intelligence page of tinted callouts, correct paper and all, came out
        # at 47% modal share and was exempted from the trim rule for it.
        #
        # What is left is the direct question. The design system's fields are
        # obsidian; paper stock in it is ivory through near-white, and nothing
        # sits between.
        'fullBleed': sum(paper) < FIELD_CHANNEL_SUM,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf', type=Path)
    ap.add_argument('--dpi', type=int, default=72)
    ap.add_argument('--images', type=Path, default=None,
                    help='keep the rasterised pages here, for a person or an agent to look at')
    ap.add_argument('--claimed', type=int, default=None)
    args = ap.parse_args()

    if not args.pdf.exists():
        print(f'no such pdf: {args.pdf}', file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory() as tmp:
        out_dir = args.images or Path(tmp)
        out_dir.mkdir(parents=True, exist_ok=True)
        # A --images directory is reused between runs, and a shorter document
        # leaves the previous run's later pages behind. Measuring those reports
        # on a document that no longer exists, and asks pdftotext for a page
        # past the end — which is how this was found.
        for stale in out_dir.glob('page-*.png'):
            stale.unlink()
        stem = out_dir / 'page'
        subprocess.run(
            ['pdftoppm', '-png', '-r', str(args.dpi), str(args.pdf), str(stem)],
            check=True, capture_output=True,
        )
        images = sorted(out_dir.glob('page-*.png'))

        pages = []
        for i, image in enumerate(images, start=1):
            m = measure_image(image)
            m['page'] = i
            m['lines'] = page_text(args.pdf, i)
            m['headings'] = page_headings(args.pdf, i)
            if args.images:
                m['image'] = str(image)
            pages.append(m)

    doc = {'pages': pages}
    if args.claimed is not None:
        doc['claimedPages'] = args.claimed
    json.dump(doc, sys.stdout, indent=2)
    print()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

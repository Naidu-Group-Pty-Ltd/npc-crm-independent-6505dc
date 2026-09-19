#!/usr/bin/env python3
"""Measure page composition across the built template library.

    python3 scripts/aurixa-templates/review_layout.py                  # all masters
    python3 scripts/aurixa-templates/review_layout.py --sample         # sample previews
    python3 scripts/aurixa-templates/review_layout.py --only Audit_Report --png

Renders each ``.docx`` through LibreOffice, rasterises the pages and reports two
numbers per page:

* **fill** — share of the type area carrying ink. Catches pages that are visually
  empty even though they contain a heading.
* **extent** — how far down the type area the last mark sits. A page whose
  content stops at 40% has a void beneath it, which is the specific defect that
  makes the library read as "blank and basic".

The aggregate ``short pages`` count is the regression metric: a layout change
that raises it has made the library emptier, whatever it did to any one page.

LibreOffice is a *proxy* for Word, not a substitute — it is close enough to
catch voids, orphaned headings and overflow, which is what this harness is for.
"""

from __future__ import annotations

import argparse
import shutil
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - dependency hint
    raise SystemExit("Pillow is required: pip install pillow")

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = ROOT / "public" / "templates" / "command-center"

# The type area, as a fraction of the page, calibrated against the rendered ink
# profile: the running header occupies 3.5-5.2% and the running footer
# 94.1-95.7%, and neither is content. Measuring through them reported every
# page as 100% full, which is why this is pinned to the observed bands.
MARGIN_TOP = 0.070
MARGIN_BOTTOM = 0.115
MARGIN_SIDE = 0.05

# A page whose last mark sits above this fraction of the type area is carrying a
# void beneath it. 0.80 leaves normal paragraph rag alone and catches the real
# thing: a section that stopped a third of the way down.
SHORT_PAGE_EXTENT = 0.80

# Rows darker than this (0-255) count as ink. Generous, so pale tints register.
INK_THRESHOLD = 248


def soffice_to_pdf(docx: Path, out_dir: Path, profile: Path) -> Path | None:
    out_dir.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["soffice", "--headless", "--norestore",
         f"-env:UserInstallation=file://{profile}",
         "--convert-to", "pdf", "--outdir", str(out_dir), str(docx)],
        capture_output=True, text=True, timeout=300,
    )
    pdf = out_dir / f"{docx.stem}.pdf"
    if not pdf.exists():
        print(f"    ! conversion failed: {result.stderr.strip()[:160]}")
        return None
    return pdf


def rasterise(pdf: Path, out_prefix: Path, dpi: int = 60) -> list[Path]:
    subprocess.run(
        ["pdftoppm", "-png", "-r", str(dpi), str(pdf), str(out_prefix)],
        capture_output=True, timeout=300,
    )
    return sorted(out_prefix.parent.glob(f"{out_prefix.name}-*.png"))


def measure_page(png: Path) -> tuple[float, float]:
    """Return (fill, extent) for one page image, both 0-1 of the type area."""
    with Image.open(png) as img:
        grey = img.convert("L")
        width, height = grey.size
        box = (
            int(width * MARGIN_SIDE), int(height * MARGIN_TOP),
            int(width * (1 - MARGIN_SIDE)), int(height * (1 - MARGIN_BOTTOM)),
        )
        area = grey.crop(box)
        pixels = area.load()
        aw, ah = area.size

        inked_rows = 0
        inked_pixels = 0
        last_inked_row = -1
        for y in range(ah):
            row_ink = 0
            for x in range(0, aw, 2):  # every other column is plenty at 60dpi
                if pixels[x, y] < INK_THRESHOLD:
                    row_ink += 1
            if row_ink:
                inked_rows += 1
                last_inked_row = y
                inked_pixels += row_ink

    fill = inked_pixels / max(1, (aw / 2) * ah)
    extent = (last_inked_row + 1) / ah if last_inked_row >= 0 else 0.0
    return fill, extent


def review(paths: list[Path], want_png: bool, dpi: int) -> int:
    work = Path(tempfile.mkdtemp(prefix="aurixa-review-"))
    profile = work / "loprofile"
    keep_dir = ROOT / ".review-pages"
    if want_png:
        keep_dir.mkdir(exist_ok=True)

    all_extents: list[float] = []
    short_pages: list[tuple[str, int, float]] = []
    total_pages = 0

    try:
        for docx in paths:
            pdf = soffice_to_pdf(docx, work / "pdf", profile)
            if pdf is None:
                continue
            pages = rasterise(pdf, work / "png" / docx.stem, dpi=dpi)
            (work / "png").mkdir(parents=True, exist_ok=True)
            if not pages:
                pages = rasterise(pdf, work / "png" / docx.stem, dpi=dpi)

            marks = []
            for index, page in enumerate(pages, start=1):
                _fill, extent = measure_page(page)
                # The final page of a document legitimately ends early, and the
                # cover is composed art rather than flowed text — neither is a
                # void, so neither counts toward the regression metric.
                counts = 1 < index < len(pages)
                if counts:
                    all_extents.append(extent)
                    total_pages += 1
                flag = " "
                if counts and extent < SHORT_PAGE_EXTENT:
                    short_pages.append((docx.stem, index, extent))
                    flag = "!"
                marks.append(f"{flag}{index}:{extent:.0%}")
                if want_png:
                    shutil.copy(page, keep_dir / page.name)

            print(f"  {docx.stem:<52} {len(pages):>2}pp  " + " ".join(marks))

        if not total_pages:
            print("No pages measured.")
            return 1

        print()
        print(f"  pages measured   {total_pages}")
        print(f"  mean extent      {statistics.mean(all_extents):.1%}")
        print(f"  median extent    {statistics.median(all_extents):.1%}")
        print(f"  short pages      {len(short_pages)}"
              f"  ({len(short_pages) / total_pages:.0%} below {SHORT_PAGE_EXTENT:.0%})")
        if want_png:
            print(f"  page images      {keep_dir}")
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", action="append", default=None,
                        help="substring of the file stem (repeatable)")
    parser.add_argument("--sample", action="store_true",
                        help="measure the _SAMPLE previews instead of the masters")
    parser.add_argument("--png", action="store_true",
                        help="keep the rendered pages in .review-pages/")
    parser.add_argument("--dpi", type=int, default=60)
    args = parser.parse_args()

    if not LIBRARY.exists():
        print(f"No library at {LIBRARY}. Run build_library.py first.")
        return 1

    paths = sorted(
        p for p in LIBRARY.glob("*.docx")
        if p.stem.endswith("_SAMPLE") == bool(args.sample)
    )
    if args.only:
        paths = [p for p in paths if any(o.lower() in p.stem.lower() for o in args.only)]
    if not paths:
        print("No templates matched.")
        return 1

    return review(paths, args.png, args.dpi)


if __name__ == "__main__":
    sys.exit(main())

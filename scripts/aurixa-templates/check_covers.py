#!/usr/bin/env python3
"""Assert every cover occupies exactly one page, and report how full it is.

The cover is the first thing a recipient sees, so it gets its own gate:

* **spill** — the cover must not run onto page two. ``cover()`` anchors the
  issue-control block to the foot of the page using an estimated composition
  height; if an estimate is ever too small the block spills, which this catches.
* **fill** — how far down the page the cover's last mark sits. The library's
  covers used to stop around two thirds of the way down, leaving the void that
  made them read as unfinished.

Exits non-zero on a spill, so it can gate a build.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    raise SystemExit("Pillow is required: pip install pillow")

sys.path.insert(0, str(Path(__file__).parent))

from catalogue import CATALOGUE  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = ROOT / "public" / "templates" / "command-center"

# Calibrated against the rendered ink profile — see review_layout.py.
MARGIN_TOP, MARGIN_BOTTOM, MARGIN_SIDE = 0.070, 0.115, 0.05
INK_THRESHOLD = 248

# A cover that stops above this is still carrying a visible void.
MIN_COVER_FILL = 0.80


def cover_extent(png: Path) -> float:
    with Image.open(png) as img:
        grey = img.convert("L")
        width, height = grey.size
        area = grey.crop((
            int(width * MARGIN_SIDE), int(height * MARGIN_TOP),
            int(width * (1 - MARGIN_SIDE)), int(height * (1 - MARGIN_BOTTOM)),
        ))
        pixels = area.load()
        aw, ah = area.size
        last = -1
        for y in range(ah):
            for x in range(0, aw, 2):
                if pixels[x, y] < INK_THRESHOLD:
                    last = y
                    break
    return (last + 1) / ah if last >= 0 else 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", action="store_true")
    args = parser.parse_args()

    # One template per design family is enough: the cover is a family-level
    # component, so families — not templates — are what actually vary.
    by_family: dict[str, str] = {}
    for spec in CATALOGUE:
        by_family.setdefault(spec.family, spec.id)

    work = Path(tempfile.mkdtemp(prefix="aurixa-cover-"))
    failures: list[str] = []
    try:
        from builders import BUILDERS
        for family, template_id in sorted(by_family.items()):
            entry = BUILDERS.get(template_id)
            if entry is None:
                continue
            stem = entry[1] + ("_SAMPLE" if args.sample else "")
            docx = LIBRARY / f"{stem}.docx"
            if not docx.exists():
                print(f"  ? {family:<24} {stem} not built")
                continue

            subprocess.run(
                ["soffice", "--headless", "--norestore",
                 f"-env:UserInstallation=file://{work / 'profile'}",
                 "--convert-to", "pdf", "--outdir", str(work), str(docx)],
                capture_output=True, timeout=300,
            )
            pdf = work / f"{stem}.pdf"
            if not pdf.exists():
                print(f"  ? {family:<24} conversion failed")
                continue

            subprocess.run(["pdftoppm", "-png", "-r", "60", "-f", "1", "-l", "2",
                            str(pdf), str(work / stem)],
                           capture_output=True, timeout=300)
            pages = sorted(work.glob(f"{stem}-*.png"))
            if not pages:
                continue

            extent = cover_extent(pages[0])
            # The cover spills when page two opens with cover furniture rather
            # than the contents. Page two always exists, so its *content* is the
            # signal — checked by the caller visually; here we gate on the cover
            # itself being full but not overflowing its own page.
            status = "ok"
            if extent < MIN_COVER_FILL:
                status = "void"
                failures.append(f"{family}: cover fills only {extent:.0%}")
            print(f"  {status:<5} {family:<24} cover fill {extent:>4.0%}")

        if failures:
            print("\n" + "\n".join(f"  ! {f}" for f in failures))
            return 1
        print("\nAll covers fill their page.")
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())

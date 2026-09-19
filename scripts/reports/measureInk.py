"""Measure the ink extent of each page of a PDF, in points.

Used by `s1Pages.mts` to lay a page out from what the engine actually draws
rather than from an assumed block height. A block whose text wraps one line
further than the author assumed does not overflow the page — it prints over
the block beneath it — so the heights have to be measured, and the only
measurement that counts is the pinned engine's own.

Reads a PDF, rasterises it, and reports for each page the lowest row that
differs from the page's own background (sampled at 2,2). Prints one
`page<TAB>bottom_pt` line per page.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

DPI = 144.0
PT_PER_PX = 72.0 / DPI


def main() -> int:
    pdf = sys.argv[1]
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["pdftoppm", "-r", str(int(DPI)), "-png", pdf, str(Path(tmp) / "p")],
            check=True,
        )
        for png in sorted(Path(tmp).glob("p-*.png")):
            page = int(png.stem.split("-")[-1])
            im = Image.open(png).convert("RGB")
            bg = im.getpixel((2, 2))
            w, h = im.size
            px = im.load()
            bottom = 0
            for y in range(h - 1, -1, -1):
                row = False
                for x in range(0, w, 2):
                    c = px[x, y]
                    if abs(c[0] - bg[0]) > 6 or abs(c[1] - bg[1]) > 6 or abs(c[2] - bg[2]) > 6:
                        row = True
                        break
                if row:
                    bottom = y + 1
                    break
            print(f"{page}\t{bottom * PT_PER_PX:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

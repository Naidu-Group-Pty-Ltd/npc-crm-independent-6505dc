"""Deterministic, dependency-free PDF fixture generator for the E2 vNext
compatibility suite.

Generates small, ARTIFICIAL PDFs (never the client report) covering the 20 fixture
categories from the E2 plan. Only the GENERATOR is committed — the PDFs are built
into a temp/gitignored dir at test time and fed to the baseline-vs-vNext harness
(which requires a docling install). Output is byte-deterministic for a fixed
Python (fixed object order, no timestamps), so fixture hashes are stable.

Usage:
    python generate_fixtures.py /tmp/e2-fixtures        # write all fixtures
    from generate_fixtures import FIXTURES, write_fixture
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from typing import Callable

# ── Minimal deterministic PDF writer (text + filled/stroked rectangles) ──────

PAGE_W, PAGE_H = 595, 842  # A4 points


class _PdfBuilder:
    def __init__(self) -> None:
        self._pages: list[str] = []

    def add_page(self, content: str) -> None:
        self._pages.append(content)

    def build(self) -> bytes:
        objs: list[bytes] = []
        # 1 Catalog, 2 Pages, then per page: Page + Content; last: Font.
        n_pages = len(self._pages)
        page_obj_ids = [3 + 2 * i for i in range(n_pages)]
        content_obj_ids = [4 + 2 * i for i in range(n_pages)]
        font_id = 3 + 2 * n_pages

        objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
        kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
        objs.append(f"<< /Type /Pages /Count {n_pages} /Kids [{kids}] >>".encode())
        for i, content in enumerate(self._pages):
            stream = content.encode("latin-1", "replace")
            page = (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
                f"/Resources << /Font << /F1 {font_id} 0 R >> >> "
                f"/Contents {content_obj_ids[i]} 0 R >>"
            ).encode()
            objs.append(page)
            objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
        objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for idx, body in enumerate(objs, start=1):
            offsets.append(len(out))
            out += f"{idx} 0 obj\n".encode() + body + b"\nendobj\n"
        xref_pos = len(out)
        out += f"xref\n0 {len(objs) + 1}\n".encode()
        out += b"0000000000 65535 f \n"
        for off in offsets[1:]:
            out += f"{off:010d} 00000 n \n".encode()
        out += (
            f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode()
        )
        return bytes(out)


def _esc(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _text(x: float, y: float, s: str, size: int = 11) -> str:
    return f"BT /F1 {size} Tf {x} {y} Td ({_esc(s)}) Tj ET\n"


def _rect(x: float, y: float, w: float, h: float, fill: bool = False) -> str:
    op = "f" if fill else "S"
    return f"{x} {y} {w} {h} re {op}\n"


# ── Fixture content builders (deterministic, artificial) ────────────────────

def _prose() -> str:
    c = _text(60, 780, "Investment summary (generated fixture).", 14)
    for i, line in enumerate([
        "This is deterministic artificial prose used only for E2 compatibility.",
        "It contains no client content, addresses or financial figures.",
        "Reading order and Unicode safety are validated across engines.",
    ]):
        c += _text(60, 750 - i * 20, line)
    return c


def _punctuation() -> str:
    c = _text(60, 780, "Punctuation and ranges", 14)
    lines = [
        "Range: $450,000 - $470,000",   # hyphen/en-dash rendered as ascii for base font
        "Percent: 3.5% to 4.0%",
        "Growth: 2019 -> 2024",
        "Area: 3 x 4 grid; 650 sqm",
    ]
    for i, line in enumerate(lines):
        c += _text(60, 750 - i * 20, line)
    return c


def _simple_table() -> str:
    c = _text(60, 800, "Simple table", 14)
    c += _grid(60, 640, 3, 2, 120, 40)
    for r, row in enumerate([["Year", "Value"], ["2023", "100"], ["2024", "120"]]):
        for col, cell in enumerate(row):
            c += _text(70 + col * 120, 690 - r * 40, cell)
    return c


def _merged_table() -> str:
    c = _text(60, 800, "Merged-cell table", 14)
    c += _rect(60, 700, 240, 40)  # header spanning two columns
    c += _text(70, 715, "Financials (merged header)")
    c += _grid(60, 620, 2, 2, 120, 40)
    return c


def _two_tables() -> str:
    c = _text(60, 800, "Two adjacent independent tables", 14)
    c += _grid(60, 640, 3, 2, 100, 40)
    c += _grid(320, 640, 3, 2, 100, 40)
    return c


def _financial_table() -> str:
    c = _text(60, 810, "Complex financial table", 12)
    c += _grid(40, 500, 8, 5, 100, 36)
    for r in range(8):
        c += _text(46, 640 - r * 36, f"Row {r+1}")
        for col in range(1, 5):
            c += _text(46 + col * 100, 640 - r * 36, f"${(r+1)*(col)*1000:,}")
    return c


def _bar_chart() -> str:
    c = _text(60, 800, "Bar chart", 14)
    for i, h in enumerate([60, 120, 90, 150, 110]):
        c += _rect(80 + i * 60, 300, 40, h, fill=True)
        c += _text(85 + i * 60, 285, f"'2{i}")
    c += _text(60, 470, "Revenue by year ($m)")
    return c


def _line_chart() -> str:
    c = _text(60, 800, "Line chart", 14)
    pts = [(80, 320), (160, 400), (240, 360), (320, 460), (400, 420)]
    c += f"{pts[0][0]} {pts[0][1]} m " + " ".join(f"{x} {y} l" for x, y in pts[1:]) + " S\n"
    c += _text(60, 500, "Median price trend")
    return c


def _pie_chart() -> str:
    c = _text(60, 800, "Pie chart", 14)
    # Approximate with stroked wedges (rectangular legend swatches).
    for i, lbl in enumerate(["A 40%", "B 35%", "C 25%"]):
        c += _rect(80, 500 - i * 30, 20, 20, fill=True)
        c += _text(110, 505 - i * 30, lbl)
    c += _rect(300, 400, 150, 150)
    return c


def _chart_currency() -> str:
    c = _text(60, 800, "Chart with currency labels", 14)
    for i, v in enumerate(["$1.2m", "$1.5m", "$1.1m"]):
        c += _rect(80 + i * 80, 300, 50, 80 + i * 30, fill=True)
        c += _text(80 + i * 80, 285, v)
    return c


def _chart_percent() -> str:
    c = _text(60, 800, "Chart with percentages", 14)
    for i, v in enumerate(["12%", "18%", "9%"]):
        c += _rect(80 + i * 80, 300, 50, 60 + i * 20, fill=True)
        c += _text(80 + i * 80, 285, v)
    return c


def _photo_caption() -> str:
    c = _text(60, 800, "Photo with caption", 14)
    c += _rect(80, 400, 300, 200, fill=True)  # solid block stands in for a photo
    c += _text(80, 380, "Figure 1. Street view (artificial).")
    return c


def _logo() -> str:
    c = _text(60, 800, "Logo-like image", 14)
    c += _rect(80, 700, 60, 60, fill=True)
    c += _text(150, 730, "ACME")
    return c


def _formula() -> str:
    c = _text(60, 800, "Formula", 14)
    c += _text(60, 720, "E = mc^2")
    c += _text(60, 690, "y = a*x^2 + b*x + c")
    return c


def _code() -> str:
    c = _text(60, 800, "Code block", 14)
    for i, line in enumerate(["def f(x):", "    return x * 2", "print(f(21))"]):
        c += _text(60, 740 - i * 18, line, 10)
    return c


def _scanned() -> str:
    # Image-only proxy: a filled page region with no selectable text overlay.
    return _rect(40, 40, PAGE_W - 80, PAGE_H - 80, fill=True)


def _mixed() -> str:
    c = _text(60, 800, "Mixed native + scanned", 14)
    c += _text(60, 760, "Native paragraph text here.")
    c += _rect(60, 400, 300, 200, fill=True)
    return c


def _brochure() -> str:
    c = _text(60, 810, "Design-heavy brochure", 16)
    c += _rect(40, 500, 250, 250, fill=True)
    c += _rect(310, 500, 245, 250)
    for i, line in enumerate(["Premium", "Investment", "Opportunity"]):
        c += _text(320, 700 - i * 30, line, 13)
    return c


@dataclass
class Fixture:
    name: str
    pages: int
    builder: Callable[[], str]
    extra_pages: Callable[[], list[str]] = field(default=lambda: [])


FIXTURES: list[Fixture] = [
    Fixture("01_native_prose", 1, _prose),
    Fixture("02_punctuation_ranges", 1, _punctuation),
    Fixture("03_simple_table", 1, _simple_table),
    Fixture("04_merged_cell_table", 1, _merged_table),
    Fixture("05_two_adjacent_tables", 1, _two_tables),
    Fixture("06_complex_financial_table", 1, _financial_table),
    Fixture("07_bar_chart", 1, _bar_chart),
    Fixture("08_line_chart", 1, _line_chart),
    Fixture("09_pie_chart", 1, _pie_chart),
    Fixture("10_chart_currency", 1, _chart_currency),
    Fixture("11_chart_percent", 1, _chart_percent),
    Fixture("12_photo_caption", 1, _photo_caption),
    Fixture("13_logo", 1, _logo),
    Fixture("14_formula", 1, _formula),
    Fixture("15_code_block", 1, _code),
    Fixture("16_scanned_image_only", 1, _scanned),
    Fixture("17_mixed_native_scanned", 1, _mixed),
    Fixture("18_brochure_design_heavy", 1, _brochure),
    Fixture("19_multipage_25", 25, _prose),
    Fixture("20_multipage_80", 80, _prose),
]


def _grid(x: float, y: float, rows: int, cols: int, cw: float, ch: float) -> str:
    c = ""
    for r in range(rows):
        for col in range(cols):
            c += _rect(x + col * cw, y - r * ch, cw, ch)
    return c


def build_fixture_bytes(fx: Fixture) -> bytes:
    b = _PdfBuilder()
    first = fx.builder()
    b.add_page(first)
    for i in range(1, fx.pages):
        b.add_page(_text(60, 780, f"Page {i + 1} (generated).") + first if i < 2 else _text(60, 780, f"Page {i + 1} (generated)."))
    return b.build()


def write_fixture(fx: Fixture, out_dir: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{fx.name}.pdf")
    with open(path, "wb") as fh:
        fh.write(build_fixture_bytes(fx))
    return path


def main(out_dir: str) -> None:
    for fx in FIXTURES:
        path = write_fixture(fx, out_dir)
        print(f"wrote {path} ({os.path.getsize(path)} bytes, {fx.pages} pages)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/e2-fixtures")

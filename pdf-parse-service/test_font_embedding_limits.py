"""Regression coverage for the document-wide embedded-font payload budget."""

import base64

import app


class _Page:
    def get_fonts(self, full=True):
        assert full
        return [
            (1, "ttf", "Type0", "FirstFont", "F1", "", 0),
            (2, "ttf", "Type0", "SecondFont", "F2", "", 0),
        ]


class _Document:
    page_count = 1

    def load_page(self, page_number):
        assert page_number == 0
        return _Page()

    def extract_font(self, xref):
        return ("font", "ttf", "Type0", b"abcd" if xref == 1 else b"efgh")

    def close(self):
        pass


class _Font:
    glyph_count = 128

    def __init__(self, **_kwargs):
        pass

    def has_glyph(self, _codepoint):
        return True


class _Fitz:
    Font = _Font

    @staticmethod
    def open(**_kwargs):
        return _Document()


def test_extract_fitz_fonts_caps_aggregate_embedded_bytes(monkeypatch):
    monkeypatch.setattr(app, "fitz", _Fitz)
    monkeypatch.setattr(app, "_FITZ_AVAILABLE", True)
    monkeypatch.setattr(app, "ENABLE_FITZ_LAYERS", True)
    monkeypatch.setattr(app, "MAX_FONT_BYTES", 4)
    monkeypatch.setattr(app, "MAX_EMBEDDED_FONT_BYTES", 6)

    fonts = app._extract_fitz_fonts(b"%PDF-fake")

    assert [font["basename"] for font in fonts] == ["FirstFont", "SecondFont"]
    assert fonts[0]["base64"] == base64.b64encode(b"abcd").decode("ascii")
    assert "base64" not in fonts[1]
    assert fonts[1]["bytes"] == 4


# ── R2: coverage-gated embedding ─────────────────────────────────────────────
# A subset whose cmap coverage can be read embeds WITH `coverage_ranges` (the
# client scopes its @font-face by unicode-range). A subset whose coverage
# cannot be read must NOT embed at all — without a range the face claims every
# codepoint it does not have. A full (non-subset) font embeds either way.


class _SubsetPage:
    def get_fonts(self, full=True):
        assert full
        return [
            (1, "ttf", "Type0", "AAAAAA+Readable", "F1", "", 0),
            (2, "ttf", "Type0", "BBBBBB+Unreadable", "F2", "", 0),
        ]


class _SubsetDocument(_Document):
    def load_page(self, page_number):
        assert page_number == 0
        return _SubsetPage()


class _CoverageFont:
    glyph_count = 12

    def __init__(self, fontbuffer=None, **_kwargs):
        self._buf = fontbuffer

    def has_glyph(self, _codepoint):
        return True

    def valid_codepoints(self):
        if self._buf == b"abcd":
            return [65, 66, 67, 90]
        raise RuntimeError("no readable cmap")


class _CoverageFitz:
    Font = _CoverageFont

    @staticmethod
    def open(**_kwargs):
        return _SubsetDocument()


def test_subset_embeds_only_with_readable_coverage(monkeypatch):
    monkeypatch.setattr(app, "fitz", _CoverageFitz)
    monkeypatch.setattr(app, "_FITZ_AVAILABLE", True)
    monkeypatch.setattr(app, "ENABLE_FITZ_LAYERS", True)

    fonts = app._extract_fitz_fonts(b"%PDF-fake")

    assert [font["basename"] for font in fonts] == ["Readable", "Unreadable"]
    readable, unreadable = fonts
    assert readable["coverage_ranges"] == ["U+0041-0043", "U+005A"]
    assert readable["base64"] == base64.b64encode(b"abcd").decode("ascii")
    assert "coverage_ranges" not in unreadable
    assert "base64" not in unreadable


def test_cmap_coverage_ranges_shapes():
    class _Sparse:
        def valid_codepoints(self):
            return [0, -5, 0x110000, 65, 66, 67, 90]

    assert app._cmap_coverage_ranges(_Sparse()) == ["U+0041-0043", "U+005A"]

    class _Empty:
        def valid_codepoints(self):
            return []

    assert app._cmap_coverage_ranges(_Empty()) is None
    assert app._cmap_coverage_ranges(object()) is None

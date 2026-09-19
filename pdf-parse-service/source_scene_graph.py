"""source-scene-graph-v2 — PDF Extraction V3 · Package E1 (pure, deterministic).

Builds ONE immutable, provider-neutral source representation of a PDF page: the
Source Scene Graph V2. It answers, deterministically, what source regions exist
on a page, where they are (top-left PDF points), whether each critical visual
region has a durable source crop, and what text / numeric / punctuation / table
/ chart evidence each region carries — independent of the candidate template,
CDIR reconstruction, the visual-quality score, and short-lived signed URLs.

DESIGN CONTRACT
- Pure + deterministic. Importing this module MUST NOT initialise Docling models
  or open any network / filesystem resource. Pillow is imported lazily and only
  inside the foreground helper, so the contract types + ID + normalisation are
  usable in CI without native image libraries.
- Source truth only. Nothing here reads the candidate template or a page-output
  decision. E0 may later *consume* this evidence to protect output.
- Region identities are deterministic and chunk-independent (see `region_id`):
  the same source page produces the same parent-global region IDs whether it was
  parsed monolithically or as a chunk-local page later rebased.
- No signed URLs, secrets, or raw source text ever leave through logs or through
  the persisted scene graph. `problems` carry codes/counts/bounded messages only.

The sidecar (`app.py`) renders region crops and uploads artifacts; this module
performs assembly, canonicalisation and validation. Crop *bytes* are supplied to
`build_foreground_summary`; crop *paths/hashes* are attached via `attach_crop`.
"""

from __future__ import annotations

import math
import re
import unicodedata
from typing import Any, Optional

# W3 — deterministic chart series extraction. Pure and separately tested; this
# module supplies the evidence, `chart_candidates` does the arithmetic.
from chart_candidates import (
    CHART_CANDIDATE_CONTRACT_VERSION,
    AxisTick,
    account_numeric_tokens,
    extract_bar_series,
    fit_axis_scale,
    smallest_tick_interval,
)

# ── Contract versions ───────────────────────────────────────────────────────

SOURCE_SCENE_GRAPH_VERSION = "source-scene-graph-v2"
SOURCE_REGION_VERSION = "source-region-v2"
PAGE_ARTIFACT_CONTRACT_VERSION = "pdf-page-artifact-contract-v3"
SOURCE_TABLE_TOPOLOGY_VERSION = "source-table-topology-v2"
SOURCE_CHART_METADATA_VERSION = "source-chart-metadata-v2"
SOURCE_FOREGROUND_SUMMARY_VERSION = "source-foreground-summary-v1"
PROVIDER_REGION_EVIDENCE_VERSION = "provider-region-evidence-v1"
# E3 — Chart & Picture Preservation: deterministic chart render plan + metrics.
CHART_PRESERVATION_VERSION = "chart-preservation-v1"
CHART_DETECTION_SIGNALS_VERSION = "chart-detection-signals-v1"

# Region types requiring a durable source crop for a *complete* critical region.
CROP_REQUIRED_TYPES = frozenset({"table", "chart", "picture", "logo", "vector-cluster"})

REGION_TYPE_ABBREV = {
    "text": "text",
    "table": "tabl",
    "chart": "chrt",
    "picture": "pict",
    "logo": "logo",
    "vector-cluster": "vect",
    "background": "bkgd",
    "unknown-visual": "unkv",
}

# ── Bounded-size limits (Phase 18) ──────────────────────────────────────────

MAX_REGIONS_PER_PAGE = 400
MAX_SPANS_PER_PAGE = 6000
MAX_CROPS_PER_PAGE = 160
MAX_TILE_GRID = 16  # tileRows/tileCols upper bound
MAX_DENSE_VECTOR_REGIONS = 24

# Conservative dense-vector-cluster threshold (mirrors E0).
DENSE_VECTOR_MIN_PATHS = 14

# Deterministic crop padding, in PDF points.
CROP_PADDING_PT = 2.0

# ── E3 — chart preservation tuning (deterministic; no AI, no remote APIs) ────
#
# Chart crops are SOURCE TRUTH: a chart is preserved by rendering its exact source
# pixels, never by redrawing bars/axes/legends. Charts get a dedicated crop at a
# floor of 300 DPI so the preserved visual stays sharp even if the page crop DPI
# is lowered. Detection combines Docling classification, caption/title terms,
# vector (gridline) density, axis-tick detection, legend detection and numeric-
# label density — all pure geometric/lexical heuristics with fixed thresholds.
CHART_CROP_MIN_DPI = 300
# A picture with none of the strong signals below is NEVER promoted to a chart,
# so weak-keyword-only pages (E1 test 40) stay pictures. Promotion requires
# corroboration from real in-region evidence, not a single title term.
CHART_PROMOTE_MIN_SCORE = 0.5
CHART_AXIS_MIN_TICKS = 2           # numeric tick-labels along an edge → axis present
CHART_LEGEND_MIN_ENTRIES = 2       # short repeated labels → legend present
CHART_GRIDLINE_MIN_PATHS = 10      # vector paths inside the region → gridlines/series
CHART_NUMERIC_MIN_LABELS = 2       # numeric tokens inside the region → data labels
# A text box counts as an "edge" axis tick when its centre sits within this
# fraction of the region's width/height from the left or bottom edge.
CHART_EDGE_BAND = 0.18
# A legend entry is a short text box (few characters) — bounded to avoid treating
# paragraphs as legend keys.
CHART_LEGEND_MAX_CHARS = 24

# ── Chart lexicon (mirrors E0 STRONG_CHART_TERMS; conservative) ─────────────

STRONG_CHART_TERMS = (
    "chart", "graph", "plot", "price history", "growth", "vacancy history",
    "vacancy rate", "projection", "projections", "scenario", "scenarios",
    "comparable sales", "yield comparison", "cagr", "timeline", "trend",
    "forecast", "rental yield", "capital growth", "median price",
)
CHART_CLASS_RE = re.compile(r"chart|graph|plot|bar|line|pie|scatter|histogram|diagram", re.I)
LOGO_CLASS_RE = re.compile(r"logo|brand|icon", re.I)
NUMERIC_LABEL_RE = re.compile(r"[$£€]|\d[\d,]*\.?\d*\s*%|\b\d{4}\b|\d[\d,]{2,}")
# Axis-tick-like text: a short standalone number, year, percentage or currency.
AXIS_TICK_RE = re.compile(r"^[$£€]?\s*[-+]?\d[\d,]*\.?\d*\s*%?$|^\d{4}$")


# ── Deterministic hashing (FNV-1a 32-bit) ───────────────────────────────────
# A tiny, language-portable hash so Python (producer) and TypeScript (consumer)
# derive byte-identical region IDs from the same canonical key. This is an
# identity hash, NOT a content-integrity hash — crop bytes use SHA-256 (in app).

_FNV_OFFSET = 0x811C9DC5
_FNV_PRIME = 0x01000193
_UINT32 = 0xFFFFFFFF


def fnv1a32(text: str) -> str:
    """8-char lowercase hex FNV-1a over the UTF-8 bytes of `text`."""
    h = _FNV_OFFSET
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * _FNV_PRIME) & _UINT32
    return f"{h:08x}"


def _round2(value: Any) -> Optional[float]:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    # Round-half-to-even is fine; the value only feeds a stable string key.
    return round(f, 2)


def _fmt2(value: float) -> str:
    """Canonical fixed-2 decimal string; avoids '-0.00' and float repr drift."""
    v = round(value + 0.0, 2)
    if v == 0:
        v = 0.0
    return f"{v:.2f}"


# ── Coordinate normalisation (Phase 4) ──────────────────────────────────────


def normalize_bbox(
    raw: Any,
    page_width: float,
    page_height: float,
) -> tuple[Optional[dict], list[str]]:
    """Normalise a Docling/PyMuPDF bbox to a top-left, y-down, PDF-point rect.

    Accepts a Docling dict ``{l,t,r,b,coord_origin}`` or a 4-tuple ``[l,t,r,b]``
    (assumed TOPLEFT). Returns ``({x,y,width,height}, problems)``. The rect is
    clamped to the page; an out-of-page overshoot is reported as a problem but
    the clamped rect is still returned. A fully off-page or degenerate rect
    returns ``(None, problems)``.
    """
    problems: list[str] = []
    l = t = r = b = None
    origin = "TOPLEFT"
    if isinstance(raw, dict):
        l, t, r, b = raw.get("l"), raw.get("t"), raw.get("r"), raw.get("b")
        origin = str(raw.get("coord_origin") or "TOPLEFT").upper()
    elif isinstance(raw, (list, tuple)) and len(raw) >= 4:
        l, t, r, b = raw[0], raw[1], raw[2], raw[3]
    else:
        return None, ["bbox_missing"]

    try:
        l, t, r, b = float(l), float(t), float(r), float(b)
    except (TypeError, ValueError):
        return None, ["bbox_non_numeric"]

    if not all(math.isfinite(v) for v in (l, t, r, b)):
        return None, ["bbox_non_finite"]

    if origin == "BOTTOMLEFT" and page_height:
        y0, y1 = page_height - max(t, b), page_height - min(t, b)
    else:
        y0, y1 = min(t, b), max(t, b)
    x0, x1 = min(l, r), max(l, r)

    # Off-page detection before clamping.
    pw = float(page_width) if page_width and math.isfinite(page_width) else None
    ph = float(page_height) if page_height and math.isfinite(page_height) else None
    if pw is not None and ph is not None:
        if x1 <= 0 or y1 <= 0 or x0 >= pw or y0 >= ph:
            return None, ["bbox_off_page"]
        overshoot = x0 < -0.5 or y0 < -0.5 or x1 > pw + 0.5 or y1 > ph + 0.5
        x0 = min(max(x0, 0.0), pw)
        x1 = min(max(x1, 0.0), pw)
        y0 = min(max(y0, 0.0), ph)
        y1 = min(max(y1, 0.0), ph)
        if overshoot:
            problems.append("bbox_exceeds_page_clamped")

    width = x1 - x0
    height = y1 - y0
    if width <= 0 or height <= 0:
        return None, problems + ["bbox_zero_area"]

    return (
        {
            "x": _round2(x0),
            "y": _round2(y0),
            "width": _round2(width),
            "height": _round2(height),
        },
        problems,
    )


def _canonical_bbox_key(bbox: dict) -> str:
    return "|".join(
        _fmt2(float(bbox.get(k) or 0.0)) for k in ("x", "y", "width", "height")
    )


# ── Deterministic region / span identities (Phase 3) ────────────────────────


def region_id(global_page: int, region_type: str, bbox: dict, ordinal: int) -> str:
    """Deterministic, chunk-independent region ID.

    Format: ``src-p{page:04d}-{abbrev}-{ordinal:04d}-{hash8}``.

    The canonical key hashes the *parent-global* page number, region type,
    normalised bbox (rounded to 0.01 pt) and the deterministic per-(page,type)
    ordinal — never a Docling ``self_ref`` (document-position-dependent, so it
    would differ between a monolithic parse and a chunk), never a timestamp,
    signed URL, upload order or random value. Identical extraction inputs on the
    same source page therefore always yield the same ID.
    """
    abbrev = REGION_TYPE_ABBREV.get(region_type, "unkv")
    key = "|".join(
        [str(int(global_page)), region_type, _canonical_bbox_key(bbox), str(int(ordinal))]
    )
    return f"src-p{int(global_page):04d}-{abbrev}-{int(ordinal):04d}-{fnv1a32(key)}"


def span_id(global_page: int, bbox: dict, ordinal: int, font: str, size: float) -> str:
    key = "|".join(
        [str(int(global_page)), _canonical_bbox_key(bbox), str(int(ordinal)), font or "", _fmt2(size or 0.0)]
    )
    return f"src-p{int(global_page):04d}-span-{int(ordinal):04d}-{fnv1a32(key)}"


def _canonical_sort_key(region_type: str, bbox: dict) -> tuple:
    """Deterministic sort: y, x, height, width, region type."""
    return (
        float(bbox.get("y") or 0.0),
        float(bbox.get("x") or 0.0),
        float(bbox.get("height") or 0.0),
        float(bbox.get("width") or 0.0),
        region_type,
    )


# ── Token evidence (Phase 5) ────────────────────────────────────────────────

_PUNCT_MAP = {
    "–": "en-dash",
    "—": "em-dash",
    "−": "minus",
    "→": "arrow",
    "←": "arrow",
    "↔": "arrow",
    "×": "multiplication",
    "•": "bullet",
    " ": "non-breaking-space",
}
# A plain hyphen-minus is context-dependent; classify as 'hyphen' by default.
_HYPHEN = "-"

_CURRENCY_SYMBOLS = {"$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY", "A$": "AUD"}
_NUMBER_RE = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?")
# A numeric range like "$450,000 – $470,000" or "3.5% to 4.0%". A currency symbol
# may sit between the separator and the second number, so allow it optionally.
_RANGE_RE = re.compile(
    r"([-+]?\d[\d,]*(?:\.\d+)?)\s*(?:–|—|to|→)\s*(?:[$£€¥]\s*)?([-+]?\d[\d,]*(?:\.\d+)?)"
)


def normalize_nfc(text: str) -> str:
    """NFC normalisation that PRESERVES punctuation (never lossy)."""
    if not isinstance(text, str):
        return ""
    return unicodedata.normalize("NFC", text)


def extract_punctuation_tokens(text: str) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for ch in text or "":
        kind = _PUNCT_MAP.get(ch)
        if kind is None and ch == _HYPHEN:
            kind = "hyphen"
        if kind is None:
            continue
        marker = f"{ch}:{kind}"
        if marker in seen:
            continue
        seen.add(marker)
        out.append({"raw": ch, "kind": kind})
    return out


def _classify_number(raw: str, prefix: str, suffix: str) -> dict:
    normalized = raw.replace(",", "")
    token: dict[str, Any] = {"raw": raw, "normalized": normalized, "kind": "unknown"}
    cur = None
    for sym, code in _CURRENCY_SYMBOLS.items():
        if sym in prefix:
            cur = code
            break
    if cur:
        token["kind"] = "currency"
        token["currency"] = cur
    elif "%" in suffix:
        token["kind"] = "percentage"
    elif re.search(r"\b(?:sqm|sq\s?m|m2|ha|km|kg|bed|bath|car)\b", suffix, re.I):
        token["kind"] = "measurement"
        m = re.search(r"[A-Za-z][A-Za-z0-9]*", suffix)
        token["unit"] = m.group(0) if m else None
    elif "." in normalized:
        token["kind"] = "decimal"
    else:
        token["kind"] = "integer"
    return token


def extract_numeric_tokens(text: str) -> list[dict]:
    """Extract source numeric evidence. Records the SOURCE representation only —
    never calculates, interprets or infers a missing value."""
    if not isinstance(text, str) or not text:
        return []
    out: list[dict] = []

    # Ranges first (e.g. "$450,000 – $470,000", "3.5% to 4.0%").
    consumed: list[tuple[int, int]] = []
    for m in _RANGE_RE.finditer(text):
        consumed.append((m.start(), m.end()))
        start_raw, end_raw = m.group(1), m.group(2)
        cur = None
        for sym, code in _CURRENCY_SYMBOLS.items():
            if sym in text[max(0, m.start() - 4): m.end()]:
                cur = code
                break
        out.append({
            "raw": m.group(0).strip(),
            "normalized": None,
            "kind": "range",
            "rangeStart": start_raw.replace(",", ""),
            "rangeEnd": end_raw.replace(",", ""),
            "currency": cur,
            "unit": None,
        })

    # Standalone numbers not already consumed by a range.
    for m in _NUMBER_RE.finditer(text):
        if any(s <= m.start() < e for s, e in consumed):
            continue
        prefix = text[max(0, m.start() - 2): m.start()]
        suffix = text[m.end(): m.end() + 6]
        out.append(_classify_number(m.group(0), prefix, suffix))

    return out


# ── Source spans (Phase 5) ──────────────────────────────────────────────────


def _prov_bbox(item: dict) -> Any:
    prov = item.get("prov")
    if isinstance(prov, list) and prov and isinstance(prov[0], dict):
        return prov[0].get("bbox")
    for key in ("bbox", "bounds", "bounding_box"):
        if item.get(key) is not None:
            return item.get(key)
    return None


def build_source_spans(
    texts: list[dict],
    *,
    global_page: int,
    page_width: float,
    page_height: float,
) -> tuple[list[dict], list[str]]:
    """Immutable, block-level source span evidence from Docling text items.

    The current production engine emits block-level text (paragraphs/headings),
    so a "span" here is one Docling text item with its raw + NFC text, font
    hints, reading order, and tokens. Finer glyph advances arrive in E2/E5 and
    are recorded as null when unavailable — never fabricated.
    """
    problems: list[str] = []
    spans: list[dict] = []
    candidates: list[tuple[dict, dict]] = []  # (item, normalized bbox)
    for item in texts or []:
        bbox, bprob = normalize_bbox(_prov_bbox(item), page_width, page_height)
        if bbox is None:
            continue
        candidates.append((item, bbox))

    candidates.sort(key=lambda pair: _canonical_sort_key("text", pair[1]))
    if len(candidates) > MAX_SPANS_PER_PAGE:
        problems.append("spans_truncated_to_limit")
        candidates = candidates[:MAX_SPANS_PER_PAGE]

    for ordinal, (item, bbox) in enumerate(candidates, start=1):
        raw = str(item.get("text") or item.get("orig") or "")
        font = item.get("font") if isinstance(item.get("font"), dict) else {}
        font_name = str(font.get("family") or font.get("psName") or "")
        size = font.get("size")
        sid = span_id(global_page, bbox, ordinal, font_name, float(size or 0.0))
        had_glyph_placeholder = "�" in raw or "\x00" in raw
        spans.append({
            "id": sid,
            "pageNumber": global_page,
            "bbox": bbox,
            "raw": raw,
            "normalizedNfc": normalize_nfc(raw),
            "hadGlyphPlaceholder": had_glyph_placeholder,
            "font": font_name or None,
            "fontSize": float(size) if isinstance(size, (int, float)) else None,
            "weight": font.get("weight") if isinstance(font.get("weight"), (int, str)) else None,
            "italic": bool(font.get("italic")) if font.get("italic") is not None else None,
            "color": font.get("color") if isinstance(font.get("color"), str) else None,
            "lineHeight": float(font["line_height"]) if isinstance(font.get("line_height"), (int, float)) else None,
            "textAlign": item.get("text_align") if isinstance(item.get("text_align"), str) else None,
            "readingOrder": int(item["reading_order"]) if isinstance(item.get("reading_order"), int) else None,
            "label": item.get("label") if isinstance(item.get("label"), str) else None,
            "provider": "docling",
            "confidence": float(item["confidence"]) if isinstance(item.get("confidence"), (int, float)) else None,
            "numericTokens": extract_numeric_tokens(raw),
            "punctuationTokens": extract_punctuation_tokens(raw),
        })

    return spans, problems


# ── Table topology (Phase 7) ────────────────────────────────────────────────


def build_table_topology(table: dict) -> dict:
    """Preserve source table topology + cell association. Never copies merged-cell
    text into every spanned cell; never merges adjacent tables."""
    data = table.get("data") if isinstance(table.get("data"), dict) else {}
    raw_cells = data.get("table_cells")
    if not isinstance(raw_cells, list):
        grid = data.get("grid")
        raw_cells = [c for row in grid for c in row] if isinstance(grid, list) else []

    num_rows = int(data.get("num_rows") or 0)
    num_cols = int(data.get("num_cols") or 0)
    problems: list[str] = []

    cells: list[dict] = []
    header_rows: set[int] = set()
    header_cols: set[int] = set()
    for idx, c in enumerate(raw_cells):
        if not isinstance(c, dict):
            continue
        row = int(c.get("start_row_offset_idx", c.get("row", 0)) or 0)
        col = int(c.get("start_col_offset_idx", c.get("col", 0)) or 0)
        end_row = int(c.get("end_row_offset_idx", row + 1) or (row + 1))
        end_col = int(c.get("end_col_offset_idx", col + 1) or (col + 1))
        row_span = max(1, int(c.get("row_span") or (end_row - row) or 1))
        col_span = max(1, int(c.get("col_span") or (end_col - col) or 1))
        col_header = bool(c.get("column_header"))
        row_header = bool(c.get("row_header"))
        if col_header:
            header_rows.add(row)
        if row_header:
            header_cols.add(col)
        text = str(c.get("text") or "")
        cells.append({
            "id": f"r{row}c{col}",
            "row": row,
            "col": col,
            "rowSpan": row_span,
            "colSpan": col_span,
            "columnHeader": col_header,
            "rowHeader": row_header,
            "text": text,
            "numericTokens": extract_numeric_tokens(text),
            "bbox": _table_cell_bbox(c),
            "confidence": float(c["confidence"]) if isinstance(c.get("confidence"), (int, float)) else None,
            "providerRefs": ["docling"],
        })

    # Deterministic cell order: row, then column.
    cells.sort(key=lambda cell: (cell["row"], cell["col"]))

    # Span-bounds validation.
    for cell in cells:
        if cell["row"] + cell["rowSpan"] > max(num_rows, cell["row"] + cell["rowSpan"]) and num_rows:
            if cell["row"] + cell["rowSpan"] > num_rows:
                problems.append("cell_row_span_out_of_bounds")
        if num_cols and cell["col"] + cell["colSpan"] > num_cols:
            problems.append("cell_col_span_out_of_bounds")

    if num_rows <= 0 or num_cols <= 0:
        problems.append("table_dimensions_missing")
    if not cells:
        problems.append("table_has_no_cells")

    caption = table.get("caption") if isinstance(table.get("caption"), str) else None
    return {
        "version": SOURCE_TABLE_TOPOLOGY_VERSION,
        "numRows": num_rows,
        "numCols": num_cols,
        "headerRowCount": len(header_rows),
        "headerColumnCount": len(header_cols),
        "cells": cells,
        "caption": caption,
        "sourceProvider": "docling",
        "topologyProblems": sorted(set(problems)),
        "complete": len(problems) == 0,
    }


def _table_cell_bbox(cell: dict) -> Optional[dict]:
    b = cell.get("bbox")
    if isinstance(b, dict) and all(k in b for k in ("l", "t", "r", "b")):
        x = min(float(b["l"]), float(b["r"]))
        y = min(float(b["t"]), float(b["b"]))
        return {
            "x": _round2(x),
            "y": _round2(y),
            "width": _round2(abs(float(b["r"]) - float(b["l"]))),
            "height": _round2(abs(float(b["b"]) - float(b["t"]))),
        }
    return None


# ── Chart / picture classification (Phase 7) ────────────────────────────────


def _has_strong_chart_term(terms: list[str]) -> bool:
    for raw in terms:
        if not isinstance(raw, str):
            continue
        low = raw.lower()
        if any(term in low for term in STRONG_CHART_TERMS):
            return True
    return False


def _picture_class(pic: dict) -> Optional[str]:
    cl = pic.get("classification") if isinstance(pic.get("classification"), dict) else {}
    direct = cl.get("predicted_class")
    if isinstance(direct, str) and direct:
        return direct.lower()
    classes = cl.get("predicted_classes")
    if isinstance(classes, list) and classes:
        best = sorted(
            [c for c in classes if isinstance(c, dict)],
            key=lambda c: float(c.get("confidence") or 0.0),
            reverse=True,
        )
        if best and isinstance(best[0].get("class_name"), str):
            return str(best[0]["class_name"]).lower()
    return None


def _picture_caption_terms(pic: dict) -> list[str]:
    out: list[str] = []
    if isinstance(pic.get("caption"), str) and pic["caption"]:
        out.append(pic["caption"])
    for a in pic.get("annotations") or []:
        if isinstance(a, dict) and isinstance(a.get("text"), str) and a["text"]:
            out.append(a["text"])
    return out


# ── E3 — deterministic chart-detection signals + geometry ───────────────────


def _bbox_center(bbox: dict) -> tuple[float, float]:
    x = float(bbox.get("x") or 0.0)
    y = float(bbox.get("y") or 0.0)
    return x + float(bbox.get("width") or 0.0) / 2.0, y + float(bbox.get("height") or 0.0) / 2.0


def bbox_contains(outer: dict, inner: dict, *, tolerance: float = 1.5) -> bool:
    """True when `inner`'s centre lies inside `outer` and `inner` is substantially
    within `outer`'s bounds (deterministic geometric containment, tolerant of
    small overshoot). Used to attach axis/legend/child regions to a chart."""
    if not isinstance(outer, dict) or not isinstance(inner, dict):
        return False
    ox, oy = float(outer.get("x") or 0.0), float(outer.get("y") or 0.0)
    ow, oh = float(outer.get("width") or 0.0), float(outer.get("height") or 0.0)
    if ow <= 0 or oh <= 0:
        return False
    cx, cy = _bbox_center(inner)
    if not (ox - tolerance <= cx <= ox + ow + tolerance and oy - tolerance <= cy <= oy + oh + tolerance):
        return False
    # The inner box must not be dramatically larger than the outer (a page-wide
    # box whose centre happens to fall inside a chart is not a chart child).
    iw, ih = float(inner.get("width") or 0.0), float(inner.get("height") or 0.0)
    return iw <= ow * 1.5 + tolerance and ih <= oh * 1.5 + tolerance


def _bbox_overlaps(a: dict, b: dict) -> bool:
    ax, ay = float(a.get("x") or 0.0), float(a.get("y") or 0.0)
    aw, ah = float(a.get("width") or 0.0), float(a.get("height") or 0.0)
    bx, by = float(b.get("x") or 0.0), float(b.get("y") or 0.0)
    bw, bh = float(b.get("width") or 0.0), float(b.get("height") or 0.0)
    return not (ax + aw <= bx or bx + bw <= ax or ay + ah <= by or by + bh <= ay)


def _is_axis_tick(text: str) -> bool:
    return bool(AXIS_TICK_RE.match((text or "").strip()))


def build_chart_detection_signals(
    *,
    region_bbox: dict,
    classification: Optional[str],
    caption_terms: list[str],
    title_terms: list[str],
    page_numeric: bool,
    contained_texts: list[tuple[str, dict]],
    gridline_path_count: int,
) -> dict:
    """Deterministic chart-detection evidence for one candidate visual region.

    Combines Docling picture classification, caption/title chart terms, vector
    (gridline) density, axis-tick detection, legend detection and numeric-label
    density. Returns a bounded signal dict + a fixed-weight score in [0, 1] and a
    boolean promotion recommendation. NO AI, NO remote calls, NO randomness —
    identical inputs always yield the identical result.
    """
    classification_chart = bool(classification and CHART_CLASS_RE.search(classification))
    caption_chart_term = _has_strong_chart_term(list(caption_terms) + list(title_terms))

    axis_ticks = 0
    legend_entries = 0
    numeric_labels = 0
    rw = float(region_bbox.get("width") or 0.0)
    rh = float(region_bbox.get("height") or 0.0)
    rx = float(region_bbox.get("x") or 0.0)
    ry = float(region_bbox.get("y") or 0.0)
    left_band = rx + rw * CHART_EDGE_BAND
    bottom_band = ry + rh * (1.0 - CHART_EDGE_BAND)
    for raw, bbox in contained_texts:
        text = (raw or "").strip()
        if not text:
            continue
        cx, cy = _bbox_center(bbox)
        if extract_numeric_tokens(text):
            numeric_labels += 1
        if _is_axis_tick(text) and (cx <= left_band or cy >= bottom_band):
            axis_ticks += 1
        elif len(text) <= CHART_LEGEND_MAX_CHARS and not _is_axis_tick(text):
            # A short non-numeric label inside a chart is a candidate legend key.
            legend_entries += 1

    axis_present = axis_ticks >= CHART_AXIS_MIN_TICKS
    legend_present = legend_entries >= CHART_LEGEND_MIN_ENTRIES
    gridlines_present = int(gridline_path_count) >= CHART_GRIDLINE_MIN_PATHS
    numeric_dense = numeric_labels >= CHART_NUMERIC_MIN_LABELS

    score = 0.0
    if classification_chart:
        score += 0.6
    if caption_chart_term and page_numeric:
        score += 0.4
    if axis_present:
        score += 0.25
    if legend_present:
        score += 0.2
    if gridlines_present:
        score += 0.2
    if numeric_dense:
        score += 0.15
    score = round(min(score, 1.0), 4)

    # Heuristic (unclassified) promotion requires REAL corroboration: an axis plus
    # either a legend or gridlines, and in-region numeric labels. This never fires
    # on a plain picture or a weak single title term.
    strong_signals = axis_present and (legend_present or gridlines_present) and numeric_dense
    if classification_chart:
        method = "classification"
    elif caption_chart_term and page_numeric:
        method = "caption+numeric"
    elif strong_signals:
        method = "heuristic-signals"
    else:
        method = "none"
    promote = classification_chart or (caption_chart_term and page_numeric) or (
        score >= CHART_PROMOTE_MIN_SCORE and strong_signals
    )
    return {
        "version": CHART_DETECTION_SIGNALS_VERSION,
        "classificationChart": classification_chart,
        "captionChartTerm": caption_chart_term,
        "pageNumericLabels": bool(page_numeric),
        "axisTickCount": axis_ticks,
        "legendEntryCount": legend_entries,
        "gridlinePathCount": int(gridline_path_count),
        "numericLabelCount": numeric_labels,
        "axisPresent": axis_present,
        "legendPresent": legend_present,
        "gridlinesPresent": gridlines_present,
        "score": score,
        "method": method,
        "promote": bool(promote),
    }


# ── Region assembly (Phase 7) ───────────────────────────────────────────────


def _provider_evidence(provider: str, evidence_type: str, *, provider_ref=None,
                       confidence=None, claims=None, artifact_path=None) -> dict:
    return {
        "version": PROVIDER_REGION_EVIDENCE_VERSION,
        "provider": provider,
        "providerVersion": None,
        "evidenceType": evidence_type,
        "providerRef": provider_ref,
        "confidence": float(confidence) if isinstance(confidence, (int, float)) else None,
        "claims": list(claims or []),
        "artifactPath": artifact_path,
    }


def _empty_crop() -> dict:
    return {
        "path": None, "sha256": None, "mime": None,
        "widthPx": None, "heightPx": None, "sourceDpi": None, "paddingPt": None,
    }


def _base_region(global_page: int, page_id: str, region_type: str, bbox: dict, ordinal: int) -> dict:
    return {
        "version": SOURCE_REGION_VERSION,
        "id": region_id(global_page, region_type, bbox, ordinal),
        "pageId": page_id,
        "pageNumber": global_page,
        "type": region_type,
        "bbox": bbox,
        "polygon": None,
        "readingOrder": None,
        "zOrderHint": None,
        "confidence": None,
        "sourceCrop": _empty_crop(),
        "text": None,
        "table": None,
        "chart": None,
        "visual": None,
        "relationships": {
            "parentRegionId": None,
            "childRegionIds": [],
            "captionRegionIds": [],
            "labelRegionIds": [],
        },
        "providerEvidence": [],
        "problems": [],
        "complete": False,
    }


def build_page_regions(
    *,
    global_page: int,
    page_id: str,
    page_width: float,
    page_height: float,
    texts: list[dict],
    tables: list[dict],
    pictures: list[dict],
    vectors: list[dict],
) -> tuple[list[dict], list[str]]:
    """Assemble all source regions for one page from current provider evidence.

    Regions are canonically sorted and assigned deterministic per-(page,type)
    ordinals so the resulting IDs are chunk-independent. Does NOT merge tables,
    does NOT decide native/raster output, does NOT invent chart/table values.
    """
    page_problems: list[str] = []
    staged: list[tuple[str, dict, dict]] = []  # (type, bbox, payload)

    # Provider artifacts are attacker-influenced. Bound every collection before
    # chart detection performs per-picture scans over text and vector geometry.
    # Keep the provider order so ordinary pages and deterministic IDs are
    # unchanged, and surface truncation rather than silently dropping evidence.
    bounded_inputs: dict[str, list[dict]] = {}
    for name, items in (
        ("texts", texts), ("tables", tables),
        ("pictures", pictures), ("vectors", vectors),
    ):
        values = items or []
        if len(values) > MAX_REGIONS_PER_PAGE:
            page_problems.append(f"{name}_truncated_to_limit")
        bounded_inputs[name] = values[:MAX_REGIONS_PER_PAGE]
    texts = bounded_inputs["texts"]
    tables = bounded_inputs["tables"]
    pictures = bounded_inputs["pictures"]
    vectors = bounded_inputs["vectors"]

    page_numeric = any(
        isinstance(t.get("text"), str) and NUMERIC_LABEL_RE.search(t["text"])
        for t in texts or []
    )
    title_terms: list[str] = [
        t["text"] for t in texts or []
        if isinstance(t.get("text"), str) and t.get("label") in ("title", "section_header", "caption")
    ]

    # E3 — precompute normalised text + vector geometry once so chart detection
    # can look for axis ticks, legend keys and gridlines contained by a picture.
    page_text_boxes: list[tuple[str, dict]] = []
    for t in texts or []:
        if not isinstance(t.get("text"), str) or not t["text"].strip():
            continue
        tb, _ = normalize_bbox(_prov_bbox(t), page_width, page_height)
        if tb is not None:
            page_text_boxes.append((t["text"], tb))
    page_vector_boxes: list[tuple[dict, int]] = []
    for v in vectors or []:
        vb = _vector_bbox(v, page_width, page_height)
        if vb is None:
            continue
        vpaths = v.get("paths")
        page_vector_boxes.append((vb, len(vpaths) if isinstance(vpaths, list) else 0))

    # Tables — one region each, never merged.
    for table in tables or []:
        bbox, bprob = normalize_bbox(_prov_bbox(table), page_width, page_height)
        if bbox is None:
            page_problems.extend(f"table_{p}" for p in bprob)
            continue
        topology = build_table_topology(table)
        staged.append(("table", bbox, {
            "table": topology,
            "confidence": table.get("confidence"),
            "caption": topology.get("caption"),
            "bboxProblems": bprob,
            "provider": _provider_evidence(
                "docling", "table", confidence=table.get("confidence"),
                claims=["source_table"] + (["topology_incomplete"] if not topology["complete"] else []),
            ),
        }))

    # Pictures → chart | logo | picture.
    covering_picture_present = False
    for pic in pictures or []:
        bbox, bprob = normalize_bbox(_prov_bbox(pic), page_width, page_height)
        if bbox is None:
            page_problems.extend(f"picture_{p}" for p in bprob)
            continue
        cls = _picture_class(pic)
        caption_terms = _picture_caption_terms(pic)
        # E3 — deterministic chart-detection evidence from real in-region signals.
        contained_texts = [(raw, tb) for (raw, tb) in page_text_boxes if bbox_contains(bbox, tb)]
        gridline_paths = sum(cnt for (vb, cnt) in page_vector_boxes if _bbox_overlaps(bbox, vb))
        signals = build_chart_detection_signals(
            region_bbox=bbox, classification=cls,
            caption_terms=caption_terms, title_terms=title_terms,
            page_numeric=page_numeric, contained_texts=contained_texts,
            gridline_path_count=gridline_paths,
        )
        chart_like = bool(signals["promote"])
        if chart_like:
            region_type = "chart"
        elif cls is not None and LOGO_CLASS_RE.search(cls) is not None:
            region_type = "logo"
        else:
            region_type = "picture"
        covering_picture_present = covering_picture_present or region_type in ("chart", "picture")
        image = pic.get("image") if isinstance(pic.get("image"), dict) else {}
        has_embedded = bool(image.get("uri") or image.get("diagnostics_path"))
        payload: dict[str, Any] = {
            "confidence": pic.get("confidence"),
            "caption": pic.get("caption") if isinstance(pic.get("caption"), str) else None,
            "classification": cls,
            "hasEmbeddedImage": has_embedded,
            "bboxProblems": bprob,
            "provider": _provider_evidence(
                "docling", "classification", confidence=pic.get("confidence"),
                claims=[c for c in [f"class:{cls}" if cls else None,
                                    "chart_like" if chart_like else None,
                                    f"chart_detection:{signals['method']}" if chart_like else None,
                                    "embedded_image" if has_embedded else "needs_source_crop"] if c],
            ),
        }
        if region_type == "chart":
            payload["chart"] = _chart_metadata(cls, pic.get("caption"), signals=signals)
        staged.append((region_type, bbox, payload))

    # Dense vector clusters — conservative, bounded, deterministic.
    dense_count = 0
    for vec in vectors or []:
        paths = vec.get("paths")
        path_count = len(paths) if isinstance(paths, list) else 0
        if path_count < DENSE_VECTOR_MIN_PATHS:
            continue
        if covering_picture_present or not page_numeric:
            # A dense vector under a chart/picture crop or without numeric labels
            # is not independently treated as an unverified chart-like region.
            continue
        vbbox = _vector_bbox(vec, page_width, page_height)
        if vbbox is None:
            continue
        dense_count += 1
        if dense_count > MAX_DENSE_VECTOR_REGIONS:
            page_problems.append("dense_vector_regions_truncated")
            break
        staged.append(("vector-cluster", vbbox, {
            "confidence": vec.get("confidence"),
            "provider": _provider_evidence(
                "pymupdf", "vector", confidence=vec.get("confidence"),
                claims=[f"path_count:{path_count}", "numeric_labels_present"],
            ),
        }))

    # Text regions — block-level, referencing span evidence by bbox.
    for text in texts or []:
        if not isinstance(text.get("text"), str) or not text["text"].strip():
            continue
        bbox, bprob = normalize_bbox(_prov_bbox(text), page_width, page_height)
        if bbox is None:
            continue
        raw = text["text"]
        staged.append(("text", bbox, {
            "confidence": text.get("confidence"),
            "readingOrder": text.get("reading_order"),
            "textPayload": {
                "raw": raw,
                "normalizedNfc": normalize_nfc(raw),
                "exactTokens": raw.split(),
                "numericTokens": extract_numeric_tokens(raw),
                "punctuationTokens": extract_punctuation_tokens(raw),
                "spanIds": [],
                "label": text.get("label") if isinstance(text.get("label"), str) else None,
            },
            "provider": _provider_evidence("docling", "text", confidence=text.get("confidence")),
        }))

    # Canonical sort + per-(page,type) ordinal assignment → deterministic IDs.
    staged.sort(key=lambda s: _canonical_sort_key(s[0], s[1]))
    if len(staged) > MAX_REGIONS_PER_PAGE:
        page_problems.append("regions_truncated_to_limit")
        staged = staged[:MAX_REGIONS_PER_PAGE]

    ordinal_by_type: dict[str, int] = {}
    regions: list[dict] = []
    for region_type, bbox, payload in staged:
        ordinal_by_type[region_type] = ordinal_by_type.get(region_type, 0) + 1
        region = _base_region(global_page, page_id, region_type, bbox, ordinal_by_type[region_type])
        region["confidence"] = (
            float(payload["confidence"]) if isinstance(payload.get("confidence"), (int, float)) else None
        )
        if isinstance(payload.get("readingOrder"), int):
            region["readingOrder"] = payload["readingOrder"]
        if payload.get("table") is not None:
            region["table"] = payload["table"]
            if not payload["table"]["complete"]:
                region["problems"].append("table_topology_incomplete")
        if payload.get("chart") is not None:
            region["chart"] = payload["chart"]
        if payload.get("textPayload") is not None:
            region["text"] = payload["textPayload"]
        if payload.get("provider") is not None:
            region["providerEvidence"].append(payload["provider"])
        for bp in payload.get("bboxProblems") or []:
            region["problems"].append(f"bbox_{bp}")
        # A text region with a source crop is optional; every other type needs one.
        region["complete"] = region_type == "text" or region_type == "background"
        regions.append(region)

    # E3 — attach chart ⇢ child relationships + semantic labels (deterministic).
    assign_chart_relationships(regions)

    # W3 — read each chart's series from source geometry, where the evidence
    # supports it. Runs AFTER relationships because it needs the axis-tick child
    # regions that step attached. Never raises and never fabricates: a chart it
    # cannot read is left exactly as it was, at extractionState 'crop_only'.
    extract_chart_series(regions, vectors or [], page_width, page_height)

    return regions, page_problems


def _axis_tick_value(text: str) -> Optional[float]:
    """The number an axis tick label states, or None when it states none.

    Strips only presentation — currency symbols, thousands separators, a percent
    sign. It never rescales: a tick reading "50%" is the number 50 on an axis
    whose unit is percent, and inventing 0.5 here would silently change what
    every bar on that chart means.
    """
    s = (text or "").strip()
    if not AXIS_TICK_RE.match(s):
        return None
    cleaned = s.replace(",", "").replace("%", "").strip()
    for sym in ("$", "£", "€"):
        cleaned = cleaned.replace(sym, "")
    try:
        v = float(cleaned.strip())
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def extract_chart_series(
    regions: list[dict],
    vectors: list[dict],
    page_width: float,
    page_height: float,
) -> None:
    """Read each chart's series from the source geometry it was drawn with.

    The material was always here. `_page_vectors` ships one item per PyMuPDF
    drawing with its own rect and fill; `assign_chart_relationships` has already
    sorted the surrounding text into axis ticks and legend entries. What was
    missing was anyone pairing the two — so `structuredDataPath` stayed None and
    `extractionState` stayed 'crop_only' with a comment saying the engine could
    not extract series.

    The arithmetic lives in `chart_candidates` (pure, separately tested); this
    function's job is to assemble evidence in ONE coordinate space and to be
    honest about what it could not do. Every failure path leaves the chart
    untouched at 'crop_only', because a chart rendered as a picture is correct
    and a chart rebuilt from a bad read is not.

    In-place, deterministic, never raises.
    """
    charts = [r for r in regions if r.get("type") == "chart" and isinstance(r.get("bbox"), dict)]
    if not charts:
        return

    by_id = {r["id"]: r for r in regions if isinstance(r, dict) and r.get("id")}

    # Vectors arrive in PDF points; region bboxes are normalized page space.
    # Convert once, through the same helper the region path uses, so ticks,
    # chart bounds and bars are all measured in the same units — otherwise the
    # fitted scale is meaningless in a way no test on either side would catch.
    normalized_vectors: list[dict] = []
    for vec in vectors:
        vbbox = _vector_bbox(vec, page_width, page_height)
        if vbbox is None:
            continue
        normalized_vectors.append({
            "bbox": {
                "l": float(vbbox.get("x") or 0.0),
                "t": float(vbbox.get("y") or 0.0),
                "r": float(vbbox.get("x") or 0.0) + float(vbbox.get("width") or 0.0),
                "b": float(vbbox.get("y") or 0.0) + float(vbbox.get("height") or 0.0),
            },
            "fill": _first_path_fill(vec),
        })

    for chart in charts:
        try:
            _extract_one_chart_series(chart, by_id, normalized_vectors)
        except Exception as exc:  # pragma: no cover - defensive
            meta = chart.get("chart")
            if isinstance(meta, dict):
                meta.setdefault("problems", []).append(f"series_extraction_failed:{type(exc).__name__}")


def _first_path_fill(vec: dict) -> Optional[Any]:
    """A drawing's fill, taken from its first path. `_page_vectors` emits one
    path per item, so there is nothing to reconcile."""
    paths = vec.get("paths")
    if isinstance(paths, list) and paths and isinstance(paths[0], dict):
        return paths[0].get("fill")
    return vec.get("fill")


def _extract_one_chart_series(chart: dict, by_id: dict, normalized_vectors: list[dict]) -> None:
    meta = chart.get("chart")
    if not isinstance(meta, dict):
        return
    chart_type = str(meta.get("chartType") or "unknown")
    cbbox = chart["bbox"]

    # Only bar charts are read today. A pie's value lives in its wedge sweep
    # angle, which means parsing arc commands out of path data — real work that
    # does not exist yet, and guessing at it would be exactly the failure this
    # module is built to avoid. Everything else stays a crop, honestly.
    if chart_type != "bar":
        meta.setdefault("problems", []).append(f"series_extraction_unsupported:{chart_type}")
        return

    cx0 = float(cbbox.get("x") or 0.0)
    cy0 = float(cbbox.get("y") or 0.0)
    cw = float(cbbox.get("width") or 0.0)
    ch = float(cbbox.get("height") or 0.0)
    if cw <= 0 or ch <= 0:
        return

    # Split the axis-tick children by which edge band they sit in. A vertical
    # bar chart carries its VALUE scale on the left; a horizontal one carries it
    # along the bottom. Ticks that are not numeric are categories, not scale.
    left_band = cx0 + cw * CHART_EDGE_BAND
    bottom_band = cy0 + ch * (1.0 - CHART_EDGE_BAND)
    y_ticks: list[AxisTick] = []
    x_ticks: list[AxisTick] = []
    for rid in meta.get("axisLabelRegionIds") or []:
        child = by_id.get(rid)
        if not isinstance(child, dict) or not isinstance(child.get("bbox"), dict):
            continue
        raw = ((child.get("text") or {}).get("raw") or "").strip()
        value = _axis_tick_value(raw)
        if value is None:
            continue
        ccx, ccy = _bbox_center(child["bbox"])
        if ccx <= left_band:
            y_ticks.append(AxisTick(position=ccy, value=value))
        elif ccy >= bottom_band:
            x_ticks.append(AxisTick(position=ccx, value=value))

    horizontal = False
    scale = fit_axis_scale(y_ticks)
    ticks_used = y_ticks
    if scale is None:
        scale = fit_axis_scale(x_ticks)
        ticks_used = x_ticks
        horizontal = scale is not None
    if scale is None:
        meta.setdefault("problems", []).append("axis_scale_underdetermined")
        return

    region_rect = (cx0, cy0, cx0 + cw, cy0 + ch)
    category_labels = [
        lbl for lbl in (meta.get("axisLabels") or [])
        if _axis_tick_value(lbl) is None
    ]
    series = extract_bar_series(
        normalized_vectors, region_rect, scale,
        labels=category_labels or None,
        horizontal=horizontal,
    )
    if not series:
        meta.setdefault("problems", []).append("no_bars_extracted")
        return

    # Everything the arbitration layer needs to decide, including the evidence
    # that could veto this. Reporting a poor fit is the whole point: a scale
    # that did not fit is information, not something to hide behind a number.
    accounted = [str(t.value) for t in ticks_used] + list(meta.get("legendText") or [])
    numeric_raw = [
        n.get("raw") for n in (meta.get("numericValues") or [])
        if isinstance(n, dict) and n.get("raw")
    ] or [str(n) for n in (meta.get("numericValues") or []) if not isinstance(n, dict)]

    meta["structuredSeries"] = [s.as_dict() for s in series]
    meta["seriesCount"] = 1
    meta["categoryCount"] = len(series)
    meta["axisScale"] = scale.as_dict()
    meta["smallestTickInterval"] = smallest_tick_interval(ticks_used)
    meta["unaccountedNumericTokens"] = account_numeric_tokens(numeric_raw, accounted)
    meta["chartOrientation"] = "horizontal" if horizontal else "vertical"
    # 'structured_partial' rather than 'complete': the numbers were read, and
    # whether they may be TRUSTED is the arbitration layer's call, not this
    # module's. Nothing here promotes a chart to native rendering.
    meta["extractionState"] = "structured_partial"
    meta["extractionContract"] = CHART_CANDIDATE_CONTRACT_VERSION


def _chart_metadata(cls: Optional[str], caption: Optional[str], *, signals: Optional[dict] = None) -> dict:
    chart_type = "unknown"
    if isinstance(cls, str):
        for name in ("bar", "line", "area", "pie", "scatter"):
            if name in cls:
                chart_type = name
                break
    return {
        "version": SOURCE_CHART_METADATA_VERSION,
        "chartType": chart_type,
        "caption": caption if isinstance(caption, str) else None,
        "structuredDataPath": None,
        "seriesCount": None,
        "categoryCount": None,
        "axisLabelRegionIds": [],
        "legendRegionIds": [],
        # The current production engine cannot extract series; crop_only is the
        # expected, honest state once a crop is attached.
        "extractionState": "crop_only",
        # ── E3 additive fields (backward compatible; consumers may ignore) ──
        # Semantic metadata lives BESIDE the rendered crop; it never replaces it.
        "detectionScore": (signals or {}).get("score"),
        "detectionMethod": (signals or {}).get("method", "classification"),
        "detectionSignals": signals if isinstance(signals, dict) else None,
        "axisLabels": [],       # text of axis-tick child regions (source truth)
        "legendText": [],       # text of legend child regions
        "seriesLabels": [],     # distinct legend labels = series names
        "numericValues": [],    # numeric tokens found within the chart region
        # 'crop-preferred' until the render plan confirms a durable crop exists;
        # the plan may refine to 'chart-crop' or 'containment-fallback'.
        "renderMode": "crop-preferred",
        "problems": [],
    }


# ── E3 — chart relationships + semantic labels (deterministic) ──────────────


def _region_text_align_axis(raw: str, bbox: dict, chart_bbox: dict) -> str:
    """Classify a chart-contained text region as 'axis' | 'legend' | 'caption'
    | 'other' from its position + shape (pure geometry, no NLP)."""
    text = (raw or "").strip()
    cx, cy = _bbox_center(bbox)
    cw = float(chart_bbox.get("width") or 0.0)
    ch = float(chart_bbox.get("height") or 0.0)
    cx0 = float(chart_bbox.get("x") or 0.0)
    cy0 = float(chart_bbox.get("y") or 0.0)
    left_band = cx0 + cw * CHART_EDGE_BAND
    bottom_band = cy0 + ch * (1.0 - CHART_EDGE_BAND)
    if _is_axis_tick(text) and (cx <= left_band or cy >= bottom_band):
        return "axis"
    if text and len(text) <= CHART_LEGEND_MAX_CHARS and not _is_axis_tick(text):
        return "legend"
    return "other"


def assign_chart_relationships(regions: list[dict]) -> None:
    """Attach parent/child relationships from each chart to the source regions it
    geometrically contains, and populate the chart's semantic label lists.

    Charts MAY own text/legend/axis/vector/picture children. All relationships are
    kept (source truth); the render plan later renders only the parent crop and
    suppresses the children. Deterministic + in-place. Nested charts: a smaller
    chart contained by a larger one becomes the larger chart's child, so only the
    outermost chart is rendered. A child is attached to its SMALLEST containing
    chart so nesting is respected.
    """
    charts = [r for r in regions if r.get("type") == "chart" and isinstance(r.get("bbox"), dict)]
    if not charts:
        return
    # Smallest-area charts first so a child binds to its innermost container.
    def _area(r: dict) -> float:
        b = r["bbox"]
        return float(b.get("width") or 0.0) * float(b.get("height") or 0.0)

    charts_by_area = sorted(charts, key=_area)
    chart_ids = {c["id"] for c in charts}

    for region in regions:
        if region.get("type") == "background" or not isinstance(region.get("bbox"), dict):
            continue
        if region.get("relationships", {}).get("parentRegionId"):
            continue  # already owned (deterministic first-wins by smallest area)
        for chart in charts_by_area:
            if chart["id"] == region["id"]:
                continue
            if not bbox_contains(chart["bbox"], region["bbox"]):
                continue
            # Bind child ⇢ chart.
            region.setdefault("relationships", {})
            region["relationships"]["parentRegionId"] = chart["id"]
            rel = chart.setdefault("relationships", {})
            rel.setdefault("childRegionIds", [])
            if region["id"] not in rel["childRegionIds"]:
                rel["childRegionIds"].append(region["id"])
            _classify_chart_child(chart, region)
            break

    # Freeze deterministic ordering of the populated lists.
    for chart in charts:
        meta = chart.get("chart") or {}
        for key in ("axisLabelRegionIds", "legendRegionIds", "axisLabels", "legendText", "seriesLabels", "numericValues"):
            if isinstance(meta.get(key), list):
                # de-dup preserving first-seen order for label text lists.
                seen: set = set()
                out = []
                for v in meta[key]:
                    marker = v
                    if marker in seen:
                        continue
                    seen.add(marker)
                    out.append(v)
                meta[key] = out
        rel = chart.get("relationships") or {}
        for key in ("childRegionIds", "captionRegionIds", "labelRegionIds"):
            if isinstance(rel.get(key), list):
                # keep insertion order but drop any accidental self/dupe references.
                rel[key] = [rid for i, rid in enumerate(rel[key])
                            if rid != chart["id"] and rid not in rel[key][:i]]


def _classify_chart_child(chart: dict, child: dict) -> None:
    """Record a child region under the right chart-metadata bucket (in-place)."""
    meta = chart.setdefault("chart", _chart_metadata(None, None))
    rel = chart.setdefault("relationships", {})
    ctype = child.get("type")
    cid = child["id"]
    if ctype == "text":
        payload = child.get("text") or {}
        raw = payload.get("raw") or ""
        label = payload.get("label")
        kind = _region_text_align_axis(raw, child["bbox"], chart["bbox"])
        numeric = payload.get("numericTokens") or []
        if label == "caption":
            rel.setdefault("captionRegionIds", [])
            if cid not in rel["captionRegionIds"]:
                rel["captionRegionIds"].append(cid)
            if raw and not meta.get("caption"):
                meta["caption"] = raw
        elif kind == "axis":
            meta.setdefault("axisLabelRegionIds", [])
            meta["axisLabelRegionIds"].append(cid)
            if raw:
                meta.setdefault("axisLabels", []).append(raw.strip())
        elif kind == "legend":
            meta.setdefault("legendRegionIds", [])
            meta["legendRegionIds"].append(cid)
            if raw:
                meta.setdefault("legendText", []).append(raw.strip())
                meta.setdefault("seriesLabels", []).append(raw.strip())
        else:
            rel.setdefault("labelRegionIds", [])
            rel["labelRegionIds"].append(cid)
        for tok in numeric:
            raw_tok = tok.get("raw") if isinstance(tok, dict) else None
            if isinstance(raw_tok, str) and raw_tok:
                meta.setdefault("numericValues", []).append(raw_tok)
    # Non-text children (vector-cluster, picture, logo, nested chart) are visual
    # children: kept in childRegionIds only, rendered by the parent crop.


# ── E3 — chart render plan + preservation metrics (chart-preservation-v1) ────


def _descendant_region_ids(chart_id: str, by_parent: dict[str, list[str]]) -> list[str]:
    """All region IDs transitively owned by a chart (children, nested charts'
    children …), in deterministic BFS order."""
    out: list[str] = []
    seen: set[str] = set()
    queue = list(by_parent.get(chart_id, []))
    while queue:
        rid = queue.pop(0)
        if rid in seen:
            continue
        seen.add(rid)
        out.append(rid)
        queue.extend(by_parent.get(rid, []))
    return out


def build_chart_render_plan(regions: list[dict]) -> dict:
    """Deterministic per-page chart render plan + preservation metrics.

    Every chart region resolves to exactly one render mode:
      - 'chart-crop'            a durable, non-blank source crop is rendered as a
                                single locked visual object; its child regions are
                                suppressed to prevent double-rendering.
      - 'containment-fallback'  no usable crop → defer to E0 containment (source
                                raster / hybrid). NEVER a semantic redraw.

    The plan carries the child region IDs each rendered chart suppresses and the
    page-level metrics the visual-quality report consumes. Pure; no I/O.
    """
    region_ids = {r["id"] for r in regions if isinstance(r.get("id"), str)}
    by_parent: dict[str, list[str]] = {}
    for r in regions:
        parent = (r.get("relationships") or {}).get("parentRegionId")
        if parent:
            by_parent.setdefault(parent, []).append(r["id"])

    charts = [r for r in regions if r.get("type") == "chart"]
    chart_plans: list[dict] = []
    mode_counts = {"chart-crop": 0, "containment-fallback": 0}
    suppressed_total = 0
    complete_charts = 0
    charts_with_crop = 0
    suppression_ok = 0

    for chart in charts:
        crop = chart.get("sourceCrop") or {}
        has_crop = bool(crop.get("path")) and bool(crop.get("sha256"))
        blank = "crop_appears_blank" in (chart.get("problems") or [])
        renderable = has_crop and not blank
        mode = "chart-crop" if renderable else "containment-fallback"
        mode_counts[mode] += 1
        if has_crop:
            charts_with_crop += 1
        if renderable:
            complete_charts += 1

        suppressed = _descendant_region_ids(chart["id"], by_parent) if renderable else []
        # Suppression is "successful" when every suppressed id is a real region on
        # this page (no orphan/unknown reference). A rendered chart with no
        # children is trivially successful.
        orphans = [rid for rid in suppressed if rid not in region_ids]
        if mode == "chart-crop":
            if not orphans:
                suppression_ok += 1
        suppressed_total += len(suppressed)

        meta = chart.get("chart") or {}
        # Reflect the resolved mode back onto the chart metadata (source truth).
        if isinstance(chart.get("chart"), dict):
            chart["chart"]["renderMode"] = mode
        child_ids = list((chart.get("relationships") or {}).get("childRegionIds") or [])
        chart_plans.append({
            "regionId": chart["id"],
            "pageNumber": chart.get("pageNumber"),
            "bbox": chart.get("bbox"),
            "renderMode": mode,
            "hasCrop": has_crop,
            "cropBlank": blank,
            "cropPath": crop.get("path"),
            "cropSha256": crop.get("sha256"),
            "cropDpi": crop.get("sourceDpi"),
            "childRegionIds": child_ids,
            "suppressedChildRegionIds": suppressed,
            "orphanSuppressedRegionIds": orphans,
            "chartType": meta.get("chartType"),
            "detectionMethod": meta.get("detectionMethod"),
            "detectionScore": meta.get("detectionScore"),
            "complete": renderable,
        })

    chart_count = len(charts)
    rendered = mode_counts["chart-crop"]

    def _ratio(numerator: int, denominator: int) -> Optional[float]:
        if denominator <= 0:
            return None
        return round(numerator / denominator, 4)

    metrics = {
        "chartRegionCount": chart_count,
        "chartCropAvailability": _ratio(charts_with_crop, chart_count),
        "chartCompleteness": _ratio(complete_charts, chart_count),
        "chartSuppressionSuccess": _ratio(suppression_ok, rendered),
        "chartRenderModeCounts": dict(mode_counts),
        "suppressedRegionCount": suppressed_total,
    }
    problems: list[str] = []
    for plan in chart_plans:
        if plan["renderMode"] == "containment-fallback":
            problems.append(f"chart_crop_unavailable:{plan['regionId']}")
        if plan["orphanSuppressedRegionIds"]:
            problems.append(f"chart_suppression_orphan:{plan['regionId']}")
    return {
        "version": CHART_PRESERVATION_VERSION,
        "charts": chart_plans,
        "metrics": metrics,
        "problems": problems,
        "complete": chart_count == 0 or (rendered == chart_count and not problems),
    }


def _vector_bbox(vec: dict, page_width: float, page_height: float) -> Optional[dict]:
    b = vec.get("bbox")
    if isinstance(b, dict) and all(k in b for k in ("l", "t", "r", "b")):
        bbox, _ = normalize_bbox(b, page_width, page_height)
        return bbox
    view = vec.get("viewBox")
    if isinstance(view, str):
        parts = view.split()
        if len(parts) == 4:
            try:
                x, y, w, h = (float(p) for p in parts)
                bbox, _ = normalize_bbox([x, y, x + w, y + h], page_width, page_height)
                return bbox
            except ValueError:
                return None
    return None


# ── Crop attachment (Phase 6) ───────────────────────────────────────────────


def attach_crop(region: dict, *, path: Optional[str], sha256: Optional[str], mime: Optional[str],
                width_px: Optional[int], height_px: Optional[int], source_dpi: Optional[int],
                padding_pt: float, foreground: Optional[dict] = None) -> None:
    """Attach durable crop evidence (a private object PATH, never a signed/data URL)
    to a region and update its completeness."""
    if path is not None and not is_safe_artifact_path(path):
        region["problems"].append("crop_path_unsafe")
        region["complete"] = False
        return
    region["sourceCrop"] = {
        "path": path,
        "sha256": sha256,
        "mime": mime,
        "widthPx": int(width_px) if isinstance(width_px, int) else None,
        "heightPx": int(height_px) if isinstance(height_px, int) else None,
        "sourceDpi": int(source_dpi) if isinstance(source_dpi, int) else None,
        "paddingPt": _round2(padding_pt),
    }
    if foreground is not None:
        region["visual"] = {
            "foregroundOccupancy": foreground.get("foregroundRatio"),
            "edgeDensity": foreground.get("edgeDensity"),
            "dominantColors": foreground.get("dominantColors") or [],
        }
        occ = foreground.get("foregroundRatio")
        if region["type"] in ("chart", "picture", "table") and isinstance(occ, (int, float)) and occ < 0.005:
            region["problems"].append("crop_appears_blank")
    if region["type"] in CROP_REQUIRED_TYPES:
        region["complete"] = bool(path) and bool(sha256) and "crop_appears_blank" not in region["problems"] \
            and (region.get("table") is None or region["table"]["complete"])


def is_safe_artifact_path(path: Any) -> bool:
    """Reject traversal, absolute paths and external URLs in durable-path fields."""
    if not isinstance(path, str) or not path:
        return False
    if path.startswith("/") or path.startswith("\\"):
        return False
    if ".." in path.split("/"):
        return False
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", path):
        return False
    if path.startswith("data:"):
        return False
    return True


def crop_bbox_pixels(bbox: dict, page_height: float, dpi: int, padding_pt: float,
                     page_width: float) -> Optional[dict]:
    """Deterministic pixel crop rectangle for a region bbox at `dpi`, with padding
    clamped to the page. Returns pixel {left,top,width,height} (top-left origin)."""
    if not isinstance(bbox, dict):
        return None
    x = float(bbox.get("x") or 0.0)
    y = float(bbox.get("y") or 0.0)
    w = float(bbox.get("width") or 0.0)
    h = float(bbox.get("height") or 0.0)
    if w <= 0 or h <= 0:
        return None  # a zero-area source region is never a valid crop
    x0 = max(0.0, x - padding_pt)
    y0 = max(0.0, y - padding_pt)
    x1 = min(page_width, x + w + padding_pt)
    y1 = min(page_height, y + h + padding_pt)
    if x1 <= x0 or y1 <= y0:
        return None
    scale = dpi / 72.0
    return {
        "left": int(round(x0 * scale)),
        "top": int(round(y0 * scale)),
        "width": max(1, int(round((x1 - x0) * scale))),
        "height": max(1, int(round((y1 - y0) * scale))),
        "paddingPt": padding_pt,
    }


# ── Foreground / occupancy evidence (Phase 8) ───────────────────────────────


def build_foreground_summary(png_bytes: Optional[bytes], *, threshold: int = 245,
                             tile_rows: int = 8, tile_cols: int = 8) -> Optional[dict]:
    """Bounded page/region visual summary from PNG bytes using Pillow (lazy import).

    Returns None when Pillow is unavailable or bytes cannot be decoded — the
    caller records a problem rather than fabricating occupancy. Never returns a
    raw bitmap; only a bounded tile grid, ratio, bounds and edge density."""
    if not png_bytes:
        return None
    try:
        from PIL import Image  # lazy: keeps the module importable without Pillow
        import io as _io
    except Exception:
        return None
    tile_rows = max(1, min(int(tile_rows), MAX_TILE_GRID))
    tile_cols = max(1, min(int(tile_cols), MAX_TILE_GRID))
    try:
        img = Image.open(_io.BytesIO(png_bytes)).convert("L")
    except Exception:
        return None
    w, h = img.size
    if w <= 0 or h <= 0:
        return None
    px = img.load()
    non_white = 0
    min_x, min_y, max_x, max_y = w, h, -1, -1
    tile_counts = [0] * (tile_rows * tile_cols)
    tile_totals = [0] * (tile_rows * tile_cols)
    edge_hits = 0
    edge_samples = 0
    prev_row = None
    for yy in range(h):
        row_vals = []
        for xx in range(w):
            v = px[xx, yy]
            row_vals.append(v)
            ti = min(tile_rows - 1, yy * tile_rows // h)
            tj = min(tile_cols - 1, xx * tile_cols // w)
            tile_totals[ti * tile_cols + tj] += 1
            if v < threshold:
                non_white += 1
                tile_counts[ti * tile_cols + tj] += 1
                if xx < min_x:
                    min_x = xx
                if yy < min_y:
                    min_y = yy
                if xx > max_x:
                    max_x = xx
                if yy > max_y:
                    max_y = yy
            if xx > 0:
                edge_samples += 1
                if abs(v - row_vals[xx - 1]) > 40:
                    edge_hits += 1
        if prev_row is not None:
            for xx in range(w):
                edge_samples += 1
                if abs(row_vals[xx] - prev_row[xx]) > 40:
                    edge_hits += 1
        prev_row = row_vals

    total = float(w * h)
    ratio = round(non_white / total, 5) if total else 0.0
    occupancy = [
        round(tile_counts[i] / tile_totals[i], 4) if tile_totals[i] else 0.0
        for i in range(len(tile_counts))
    ]
    bounds = None
    if max_x >= min_x and max_y >= min_y:
        bounds = {"x": min_x, "y": min_y, "width": max_x - min_x + 1, "height": max_y - min_y + 1}
    edge_density = round(edge_hits / edge_samples, 5) if edge_samples else 0.0
    return {
        "version": SOURCE_FOREGROUND_SUMMARY_VERSION,
        "threshold": threshold,
        "foregroundRatio": ratio,
        "nonWhiteBounds": bounds,
        "tileRows": tile_rows,
        "tileCols": tile_cols,
        "tileOccupancy": occupancy,
        "edgeDensity": edge_density,
    }


# ── Page scene + scene graph assembly (Phase 2) ─────────────────────────────


def assemble_page_scene(
    *,
    global_page: int,
    page_id: str,
    width_pt: float,
    height_pt: float,
    rotation: int,
    regions: list[dict],
    source_raster: Optional[dict],
    foreground: Optional[dict],
    regions_path: str,
    source_spans_path: Optional[str],
    source_chunk: Optional[dict],
    problems: Optional[list[str]] = None,
    chart_preservation: Optional[dict] = None,
) -> dict:
    problems = list(problems or [])
    rot = rotation if rotation in (0, 90, 180, 270) else 0
    region_ids = [r["id"] for r in regions]
    if len(set(region_ids)) != len(region_ids):
        problems.append("duplicate_region_ids")
    critical = [r for r in regions if r["type"] in CROP_REQUIRED_TYPES]
    missing_crop = [r["id"] for r in critical if not (r.get("sourceCrop") or {}).get("path")]
    if missing_crop:
        problems.append("critical_regions_missing_crop")
    complete = (
        not problems
        and all(r.get("complete") for r in critical)
        and (source_raster is not None and bool(source_raster.get("path")))
    )
    # E3 — the chart preservation plan is additive page-artifact metadata; it
    # never changes page completeness (E0 still owns the fallback decision).
    if chart_preservation is None:
        chart_preservation = build_chart_render_plan(regions)
    scene = {
        "version": SOURCE_SCENE_GRAPH_VERSION,
        "pageId": page_id,
        "pageNumber": global_page,
        "sourceChunk": source_chunk,
        "geometry": {"widthPt": _round2(width_pt), "heightPt": _round2(height_pt), "rotation": rot},
        "sourceRaster": source_raster or {
            "path": None, "sha256": None, "widthPx": None, "heightPx": None, "dpi": None, "mime": None,
        },
        "foreground": foreground,
        "sourceSpansPath": source_spans_path,
        "regionsPath": regions_path,
        "regionCount": len(regions),
        "criticalRegionCount": len(critical),
        "chartRegionCount": chart_preservation.get("metrics", {}).get("chartRegionCount", 0),
        "chartPreservation": chart_preservation,
        "regionIds": region_ids,
        "problems": sorted(set(problems)),
        "complete": complete,
    }
    return scene


def assemble_scene_graph(
    *,
    source_sha256: Optional[str],
    page_count: int,
    page_scenes: list[dict],
    engine: str,
    engine_version: str,
    lane_policy_version: Optional[str],
    generated_at: str,
) -> dict:
    problems: list[str] = []
    all_region_ids: list[str] = []
    for scene in page_scenes:
        all_region_ids.extend(scene.get("regionIds") or [])
    if len(set(all_region_ids)) != len(all_region_ids):
        problems.append("duplicate_region_ids_across_document")
    page_numbers = sorted(int(s["pageNumber"]) for s in page_scenes)
    if page_numbers:
        expected = list(range(page_numbers[0], page_numbers[0] + len(page_numbers)))
        if page_numbers != expected:
            problems.append("page_numbers_not_continuous")
    if len(set(page_numbers)) != len(page_numbers):
        problems.append("duplicate_page_numbers")
    complete = not problems and all(s.get("complete") for s in page_scenes) and len(page_scenes) == page_count
    return {
        "version": SOURCE_SCENE_GRAPH_VERSION,
        "source": {"sourceSha256": source_sha256, "mime": "application/pdf", "pageCount": int(page_count)},
        "coordinateSpace": {
            "units": "pdf-point", "origin": "top-left", "xIncreases": "right", "yIncreases": "down",
        },
        "extraction": {
            "engine": engine,
            "engineVersion": engine_version,
            "lanePolicyVersion": lane_policy_version,
            "artifactContractVersion": PAGE_ARTIFACT_CONTRACT_VERSION,
            "generatedAt": generated_at,
        },
        "pages": page_scenes,
        "problems": sorted(set(problems)),
        "complete": complete,
    }


# ── Validation (Phase 10) ───────────────────────────────────────────────────


def validate_scene_graph(scene: Any) -> dict:
    """Structured, non-throwing validation. Returns {ok, state, problems}. Never
    coerces an invalid structure into a valid empty scene graph."""
    problems: list[str] = []
    if not isinstance(scene, dict):
        return {"ok": False, "state": "invalid_v2", "problems": ["scene_not_object"]}
    version = scene.get("version")
    if version != SOURCE_SCENE_GRAPH_VERSION:
        return {"ok": False, "state": "unknown_version", "problems": [f"unknown_version:{version}"]}

    pages = scene.get("pages")
    if not isinstance(pages, list):
        return {"ok": False, "state": "invalid_v2", "problems": ["pages_not_list"]}

    seen_region_ids: set[str] = set()
    seen_page_ids: set[str] = set()
    for scene_page in pages:
        problems.extend(_validate_page_scene_inner(scene_page, seen_region_ids, seen_page_ids))

    ok = len(problems) == 0
    return {"ok": ok, "state": "valid_v2" if ok else "invalid_v2", "problems": problems}


def validate_page_scene(scene: Any) -> dict:
    problems = _validate_page_scene_inner(scene, set(), set())
    ok = len(problems) == 0
    return {"ok": ok, "state": "valid_v2" if ok else "invalid_v2", "problems": problems}


def _validate_page_scene_inner(scene: Any, seen_region_ids: set, seen_page_ids: set) -> list[str]:
    problems: list[str] = []
    if not isinstance(scene, dict):
        return ["page_scene_not_object"]
    if scene.get("version") != SOURCE_SCENE_GRAPH_VERSION:
        problems.append("page_scene_bad_version")
    page_id = scene.get("pageId")
    if isinstance(page_id, str):
        if page_id in seen_page_ids:
            problems.append("duplicate_page_id")
        seen_page_ids.add(page_id)
    page_no = scene.get("pageNumber")
    ids = scene.get("regionIds") or []
    for rid in ids:
        if rid in seen_region_ids:
            problems.append(f"duplicate_region_id:{rid}")
        seen_region_ids.add(rid)
    # Inline region validation when present (regions live in a sibling file, so a
    # scene may legitimately carry only regionIds).
    for region in scene.get("regions") or []:
        problems.extend(_validate_region(region, page_no))
    return problems


def _validate_region(region: Any, page_no: Any) -> list[str]:
    problems: list[str] = []
    if not isinstance(region, dict):
        return ["region_not_object"]
    if region.get("version") != SOURCE_REGION_VERSION:
        problems.append("region_bad_version")
    rtype = region.get("type")
    bbox = region.get("bbox")
    if not isinstance(bbox, dict):
        problems.append("region_bbox_missing")
    else:
        for k in ("x", "y", "width", "height"):
            v = bbox.get(k)
            if not isinstance(v, (int, float)) or not math.isfinite(float(v)):
                problems.append(f"region_bbox_{k}_non_finite")
            elif k in ("width", "height") and float(v) <= 0:
                problems.append(f"region_bbox_{k}_non_positive")
            elif k in ("x", "y") and float(v) < 0:
                problems.append(f"region_bbox_{k}_negative")
    if region.get("pageNumber") != page_no and page_no is not None:
        problems.append("region_page_mismatch")
    crop = region.get("sourceCrop") or {}
    path = crop.get("path")
    if path is not None and not is_safe_artifact_path(path):
        problems.append("region_crop_path_unsafe")
    sha = crop.get("sha256")
    if sha is not None and not re.fullmatch(r"[0-9a-f]{64}", str(sha)):
        problems.append("region_crop_sha_invalid")
    if rtype in CROP_REQUIRED_TYPES and not path:
        problems.append("critical_region_missing_crop")
    conf = region.get("confidence")
    if conf is not None and (not isinstance(conf, (int, float)) or not math.isfinite(float(conf))):
        problems.append("region_confidence_non_finite")
    table = region.get("table")
    if isinstance(table, dict):
        problems.extend(_validate_table(table))
    return problems


def _validate_table(table: dict) -> list[str]:
    problems: list[str] = []
    num_rows = table.get("numRows")
    num_cols = table.get("numCols")
    for cell in table.get("cells") or []:
        if not isinstance(cell, dict):
            continue
        row, col = cell.get("row"), cell.get("col")
        rspan, cspan = cell.get("rowSpan", 1), cell.get("colSpan", 1)
        if isinstance(row, int) and isinstance(rspan, int) and isinstance(num_rows, int) and num_rows > 0:
            if row < 0 or row + rspan > num_rows:
                problems.append("table_cell_row_out_of_bounds")
        if isinstance(col, int) and isinstance(cspan, int) and isinstance(num_cols, int) and num_cols > 0:
            if col < 0 or col + cspan > num_cols:
                problems.append("table_cell_col_out_of_bounds")
    return problems

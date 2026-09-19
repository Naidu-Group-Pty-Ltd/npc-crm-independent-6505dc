"""source-typography-evidence-v1 + source-font-identity-v1 + typography-run-contract-v1
— PDF Extraction V3 · Package E5 (pure, deterministic).

Builds the immutable SOURCE typography evidence for a page: per-run raw Unicode
(never lossy-normalized), a separate NFC comparison field, code points, glyph
evidence, source font identity, source metrics/geometry, exact punctuation and
numeric tokens, a critical-content classification and a source-crop reference.

DESIGN CONTRACT
- Pure + deterministic. Importing this module MUST NOT initialise Docling models,
  open the network or touch the filesystem. It reuses `source_scene_graph`
  (also pure) for the shared FNV-1a hash, bbox normalisation and token evidence,
  so run IDs are byte-identical to the TypeScript consumer.
- SOURCE CONTENT AND SOURCE GLYPH IDENTITY OUTRANK EDITABILITY. Raw source text
  is preserved exactly; a search-normalized field may coexist but never becomes
  the visible text. Punctuation / glyph identity is content integrity — never
  normalized into a visually-similar ASCII character.
- Never invents Unicode for an unmapped glyph. Glyph identity and Unicode mapping
  are kept separate; an unmapped glyph is marked, not guessed.
- No signed URLs, secrets, or raw source paragraphs leave through logs. Problems
  carry bounded codes/counts only.

`font_assets.py` handles font-binary discovery/validation; this module produces
run + identity evidence. `typographyFidelity.pure.ts` evaluates + arbitrates.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Optional

import source_scene_graph as ssg

# ── Contract versions ───────────────────────────────────────────────────────

SOURCE_TYPOGRAPHY_EVIDENCE_VERSION = "source-typography-evidence-v1"
SOURCE_FONT_IDENTITY_VERSION = "source-font-identity-v1"
TYPOGRAPHY_RUN_CONTRACT_VERSION = "typography-run-contract-v1"

# ── Bounded limits (Phase 37) ───────────────────────────────────────────────

MAX_TYPOGRAPHY_RUNS_PER_PAGE = 4000
MAX_GLYPHS_PER_RUN = 4000
MAX_RUN_TEXT_LEN = 20000
# Aggregate limits prevent individually valid runs from multiplying into an
# unbounded in-memory page artifact before JSON serialization.
MAX_TEXT_CODEPOINTS_PER_PAGE = 100000
MAX_GLYPH_EVIDENCE_PER_PAGE = 20000

# ── Extended punctuation lexicon (E5 — superset of E1 `_PUNCT_MAP`) ──────────
# Distinguishes visually-similar characters whose identity is CONTENT for
# financial/legal/analytical documents. Built from explicit code points so a
# normal space (U+0020) is NEVER treated as punctuation and the space variants
# stay distinct. Never collapse these to ASCII.

_E5_PUNCT_MAP = {
    "–": "en-dash",
    "—": "em-dash",
    "−": "minus",
    "→": "arrow",
    "←": "arrow",
    "↔": "arrow",
    "×": "multiplication",
    "•": "bullet",
    "·": "middle-dot",
    " ": "non-breaking-space",
    " ": "narrow-no-break-space",
    " ": "figure-space",
    " ": "thin-space",
    " ": "punctuation-space",
    "­": "soft-hyphen",
    "’": "typographic-apostrophe",
    "‘": "left-single-quote",
    "“": "left-double-quote",
    "”": "right-double-quote",
    "…": "ellipsis",
    "°": "degree",
    "″": "double-prime",
    "′": "prime",
    "§": "section-sign",
    "™": "trademark",
    "®": "registered",
    "©": "copyright",
    "²": "superscript-two",
    "³": "superscript-three",
    "¹": "superscript-one",
}
_HYPHEN = "-"

# Characters whose *identity* is financially/legally critical (a change is a hard
# defect). Range separators, currency, math signs, superscripts, section signs.
CRITICAL_PUNCT_KINDS = frozenset({
    "en-dash", "em-dash", "minus", "multiplication", "arrow", "degree",
    "section-sign", "superscript-two", "superscript-three", "superscript-one",
    "non-breaking-space", "narrow-no-break-space",
})

# GLYPH<n> style placeholders produced when a ToUnicode map is missing.
_GLYPH_PLACEHOLDER_RE = re.compile(r"GLYPH<\s*\d+\s*>|glyph<\s*\d+\s*>|�|\x00|￾")

_SUBSET_PREFIX_RE = re.compile(r"^([A-Z]{6})\+")

# Critical-content lexicon (deterministic classification only).
_FINANCIAL_RE = re.compile(r"[$£€¥]|\d[\d,]*\.?\d*\s*%|\bAUD\b|\bp\.?a\.?\b|\bLVR\b|\byield\b", re.I)
_LEGAL_RE = re.compile(r"disclaimer|liabilit|warrant|copyright|©|all rights reserved|indemnif|jurisdiction|§", re.I)


# ── Extended punctuation extraction (Phase 4/16) ────────────────────────────


def extract_punctuation_tokens_e5(text: str) -> list[dict]:
    """Punctuation evidence using the extended E5 lexicon. Records the SOURCE
    character exactly; never maps a distinct character to a similar ASCII one."""
    out: list[dict] = []
    seen: set[str] = set()
    for ch in text or "":
        kind = _E5_PUNCT_MAP.get(ch)
        if kind is None and ch == _HYPHEN:
            kind = "hyphen"
        if kind is None:
            continue
        marker = f"{ch}:{kind}"
        if marker in seen:
            continue
        seen.add(marker)
        out.append({"raw": ch, "kind": kind, "critical": kind in CRITICAL_PUNCT_KINDS})
    return out


def search_normalized(text: str) -> str:
    """A SEPARATE search-normalized string (NFKC + folded dashes/spaces). It may
    coexist for search only and MUST NOT become the visible source text."""
    if not isinstance(text, str):
        return ""
    n = unicodedata.normalize("NFKC", text)
    # Fold dash-likes to a hyphen and exotic spaces to a normal space FOR SEARCH.
    n = re.sub(r"[‐-―−]", "-", n)
    n = re.sub(r"[      ]", " ", n)
    return n


# ── Unmapped-glyph detection (Phase 4) ──────────────────────────────────────


def count_unmapped_glyphs(text: str) -> int:
    """Count GLYPH<n> placeholders + replacement/null chars — evidence that the
    source ToUnicode map was missing. Never deleted or guessed here."""
    if not isinstance(text, str):
        return 0
    return len(_GLYPH_PLACEHOLDER_RE.findall(text))


def has_unmapped_glyph(text: str) -> bool:
    return count_unmapped_glyphs(text) > 0


# ── Source font identity (Phase 6) ──────────────────────────────────────────


def build_source_font_identity(
    *,
    raw_name: Optional[str],
    font_type: str = "unknown",
    embedded: Optional[bool] = None,
    weight_class: Optional[int] = None,
    width_class: Optional[int] = None,
    italic: Optional[bool] = None,
    oblique: Optional[bool] = None,
    monospace: Optional[bool] = None,
    serif: Optional[bool] = None,
    symbolic: Optional[bool] = None,
    variable_axes: Optional[dict] = None,
    source_object_ref: Optional[str] = None,
    asset_id: Optional[str] = None,
) -> dict:
    """Build `source-font-identity-v1`. Preserves the RAW subset name; the subset
    prefix is stripped only into a separate normalized family for matching."""
    raw = raw_name if isinstance(raw_name, str) and raw_name else None
    subset_prefix = None
    is_subset = None
    normalized_family = None
    if raw:
        m = _SUBSET_PREFIX_RE.match(raw)
        if m:
            subset_prefix = m.group(1)
            is_subset = True
        else:
            is_subset = False
        base = _SUBSET_PREFIX_RE.sub("", raw)
        normalized_family = _normalize_family(base)
    ft = font_type if font_type in ("truetype", "opentype-cff", "type1", "cid", "variable", "bitmap", "unknown") else "unknown"
    return {
        "version": SOURCE_FONT_IDENTITY_VERSION,
        "rawName": raw,
        "normalizedFamily": normalized_family,
        "postScriptName": raw,
        "subsetPrefix": subset_prefix,
        "isSubset": is_subset,
        "embedded": embedded,
        "fontType": ft,
        "weightClass": int(weight_class) if isinstance(weight_class, (int, float)) else None,
        "widthClass": int(width_class) if isinstance(width_class, (int, float)) else None,
        "italic": bool(italic) if italic is not None else None,
        "oblique": bool(oblique) if oblique is not None else None,
        "monospace": bool(monospace) if monospace is not None else None,
        "serif": bool(serif) if serif is not None else None,
        "symbolic": bool(symbolic) if symbolic is not None else None,
        "variableAxes": {str(k): float(v) for k, v in (variable_axes or {}).items()} if variable_axes else None,
        "sourceObjectRef": source_object_ref if isinstance(source_object_ref, str) else None,
        "assetId": asset_id if isinstance(asset_id, str) else None,
        "problems": [],
    }


_STYLE_WORDS = frozenset({
    "thin", "hairline", "extralight", "ultralight", "light", "regular", "book",
    "normal", "medium", "semibold", "demibold", "demi", "bold", "extrabold",
    "ultrabold", "black", "heavy", "italic", "oblique", "condensed", "expanded",
    "narrow", "wide", "mt", "ps",
})


def _normalize_family(name: str) -> str:
    tokens = re.split(r"[\s\-_]+", name.strip())
    kept = [t for t in tokens if t and t.lower() not in _STYLE_WORDS]
    return " ".join(kept) if kept else name.strip()


def _weight_to_class(weight: Any) -> Optional[int]:
    if isinstance(weight, (int, float)) and 1 <= weight <= 1000:
        return int(round(weight / 100.0) * 100) if weight <= 9 else int(weight)
    if isinstance(weight, str):
        table = {"thin": 100, "extralight": 200, "light": 300, "normal": 400, "regular": 400,
                 "medium": 500, "semibold": 600, "bold": 700, "extrabold": 800, "black": 900}
        return table.get(weight.strip().lower())
    return None


# ── Critical-content classification (deterministic) ─────────────────────────


def classify_critical_content(*, raw_text: str, label: Optional[str], region_type: Optional[str],
                              in_table: bool = False, in_chart: bool = False) -> str:
    if in_table:
        return "table-cell"
    if in_chart:
        return "chart-label"
    if _LEGAL_RE.search(raw_text or ""):
        return "legal"
    if _FINANCIAL_RE.search(raw_text or ""):
        return "financial"
    lbl = (label or "").lower()
    if lbl in ("title", "section_header"):
        return "heading"
    if lbl == "caption":
        return "caption"
    return "body"


# ── Typography run assembly (Phase 5/13) ────────────────────────────────────


def typography_run_id(global_page: int, bbox: dict, span_ids: list[str],
                      font_object_ref: Optional[str], ordinal: int) -> str:
    """Deterministic, chunk-independent typography run ID. Derived from the
    parent-global page, normalized bbox, source span IDs, raw font object ref and
    a deterministic ordinal — never a UUID/timestamp/signed URL/upload order."""
    key = "|".join([
        str(int(global_page)),
        ssg._canonical_bbox_key(bbox),
        ",".join(sorted(str(s) for s in (span_ids or []))),
        str(font_object_ref or ""),
        str(int(ordinal)),
    ])
    return f"strun-p{int(global_page):04d}-{int(ordinal):04d}-{ssg.fnv1a32(key)}"


def build_glyph_evidence(text: str, max_glyphs: int = MAX_GLYPHS_PER_RUN) -> list[dict]:
    """Per-code-point glyph evidence. Character-level geometry is null when the
    provider does not supply it (never fabricated). An unmapped glyph is flagged,
    never assigned a guessed Unicode."""
    out: list[dict] = []
    if not isinstance(text, str):
        return out
    limit = max(0, min(int(max_glyphs), MAX_GLYPHS_PER_RUN))
    for ordinal, ch in enumerate(text[:limit]):
        cp = ord(ch)
        unmapped = cp in (0xFFFD, 0x0000, 0xFFFE)
        out.append({
            "ordinal": ordinal,
            "unicode": None if unmapped else ch,
            "codePoint": None if unmapped else cp,
            "glyphId": None,
            "clusterStart": ordinal,
            "clusterEnd": ordinal + 1,
            "bbox": None,
            "originX": None,
            "originY": None,
            "advanceX": None,
            "advanceY": None,
            "unmapped": unmapped,
            "providerReference": "pymupdf-span",
        })
    return out


def _norm_run_bbox(bbox: Any) -> dict:
    if isinstance(bbox, dict) and all(k in bbox for k in ("x", "y", "width", "height")):
        return {
            "x": ssg._round2(bbox["x"]), "y": ssg._round2(bbox["y"]),
            "width": ssg._round2(bbox["width"]), "height": ssg._round2(bbox["height"]),
        }
    return {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}


def build_typography_run(
    *,
    global_page: int,
    page_id: str,
    ordinal: int,
    span: dict,
    source_region_id: Optional[str],
    region_type: Optional[str] = None,
    in_table: bool = False,
    in_chart: bool = False,
    font_object_ref: Optional[str] = None,
    font_identity: Optional[dict] = None,
    source_crop: Optional[dict] = None,
    max_glyphs: int = MAX_GLYPHS_PER_RUN,
) -> dict:
    """Assemble ONE immutable `typography-run-contract-v1` from a source span."""
    raw = str(span.get("raw") or "")[:MAX_RUN_TEXT_LEN]
    bbox = _norm_run_bbox(span.get("bbox"))
    span_ids = [span.get("id")] if span.get("id") else []
    rid = typography_run_id(global_page, bbox, span_ids, font_object_ref, ordinal)

    identity = font_identity or build_source_font_identity(
        raw_name=span.get("font"),
        weight_class=_weight_to_class(span.get("weight")),
        italic=span.get("italic"),
        source_object_ref=font_object_ref,
    )
    critical = classify_critical_content(raw_text=raw, label=span.get("label"),
                                         region_type=region_type, in_table=in_table, in_chart=in_chart)
    glyphs = build_glyph_evidence(raw, max_glyphs=max_glyphs)
    placeholder_count = count_unmapped_glyphs(raw)
    unmapped = sum(1 for g in glyphs if g["unmapped"]) + max(0, placeholder_count)
    problems: list[str] = []
    if unmapped:
        problems.append("unmapped_source_glyph")

    line_height = span.get("lineHeight")
    font_size = span.get("fontSize")
    line_height_pt = (float(line_height) * float(font_size)
                      if isinstance(line_height, (int, float)) and isinstance(font_size, (int, float)) else None)
    return {
        "version": TYPOGRAPHY_RUN_CONTRACT_VERSION,
        "id": rid,
        "pageId": page_id,
        "pageNumber": int(global_page),
        "sourceRegionId": source_region_id,
        "sourceSpanIds": span_ids,
        "rawText": raw,
        "normalizedNfc": ssg.normalize_nfc(raw),
        "searchNormalized": search_normalized(raw),
        "codePoints": [ord(c) for c in raw],
        "glyphs": glyphs,
        "bbox": bbox,
        "baseline": _baseline_from_span(span),
        "font": identity,
        "fontSizePt": float(font_size) if isinstance(font_size, (int, float)) else None,
        "colour": span.get("color") if isinstance(span.get("color"), str) else None,
        "opacity": None,
        "lineHeightPt": line_height_pt,
        "letterSpacingPt": None,
        "wordSpacingPt": None,
        "ascentPt": None,
        "descentPt": None,
        "writingMode": _writing_mode(span),
        "language": span.get("language") if isinstance(span.get("language"), str) else None,
        "punctuationTokens": extract_punctuation_tokens_e5(raw),
        "numericTokens": ssg.extract_numeric_tokens(raw),
        "criticalContent": critical,
        "sourceCrop": source_crop or {"path": None, "sha256": None, "widthPx": None, "heightPx": None, "dpi": None, "paddingPt": None},
        "unmappedGlyphCount": unmapped,
        "problems": problems,
        "complete": unmapped == 0 and bool(raw),
    }


def _baseline_from_span(span: dict) -> Optional[dict]:
    b = span.get("bbox")
    if not isinstance(b, dict):
        return None
    try:
        return {"x": float(b.get("x") or 0.0), "y": float(b.get("y") or 0.0) + float(b.get("height") or 0.0),
                "directionX": 1.0, "directionY": 0.0}
    except (TypeError, ValueError):
        return None


def _writing_mode(span: dict) -> str:
    wm = span.get("writingMode")
    if wm in ("horizontal-ltr", "horizontal-rtl", "vertical", "rotated", "unknown"):
        return wm
    if span.get("direction") == "rtl":
        return "horizontal-rtl"
    if isinstance(span.get("rotation"), (int, float)) and int(span["rotation"]) % 360 != 0:
        return "rotated"
    return "horizontal-ltr"


def build_page_typography(
    *,
    global_page: int,
    page_id: str,
    spans: list[dict],
    text_regions: Optional[list[dict]] = None,
) -> tuple[list[dict], list[str]]:
    """Assemble all source typography runs for one page from source spans.
    Deterministic per-page ordinal → chunk-independent run IDs."""
    problems: list[str] = []
    region_by_span: dict[str, str] = {}
    for r in text_regions or []:
        for sid in ((r.get("text") or {}).get("spanIds") or []):
            region_by_span[sid] = r.get("id")

    ordered = [s for s in spans or [] if isinstance(s, dict) and isinstance(s.get("bbox"), dict)]
    ordered.sort(key=lambda s: (float(s["bbox"].get("y") or 0.0), float(s["bbox"].get("x") or 0.0)))
    if len(ordered) > MAX_TYPOGRAPHY_RUNS_PER_PAGE:
        problems.append("typography_runs_truncated")
        ordered = ordered[:MAX_TYPOGRAPHY_RUNS_PER_PAGE]

    runs: list[dict] = []
    text_codepoints = 0
    glyph_evidence = 0
    for ordinal, span in enumerate(ordered, start=1):
        raw_length = min(len(str(span.get("raw") or "")), MAX_RUN_TEXT_LEN)
        if text_codepoints + raw_length > MAX_TEXT_CODEPOINTS_PER_PAGE:
            problems.append("typography_text_budget_exceeded")
            break
        glyph_count = min(raw_length, MAX_GLYPHS_PER_RUN,
                          MAX_GLYPH_EVIDENCE_PER_PAGE - glyph_evidence)
        if glyph_count <= 0 and raw_length:
            problems.append("typography_glyph_budget_exceeded")
            break
        runs.append(build_typography_run(
            global_page=global_page, page_id=page_id, ordinal=ordinal, span=span,
            source_region_id=region_by_span.get(span.get("id")),
            font_object_ref=span.get("fontObjectRef"),
            max_glyphs=glyph_count,
        ))
        text_codepoints += raw_length
        glyph_evidence += glyph_count
        if glyph_count < min(raw_length, MAX_GLYPHS_PER_RUN):
            problems.append("typography_glyph_budget_exceeded")
            break
    return runs, problems

"""table-candidate-contract-v1 + source-table-evidence-v1 — PDF Extraction V3 · E4.

Deterministic, provider-neutral table candidate architecture (pure). This module
normalizes every structured table extraction into ONE immutable candidate
contract and assembles the immutable SOURCE evidence a candidate is later
evaluated against — keeping *source truth* and *candidate* strictly separate.

DESIGN CONTRACT
- Pure + deterministic. Importing this module MUST NOT initialise Docling models,
  open the network or touch the filesystem. `source_scene_graph` (also pure) is
  imported for the shared FNV-1a hash, bbox normalisation and token evidence, so
  IDs are byte-identical to the TypeScript consumer.
- Source truth only. A candidate can NEVER rewrite the source evidence: the
  evidence bundle is built from the immutable E1 source region + crop + spans +
  vectors, and candidates are compared against it, never merged into it.
- Deterministic identities: candidate + cell IDs derive from the source region,
  provider, provider profile and canonical topology — never a UUID, timestamp,
  signed URL, upload order or database id. The same candidate produced in a
  monolithic parse, a chunk-local parse rebased to the same parent page, or a
  cache replay keeps the same canonical ID.
- Never invent, move, correct, calculate or semantically guess a source value.

This module produces candidates + evidence; `table_integrity.py` evaluates,
arbitrates and builds the preservation plan.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any, Optional

import source_scene_graph as ssg

# ── Contract versions ───────────────────────────────────────────────────────

TABLE_CANDIDATE_CONTRACT_VERSION = "table-candidate-contract-v1"
SOURCE_TABLE_EVIDENCE_VERSION = "source-table-evidence-v1"
SOURCE_TABLE_GRID_EVIDENCE_VERSION = "source-table-grid-v1"

PROVIDER_ABBREV = {
    "docling-primary": "dpri",
    "docling-accurate-cell-matching": "dacm",
    "docling-accurate-no-cell-matching": "danm",
    "docling-fast": "dfst",
    "pymupdf-grid": "pgrid",
    "legacy": "lgcy",
    "unknown": "unkn",
}
VALID_PROVIDERS = frozenset(PROVIDER_ABBREV)

# ── Bounded candidate budgets (deterministic; exceed → recorded, never silent) ─

MAX_TABLE_CANDIDATES_PER_TABLE = 5
MAX_CELLS_PER_CANDIDATE = 4000
MAX_ROWS_PER_CANDIDATE = 600
MAX_COLS_PER_CANDIDATE = 64
MAX_CANDIDATE_JSON_BYTES = 512 * 1024
# PyMuPDF grid inference minimums (conservative; borderless/ambiguous → no grid).
GRID_MIN_H_LINES = 2
GRID_MIN_V_LINES = 2
GRID_LINE_ALIGN_TOL_PT = 2.0


def _finite(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _bbox_ok(b: Any) -> bool:
    if not isinstance(b, dict):
        return False
    for k in ("x", "y", "width", "height"):
        if _finite(b.get(k)) is None:
            return False
    return float(b.get("width") or 0) > 0 and float(b.get("height") or 0) > 0


def _norm_bbox_dict(b: Any) -> Optional[dict]:
    if not _bbox_ok(b):
        return None
    return {
        "x": ssg._round2(b["x"]), "y": ssg._round2(b["y"]),
        "width": ssg._round2(b["width"]), "height": ssg._round2(b["height"]),
    }


def _raw_candidate_exceeds_budget(cells_raw: list[dict]) -> bool:
    """Bound raw candidate work before sorting, hashing, or cell expansion.

    The fixed allowance covers the normalized contract fields each raw cell
    expands into. Text is counted incrementally so a single hostile string does
    not require a second, potentially very large UTF-8 allocation.
    """
    size = 2048 + (len(cells_raw) * 256)
    if size > MAX_CANDIDATE_JSON_BYTES:
        return True
    for cell in cells_raw:
        if not isinstance(cell, dict):
            continue
        provider_refs = cell.get("providerRefs")
        values = [cell.get("text") or ""]
        if isinstance(provider_refs, list):
            values.extend(provider_refs)
        for value in values:
            if not isinstance(value, str):
                continue
            for char in value:
                codepoint = ord(char)
                size += 1 if codepoint < 0x80 else 2 if codepoint < 0x800 else 3 if codepoint < 0x10000 else 4
                if size > MAX_CANDIDATE_JSON_BYTES:
                    return True
    return False


def candidate_json_within_budget(candidate: dict) -> bool:
    """Return whether one fully normalized candidate fits its artifact budget."""
    encoded = json.dumps(candidate, separators=(",", ":")).encode("utf-8")
    return len(encoded) <= MAX_CANDIDATE_JSON_BYTES


# ── Deterministic identities (Phase 3) ──────────────────────────────────────


def _canonical_topology_key(num_rows: int, num_cols: int, header_row_count: int,
                            header_col_count: int, cells: list[dict]) -> str:
    parts = [str(int(num_rows)), str(int(num_cols)), str(int(header_row_count)), str(int(header_col_count))]
    for c in cells:
        parts.append("|".join([
            str(int(c.get("row", 0))), str(int(c.get("col", 0))),
            str(int(c.get("rowSpan", 1))), str(int(c.get("colSpan", 1))),
            "H" if c.get("columnHeader") else "-",
            "R" if c.get("rowHeader") else "-",
            ssg.normalize_nfc(str(c.get("text") or "")),
        ]))
    return "␟".join(parts)


def candidate_id(source_region_id: str, provider: str, profile: dict, bbox: dict,
                 num_rows: int, num_cols: int, header_row_count: int,
                 header_col_count: int, cells: list[dict]) -> str:
    """Deterministic candidate ID. Changing a provider profile (mode / cell
    matching / converter key) changes the ID; the same candidate rebased across
    chunk/cache keeps it (source_region_id + normalised bbox are chunk-independent)."""
    abbrev = PROVIDER_ABBREV.get(provider, "unkn")
    profile_sig = "|".join([
        str((profile or {}).get("runtimeProfile") or ""),
        str((profile or {}).get("tableMode") or ""),
        "cm1" if (profile or {}).get("cellMatching") else "cm0",
        str((profile or {}).get("converterKey") or ""),
        str((profile or {}).get("modelId") or ""),
    ])
    key = "␞".join([
        str(source_region_id), provider, profile_sig,
        ssg._canonical_bbox_key(bbox),
        _canonical_topology_key(num_rows, num_cols, header_row_count, header_col_count, cells),
    ])
    return f"tblcand-{ssg.fnv1a32(str(source_region_id))}-{abbrev}-{ssg.fnv1a32(key)}"


def cell_id(candidate: str, row: int, col: int, row_span: int, col_span: int) -> str:
    key = "|".join([candidate, str(int(row)), str(int(col)), str(int(row_span)), str(int(col_span))])
    return f"tcell-{ssg.fnv1a32(key)}"


# ── Candidate cell + candidate assembly (Phase 2) ───────────────────────────


def _candidate_cell(candidate: str, raw_cell: dict) -> dict:
    row = int(raw_cell.get("row", 0) or 0)
    col = int(raw_cell.get("col", 0) or 0)
    row_span = max(1, int(raw_cell.get("rowSpan", 1) or 1))
    col_span = max(1, int(raw_cell.get("colSpan", 1) or 1))
    text = str(raw_cell.get("text") or "")
    return {
        "id": cell_id(candidate, row, col, row_span, col_span),
        "row": row,
        "col": col,
        "rowSpan": row_span,
        "colSpan": col_span,
        "columnHeader": bool(raw_cell.get("columnHeader")),
        "rowHeader": bool(raw_cell.get("rowHeader")),
        "text": text,
        "normalizedText": ssg.normalize_nfc(text),
        "numericTokens": ssg.extract_numeric_tokens(text),
        "punctuationTokens": ssg.extract_punctuation_tokens(text),
        "bbox": _norm_bbox_dict(raw_cell.get("bbox")),
        "confidence": _finite(raw_cell.get("confidence")),
        "providerReferences": [str(r) for r in (raw_cell.get("providerRefs") or []) if isinstance(r, str)],
    }


def build_table_candidate(
    *,
    source_region_id: str,
    page_id: str,
    page_number: int,
    provider: str,
    provider_version: Optional[str],
    provider_reference: Optional[str],
    profile: dict,
    bbox: dict,
    num_rows: int,
    num_cols: int,
    header_row_count: int,
    header_col_count: int,
    cells_raw: list[dict],
    caption: Optional[str] = None,
    source_crop_path: Optional[str] = None,
    confidence: Optional[float] = None,
    elapsed_ms: Optional[int] = None,
) -> Optional[dict]:
    """Assemble ONE normalized `table-candidate-contract-v1`. Deterministic; the
    input lists are never mutated. Anchor-only merged text is expected (a spanned
    cell's text lives only on its anchor)."""
    provider = provider if provider in VALID_PROVIDERS else "unknown"
    norm_bbox = _norm_bbox_dict(bbox) or {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}
    if (len(cells_raw) > MAX_CELLS_PER_CANDIDATE
            or num_rows > MAX_ROWS_PER_CANDIDATE
            or num_cols > MAX_COLS_PER_CANDIDATE
            or _raw_candidate_exceeds_budget(cells_raw)):
        return None
    # Deterministic cell order (row, then col) BEFORE hashing so the ID is stable.
    ordered = sorted(
        (c for c in cells_raw if isinstance(c, dict)),
        key=lambda c: (int(c.get("row", 0) or 0), int(c.get("col", 0) or 0),
                       int(c.get("rowSpan", 1) or 1), int(c.get("colSpan", 1) or 1)),
    )
    cid = candidate_id(source_region_id, provider, profile, norm_bbox,
                       num_rows, num_cols, header_row_count, header_col_count, ordered)
    cells = [_candidate_cell(cid, c) for c in ordered]
    candidate = {
        "version": TABLE_CANDIDATE_CONTRACT_VERSION,
        "id": cid,
        "sourceRegionId": source_region_id,
        "pageId": page_id,
        "pageNumber": int(page_number),
        "provider": provider,
        "providerVersion": provider_version,
        "providerReference": provider_reference,
        "profile": {
            "runtimeProfile": (profile or {}).get("runtimeProfile"),
            "pipelineFamily": (profile or {}).get("pipelineFamily"),
            "tableMode": (profile or {}).get("tableMode"),
            "cellMatching": (profile or {}).get("cellMatching"),
            "modelId": (profile or {}).get("modelId"),
            "converterKey": (profile or {}).get("converterKey"),
        },
        "bbox": norm_bbox,
        "numRows": int(num_rows),
        "numCols": int(num_cols),
        "headerRowCount": int(header_row_count),
        "headerColumnCount": int(header_col_count),
        "cells": cells,
        "caption": caption if isinstance(caption, str) and caption else None,
        "sourceCropPath": source_crop_path if (source_crop_path and ssg.is_safe_artifact_path(source_crop_path)) else None,
        "confidence": _finite(confidence),
        "extractionElapsedMs": int(elapsed_ms) if isinstance(elapsed_ms, (int, float)) and elapsed_ms >= 0 else None,
    }
    problems = validate_table_candidate(candidate)
    candidate["problems"] = problems
    candidate["complete"] = len(problems) == 0
    return candidate if candidate_json_within_budget(candidate) else None


def validate_table_candidate(candidate: dict) -> list[str]:
    """Pure structural validation → bounded problem codes. Never coerces malformed
    financial values to zero and never drops meaningful cells silently."""
    problems: list[str] = []
    if not isinstance(candidate, dict):
        return ["candidate_not_object"]
    if candidate.get("version") != TABLE_CANDIDATE_CONTRACT_VERSION:
        problems.append("candidate_bad_version")
    num_rows = int(candidate.get("numRows") or 0)
    num_cols = int(candidate.get("numCols") or 0)
    cells = candidate.get("cells") or []
    if not _bbox_ok(candidate.get("bbox")):
        problems.append("candidate_bbox_non_finite")
    if num_rows < 0 or num_cols < 0:
        problems.append("candidate_negative_dimensions")
    if (num_rows == 0 or num_cols == 0) and cells:
        problems.append("candidate_zero_dims_with_cells")
    hrc = int(candidate.get("headerRowCount") or 0)
    hcc = int(candidate.get("headerColumnCount") or 0)
    if hrc < 0 or (num_rows and hrc > num_rows):
        problems.append("candidate_impossible_header_row_count")
    if hcc < 0 or (num_cols and hcc > num_cols):
        problems.append("candidate_impossible_header_col_count")
    if len(cells) > MAX_CELLS_PER_CANDIDATE:
        problems.append("candidate_too_many_cells")
    if num_rows > MAX_ROWS_PER_CANDIDATE or num_cols > MAX_COLS_PER_CANDIDATE:
        problems.append("candidate_dimensions_exceed_budget")

    seen_ids: set[str] = set()
    anchor_texts: dict[tuple[int, int], str] = {}
    for c in cells:
        if not isinstance(c, dict):
            problems.append("candidate_cell_not_object")
            continue
        cid = c.get("id")
        if cid in seen_ids:
            problems.append("candidate_duplicate_cell_id")
        seen_ids.add(cid)
        row, col = int(c.get("row", 0)), int(c.get("col", 0))
        rs, cs = int(c.get("rowSpan", 1)), int(c.get("colSpan", 1))
        if row < 0 or col < 0:
            problems.append("candidate_negative_cell_index")
        if rs < 1 or cs < 1:
            problems.append("candidate_invalid_span")
        if num_rows and row + rs > num_rows:
            problems.append("candidate_cell_row_out_of_bounds")
        if num_cols and col + cs > num_cols:
            problems.append("candidate_cell_col_out_of_bounds")
        b = c.get("bbox")
        if b is not None and not _bbox_ok(b):
            problems.append("candidate_cell_bbox_non_finite")
        # Duplicate merged-cell text: identical non-empty text at two distinct anchors
        # that overlap is a topology defect (handled at integrity level per-source);
        # here we only guard exact anchor collisions.
        key = (row, col)
        txt = str(c.get("text") or "")
        if key in anchor_texts and anchor_texts[key] != txt:
            problems.append("candidate_conflicting_anchor")
        anchor_texts[key] = txt
    # Overlapping anchors with incompatible spans (two cells claim the same grid slot).
    occupied: dict[tuple[int, int], str] = {}
    for c in cells:
        if not isinstance(c, dict):
            continue
        row, col = int(c.get("row", 0)), int(c.get("col", 0))
        rs, cs = max(1, int(c.get("rowSpan", 1))), max(1, int(c.get("colSpan", 1)))
        for r in range(row, row + rs):
            for cc in range(col, col + cs):
                slot = (r, cc)
                if slot in occupied and occupied[slot] != c.get("id"):
                    problems.append("candidate_overlapping_spans")
                occupied[slot] = c.get("id")
    path = candidate.get("sourceCropPath")
    if path is not None and not ssg.is_safe_artifact_path(path):
        problems.append("candidate_crop_path_unsafe")
    # de-dup, bounded
    return sorted(set(problems))


# ── Primary candidate from E1 source topology (Phase 5A) ────────────────────


def candidate_from_source_topology(
    *,
    region: dict,
    provider: str = "docling-primary",
    provider_version: Optional[str] = None,
    profile: Optional[dict] = None,
    elapsed_ms: Optional[int] = None,
) -> Optional[dict]:
    """Build the PRIMARY candidate directly from an E1 table region's
    `source-table-topology-v2`. This is the structured output the current
    production path already produces; it is a *candidate*, not truth."""
    topo = region.get("table")
    if not isinstance(topo, dict):
        return None
    raw_topology_cells = topo.get("cells") or []
    num_rows = int(topo.get("numRows") or 0)
    num_cols = int(topo.get("numCols") or 0)
    if (not isinstance(raw_topology_cells, list)
            or len(raw_topology_cells) > MAX_CELLS_PER_CANDIDATE
            or num_rows > MAX_ROWS_PER_CANDIDATE
            or num_cols > MAX_COLS_PER_CANDIDATE
            or _raw_candidate_exceeds_budget(raw_topology_cells)):
        return None
    cells_raw = [{
        "row": c.get("row"), "col": c.get("col"),
        "rowSpan": c.get("rowSpan", 1), "colSpan": c.get("colSpan", 1),
        "columnHeader": c.get("columnHeader"), "rowHeader": c.get("rowHeader"),
        "text": c.get("text"), "bbox": _relative_cell_bbox(c.get("bbox"), region.get("bbox")),
        "confidence": c.get("confidence"), "providerRefs": c.get("providerRefs") or ["docling"],
    } for c in raw_topology_cells if isinstance(c, dict)]
    return build_table_candidate(
        source_region_id=region.get("id"),
        page_id=region.get("pageId") or f"docling-page-{region.get('pageNumber')}",
        page_number=int(region.get("pageNumber") or 0),
        provider=provider,
        provider_version=provider_version,
        provider_reference=(region.get("providerEvidence") or [{}])[0].get("providerRef") if region.get("providerEvidence") else None,
        profile=profile or {"runtimeProfile": "legacy", "tableMode": None, "cellMatching": None},
        bbox=region.get("bbox") or {},
        num_rows=num_rows,
        num_cols=num_cols,
        header_row_count=int(topo.get("headerRowCount") or 0),
        header_col_count=int(topo.get("headerColumnCount") or 0),
        cells_raw=cells_raw,
        caption=topo.get("caption") if isinstance(topo.get("caption"), str) else None,
        source_crop_path=(region.get("sourceCrop") or {}).get("path"),
        confidence=region.get("confidence"),
        elapsed_ms=elapsed_ms,
    )


def _relative_cell_bbox(cell_bbox: Any, region_bbox: Any) -> Optional[dict]:
    """A source cell bbox is page-absolute; keep it as-is (candidates and evidence
    both use page coordinates). Returns a normalized copy or None."""
    return _norm_bbox_dict(cell_bbox)


# ── Source table evidence bundle (Phase 4) ──────────────────────────────────


def build_source_table_evidence(
    *,
    region: dict,
    page_spans: list[dict],
    page_vectors: list[dict],
    adjacent_source_table_region_ids: list[str],
) -> dict:
    """Assemble the immutable `source-table-evidence-v1` bundle for one E1 table
    region: crop, topology, in-bbox source spans, deterministic vector-grid
    evidence, and source numeric/punctuation token placements. This is EVIDENCE —
    a candidate is compared against it and can never rewrite it."""
    bbox = region.get("bbox") or {}
    topo = region.get("table") if isinstance(region.get("table"), dict) else None
    crop = region.get("sourceCrop") or {}

    spans_in = [s for s in page_spans if isinstance(s, dict) and _span_in_bbox(s.get("bbox"), bbox)]
    span_evidence: list[dict] = []
    numeric_placements: list[dict] = []
    punct_placements: list[dict] = []
    for s in spans_in:
        sb = _norm_bbox_dict(s.get("bbox"))
        span_evidence.append({
            "spanId": s.get("id"),
            "bbox": sb,
            "text": s.get("raw") or "",
            "normalizedText": s.get("normalizedNfc") or ssg.normalize_nfc(str(s.get("raw") or "")),
        })
        for tok in s.get("numericTokens") or []:
            if isinstance(tok, dict):
                numeric_placements.append({"token": tok, "spanId": s.get("id"), "bbox": sb})
        for tok in s.get("punctuationTokens") or []:
            if isinstance(tok, dict):
                punct_placements.append({"token": tok, "spanId": s.get("id"), "bbox": sb})

    grid = build_vector_grid_evidence(page_vectors, bbox)

    problems: list[str] = []
    if not crop.get("path"):
        problems.append("source_table_crop_missing")
    topo_complete = bool(topo and topo.get("complete"))
    cells_have_bbox = bool(topo and all(isinstance(c.get("bbox"), dict) for c in (topo.get("cells") or []))) if topo else False
    if not topo:
        problems.append("source_topology_absent")
    elif not topo_complete:
        problems.append("source_topology_incomplete")
    if topo and not cells_have_bbox:
        problems.append("source_cell_bboxes_incomplete")

    complete = bool(crop.get("path")) and topo_complete and cells_have_bbox
    return {
        "version": SOURCE_TABLE_EVIDENCE_VERSION,
        "sourceRegionId": region.get("id"),
        "pageId": region.get("pageId"),
        "pageNumber": int(region.get("pageNumber") or 0),
        "bbox": _norm_bbox_dict(bbox),
        "crop": {
            "path": crop.get("path"), "sha256": crop.get("sha256"),
            "widthPx": crop.get("widthPx"), "heightPx": crop.get("heightPx"), "dpi": crop.get("sourceDpi"),
        },
        "topology": topo,
        "sourceSpans": span_evidence,
        "vectorGridEvidence": grid,
        "sourceNumericTokens": numeric_placements,
        "sourcePunctuationTokens": punct_placements,
        "adjacentSourceTableRegionIds": list(adjacent_source_table_region_ids or []),
        "childRegionIds": list((region.get("relationships") or {}).get("childRegionIds") or []),
        "problems": sorted(set(problems)),
        "complete": complete,
    }


def _span_in_bbox(span_bbox: Any, region_bbox: Any, *, min_overlap: float = 0.5) -> bool:
    sb = _norm_bbox_dict(span_bbox)
    rb = _norm_bbox_dict(region_bbox)
    if sb is None or rb is None:
        return False
    ix = max(sb["x"], rb["x"])
    iy = max(sb["y"], rb["y"])
    ix2 = min(sb["x"] + sb["width"], rb["x"] + rb["width"])
    iy2 = min(sb["y"] + sb["height"], rb["y"] + rb["height"])
    if ix2 <= ix or iy2 <= iy:
        return False
    inter = (ix2 - ix) * (iy2 - iy)
    area = sb["width"] * sb["height"]
    return area > 0 and (inter / area) >= min_overlap


def build_vector_grid_evidence(page_vectors: list[dict], region_bbox: Any) -> Optional[dict]:
    """Deterministic vector-grid evidence within a table bbox: count horizontal /
    vertical rule segments + rectangles + their aligned boundary positions. Used to
    decide whether a conservative PyMuPDF grid candidate is justified (never to
    invent a grid from prose)."""
    rb = _norm_bbox_dict(region_bbox)
    if rb is None:
        return None
    h_lines: list[float] = []
    v_lines: list[float] = []
    rectangles = 0
    for vec in page_vectors or []:
        for seg in _iter_segments(vec):
            (x0, y0, x1, y1) = seg
            if not _segment_in_bbox(x0, y0, x1, y1, rb):
                continue
            if abs(y1 - y0) <= GRID_LINE_ALIGN_TOL_PT and abs(x1 - x0) > GRID_LINE_ALIGN_TOL_PT:
                h_lines.append(round((y0 + y1) / 2.0, 1))
            elif abs(x1 - x0) <= GRID_LINE_ALIGN_TOL_PT and abs(y1 - y0) > GRID_LINE_ALIGN_TOL_PT:
                v_lines.append(round((x0 + x1) / 2.0, 1))
        if _is_rectangle(vec):
            rectangles += 1
    aligned_y = _cluster_positions(h_lines)
    aligned_x = _cluster_positions(v_lines)
    if not h_lines and not v_lines and rectangles == 0:
        border_style = "borderless"
    elif len(aligned_y) >= GRID_MIN_H_LINES and len(aligned_x) >= GRID_MIN_V_LINES:
        border_style = "ruled"
    else:
        border_style = "partial"
    return {
        "version": SOURCE_TABLE_GRID_EVIDENCE_VERSION,
        "horizontalLines": len(h_lines),
        "verticalLines": len(v_lines),
        "rectangles": rectangles,
        "alignedXBoundaries": aligned_x,
        "alignedYBoundaries": aligned_y,
        "borderStyle": border_style,
    }


def _iter_segments(vec: dict):
    """Yield (x0,y0,x1,y1) line segments from a vector's paths/lines, best-effort."""
    for line in vec.get("lines") or []:
        if isinstance(line, dict):
            p0, p1 = line.get("p0") or line.get("start"), line.get("p1") or line.get("end")
            if isinstance(p0, (list, tuple)) and isinstance(p1, (list, tuple)) and len(p0) >= 2 and len(p1) >= 2:
                f = [_finite(p0[0]), _finite(p0[1]), _finite(p1[0]), _finite(p1[1])]
                if all(v is not None for v in f):
                    yield tuple(f)
    for seg in vec.get("segments") or []:
        if isinstance(seg, (list, tuple)) and len(seg) >= 4:
            f = [_finite(seg[0]), _finite(seg[1]), _finite(seg[2]), _finite(seg[3])]
            if all(v is not None for v in f):
                yield tuple(f)


def _is_rectangle(vec: dict) -> bool:
    if str(vec.get("kind") or vec.get("type") or "").lower() in ("rect", "rectangle"):
        return True
    return bool(vec.get("isRectangle"))


def _segment_in_bbox(x0, y0, x1, y1, rb: dict) -> bool:
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    return rb["x"] - 2 <= cx <= rb["x"] + rb["width"] + 2 and rb["y"] - 2 <= cy <= rb["y"] + rb["height"] + 2


def _cluster_positions(values: list[float], tol: float = GRID_LINE_ALIGN_TOL_PT) -> list[float]:
    if not values:
        return []
    out: list[float] = []
    for v in sorted(values):
        if not out or abs(v - out[-1]) > tol:
            out.append(round(v, 1))
    return out


# ── Conservative PyMuPDF grid candidate (Phase 7) ───────────────────────────


def build_pymupdf_grid_candidate(evidence: dict, *, page_id: str) -> Optional[dict]:
    """Generate a conservative deterministic grid candidate ONLY when strong,
    unambiguous line + span evidence exists. Never uses prose semantics to invent
    a grid; never reorders spans by meaning. Returns None when evidence is weak."""
    grid = evidence.get("vectorGridEvidence") or {}
    if grid.get("borderStyle") != "ruled":
        return None
    xs = grid.get("alignedXBoundaries") or []
    ys = grid.get("alignedYBoundaries") or []
    if len(xs) < 2 or len(ys) < 2:
        return None
    num_cols = len(xs) - 1
    num_rows = len(ys) - 1
    if num_cols <= 0 or num_rows <= 0 or num_cols > MAX_COLS_PER_CANDIDATE or num_rows > MAX_ROWS_PER_CANDIDATE:
        return None

    # Assign each source span to exactly one grid cell by its centre; a span whose
    # centre lands outside the grid, or that straddles a boundary materially,
    # invalidates the candidate (ambiguous → prefer the crop).
    cell_text: dict[tuple[int, int], list[tuple[float, str]]] = {}
    for span in evidence.get("sourceSpans") or []:
        sb = span.get("bbox")
        if not _bbox_ok(sb):
            continue
        cx = sb["x"] + sb["width"] / 2.0
        cy = sb["y"] + sb["height"] / 2.0
        col = _bucket(cx, xs)
        row = _bucket(cy, ys)
        if col is None or row is None:
            return None  # span outside inferred grid → ambiguous
        # Straddle check: a span materially crossing a vertical boundary is ambiguous.
        for bx in xs[1:-1]:
            if sb["x"] + 1.0 < bx < sb["x"] + sb["width"] - 1.0:
                return None
        cell_text.setdefault((row, col), []).append((sb["x"], span.get("text") or ""))

    cells_raw: list[dict] = []
    for (row, col), items in cell_text.items():
        text = " ".join(t for _, t in sorted(items, key=lambda p: p[0])).strip()
        cells_raw.append({
            "row": row, "col": col, "rowSpan": 1, "colSpan": 1,
            "columnHeader": row == 0, "rowHeader": False, "text": text,
            "bbox": {"x": xs[col], "y": ys[row], "width": xs[col + 1] - xs[col], "height": ys[row + 1] - ys[row]},
            "providerRefs": ["pymupdf"],
        })
    if not cells_raw:
        return None
    return build_table_candidate(
        source_region_id=evidence.get("sourceRegionId"),
        page_id=page_id,
        page_number=int(evidence.get("pageNumber") or 0),
        provider="pymupdf-grid",
        provider_version="pymupdf-grid-v1",
        provider_reference="vector-grid",
        profile={"runtimeProfile": "pymupdf", "tableMode": None, "cellMatching": None},
        bbox=evidence.get("bbox") or {},
        num_rows=num_rows, num_cols=num_cols,
        header_row_count=1, header_col_count=0,
        cells_raw=cells_raw,
        caption=(evidence.get("topology") or {}).get("caption") if evidence.get("topology") else None,
        source_crop_path=(evidence.get("crop") or {}).get("path"),
        confidence=None,
    )


def _bucket(value: float, boundaries: list[float]) -> Optional[int]:
    for i in range(len(boundaries) - 1):
        lo, hi = boundaries[i], boundaries[i + 1]
        if lo - 0.5 <= value <= hi + 0.5:
            return i
    return None

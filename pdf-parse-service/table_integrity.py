"""table-integrity-report-v1 + table-arbitration-v1 + table-preservation-v1 (E4, pure).

The safety-critical half of E4. Evaluates a normalized `TableCandidateV1` against
the immutable `SourceTableEvidenceBundleV1`, records HARD table-integrity defects,
deterministically arbitrates the strongest SAFE candidate, and builds a
table-specific preservation plan.

CORE PRINCIPLE — SOURCE FIDELITY AND CORRECT CELL ASSOCIATION OUTRANK EDITABILITY.
A weighted score may NEVER override a hard defect. A candidate becomes a verified
native table only when it has zero hard defects, complete required source
evidence, and — for a financial table — proven exact numeric-cell association.
Otherwise the exact source crop (or E0 page fallback) is used. Nothing here
invents, moves, corrects, calculates or semantically guesses a source value.

Pure + deterministic + JSON-safe: no NaN/Infinity, no mutation of inputs, no I/O.
"""

from __future__ import annotations

import math
import re
from typing import Any, Optional

import source_scene_graph as ssg
import table_candidates as tcand

TABLE_INTEGRITY_REPORT_VERSION = "table-integrity-report-v1"
TABLE_ARBITRATION_VERSION = "table-arbitration-v1"
TABLE_PRESERVATION_VERSION = "table-preservation-v1"

GENERIC_HEADER_RE = re.compile(r"^\s*column\s*\d+\s*$", re.I)
# Minimum readable contrast ratio (WCAG-ish; conservative). Below → unreadable.
MIN_CONTRAST_RATIO = 3.0

# Provider tie-break order — used ONLY when every scored metric ties, never as a
# primary quality claim.
PROVIDER_PRIORITY = [
    "docling-accurate-cell-matching",
    "docling-accurate-no-cell-matching",
    "docling-primary",
    "docling-fast",
    "pymupdf-grid",
    "legacy",
    "unknown",
]

HARD_DEFECT_CODES = frozenset({
    "source_table_crop_missing", "source_table_evidence_incomplete", "candidate_missing",
    "candidate_invalid", "candidate_empty", "generic_header_substitution", "source_header_missing",
    "header_structure_mismatch", "row_count_mismatch", "column_count_mismatch", "cell_span_invalid",
    "cell_span_mismatch", "source_numeric_token_missing", "source_numeric_token_duplicated",
    "numeric_token_wrong_cell", "punctuation_token_missing", "adjacent_source_tables_merged",
    "single_source_table_split", "candidate_bbox_mismatch", "cell_bbox_outside_table",
    "table_outside_page", "candidate_overflow", "candidate_row_clipped", "candidate_column_clipped",
    "candidate_text_collision", "candidate_unreadable_contrast", "candidate_unscored",
    "candidate_budget_exceeded", "provider_disagreement_unresolved",
})


def _ratio(num: int, den: Optional[int]) -> Optional[float]:
    if den is None or den <= 0:
        return None
    return round(num / den, 4)


def _numeric_key(tok: dict) -> Optional[str]:
    if not isinstance(tok, dict):
        return None
    if tok.get("kind") == "range":
        a, b = tok.get("rangeStart"), tok.get("rangeEnd")
        if a is None and b is None:
            return None
        return f"range:{a}~{b}"
    norm = tok.get("normalized")
    if isinstance(norm, str) and norm:
        return f"num:{norm}"
    raw = tok.get("raw")
    if isinstance(raw, str) and raw:
        return f"num:{raw.replace(',', '')}"
    return None


def is_financial_table(evidence: dict) -> bool:
    """A table is financial when its source carries currency/percentage/range
    numeric evidence — those get the strict numeric-association veto."""
    for placement in evidence.get("sourceNumericTokens") or []:
        tok = placement.get("token") if isinstance(placement, dict) else None
        if isinstance(tok, dict) and tok.get("kind") in ("currency", "percentage", "range"):
            return True
    for cell in (evidence.get("topology") or {}).get("cells") or []:
        for tok in cell.get("numericTokens") or []:
            if isinstance(tok, dict) and tok.get("kind") in ("currency", "percentage", "range"):
                return True
    return False


# ── Numeric-cell association (Phase 12 — highest priority) ──────────────────


def _source_token_cells(evidence: dict) -> dict[str, set[tuple[int, int]]]:
    """Map each source numeric token value → the set of source cells it sits in
    (by bbox containment). Requires source cell bboxes; empty when unavailable."""
    topo = evidence.get("topology") or {}
    cells = [c for c in (topo.get("cells") or []) if isinstance(c.get("bbox"), dict)]
    out: dict[str, set[tuple[int, int]]] = {}
    for placement in evidence.get("sourceNumericTokens") or []:
        tok = placement.get("token") if isinstance(placement, dict) else None
        key = _numeric_key(tok)
        pb = placement.get("bbox") if isinstance(placement, dict) else None
        if not key or not isinstance(pb, dict):
            continue
        cx = pb["x"] + pb["width"] / 2.0
        cy = pb["y"] + pb["height"] / 2.0
        for c in cells:
            b = c["bbox"]
            if b["x"] - 0.5 <= cx <= b["x"] + b["width"] + 0.5 and b["y"] - 0.5 <= cy <= b["y"] + b["height"] + 0.5:
                out.setdefault(key, set()).add((int(c.get("row", 0)), int(c.get("col", 0))))
                break
    return out


def _candidate_token_cells(candidate: dict) -> dict[str, set[tuple[int, int]]]:
    out: dict[str, set[tuple[int, int]]] = {}
    for c in candidate.get("cells") or []:
        rc = (int(c.get("row", 0)), int(c.get("col", 0)))
        for tok in c.get("numericTokens") or []:
            key = _numeric_key(tok)
            if key:
                out.setdefault(key, set()).add(rc)
    return out


def _candidate_numeric_multiplicity(candidate: dict) -> dict[str, int]:
    counts: dict[str, int] = {}
    for c in candidate.get("cells") or []:
        for tok in c.get("numericTokens") or []:
            key = _numeric_key(tok)
            if key:
                counts[key] = counts.get(key, 0) + 1
    return counts


# ── Header + text metrics ───────────────────────────────────────────────────


def _source_header_texts(evidence: dict) -> list[str]:
    topo = evidence.get("topology") or {}
    out: list[str] = []
    for c in topo.get("cells") or []:
        if c.get("columnHeader") and isinstance(c.get("text"), str) and c["text"].strip():
            out.append(c["text"].strip())
    return out


def _candidate_header_cells(candidate: dict) -> list[dict]:
    hrc = int(candidate.get("headerRowCount") or 0)
    return [c for c in candidate.get("cells") or [] if c.get("columnHeader") or int(c.get("row", 99)) < hrc]


def _generic_header_count(candidate: dict) -> int:
    n = 0
    for c in _candidate_header_cells(candidate):
        t = str(c.get("text") or "").strip()
        if not t or GENERIC_HEADER_RE.match(t):
            n += 1
    return n


def _bbox_iou(a: Any, b: Any) -> Optional[float]:
    if not (tcand._bbox_ok(a) and tcand._bbox_ok(b)):
        return None
    ix = max(a["x"], b["x"]); iy = max(a["y"], b["y"])
    ix2 = min(a["x"] + a["width"], b["x"] + b["width"]); iy2 = min(a["y"] + a["height"], b["y"] + b["height"])
    inter = max(0.0, ix2 - ix) * max(0.0, iy2 - iy)
    union = a["width"] * a["height"] + b["width"] * b["height"] - inter
    return round(inter / union, 4) if union > 0 else None


def contrast_ratio(fg: Optional[str], bg: Optional[str]) -> Optional[float]:
    """Deterministic WCAG relative-contrast between two #rrggbb colors."""
    lf, lb = _rel_luminance(fg), _rel_luminance(bg)
    if lf is None or lb is None:
        return None
    hi, lo = max(lf, lb), min(lf, lb)
    return round((hi + 0.05) / (lo + 0.05), 3)


def _rel_luminance(color: Optional[str]) -> Optional[float]:
    if not isinstance(color, str):
        return None
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", color.strip())
    if not m:
        return None
    h = m.group(1)
    chan = []
    for i in range(0, 6, 2):
        c = int(h[i:i + 2], 16) / 255.0
        c = c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
        chan.append(c)
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2]


# ── Overflow / fit estimate (deterministic, conservative) ───────────────────


def estimate_overflow_cells(candidate: dict, *, min_font_pt: float = 6.0, char_w_factor: float = 0.5) -> int:
    """Conservative count of cells whose text cannot fit their bbox width even at
    the minimum readable font. Only flags egregious overflow (avoids false veto)."""
    n = 0
    for c in candidate.get("cells") or []:
        b = c.get("bbox")
        text = str(c.get("text") or "")
        if not tcand._bbox_ok(b) or not text:
            continue
        needed = len(text) * min_font_pt * char_w_factor
        # generous 8pt padding allowance; only flag when text is clearly too wide.
        if needed > (b["width"] - 4) * (int(c.get("colSpan", 1)) or 1) * 1.6:
            n += 1
    return n


# ── Integrity evaluation (Phases 9/10) ──────────────────────────────────────


def evaluate_table_integrity(candidate: Optional[dict], evidence: dict,
                             *, financial: Optional[bool] = None) -> dict:
    """Evaluate one candidate against the source evidence → TableIntegrityReportV1.
    Never mutates inputs. `financial` defaults to detection from the evidence."""
    source_region_id = evidence.get("sourceRegionId")
    fin = is_financial_table(evidence) if financial is None else bool(financial)
    hard: list[dict] = []
    problems: list[str] = []

    def defect(code: str, message: str, ev: Optional[dict] = None) -> None:
        hard.append({"code": code, "message": message, "evidence": ev or {}})

    # Evidence-level gates.
    crop_present = bool((evidence.get("crop") or {}).get("path"))
    if not crop_present:
        defect("source_table_crop_missing", "Source table has no usable source crop.")
    if not evidence.get("complete"):
        # Incomplete source evidence → unverifiable, never a false native.
        defect("source_table_evidence_incomplete", "Source table evidence is incomplete.",
               {"problems": evidence.get("problems") or []})

    if candidate is None:
        defect("candidate_missing", "No structured candidate was produced for this table.")
        return _report(source_region_id, None, "unverifiable", None, hard,
                       _empty_metrics(evidence), problems)

    cand_problems = candidate.get("problems") or tcand.validate_table_candidate(candidate)
    if cand_problems:
        defect("candidate_invalid", "Candidate failed structural validation.", {"problems": cand_problems})
    if not (candidate.get("cells") or []):
        defect("candidate_empty", "Candidate has no cells.")

    topo = evidence.get("topology") or {}
    src_rows = int(topo.get("numRows")) if isinstance(topo.get("numRows"), int) else None
    src_cols = int(topo.get("numCols")) if isinstance(topo.get("numCols"), int) else None
    cand_rows = int(candidate.get("numRows") or 0)
    cand_cols = int(candidate.get("numCols") or 0)

    # Row / column agreement.
    if src_rows is not None and src_rows > 0:
        if cand_rows < src_rows:
            defect("candidate_row_clipped", "Candidate has fewer rows than the source.",
                   {"sourceRows": src_rows, "candidateRows": cand_rows})
        if cand_rows != src_rows:
            defect("row_count_mismatch", "Candidate row count disagrees with the source.",
                   {"sourceRows": src_rows, "candidateRows": cand_rows})
    if src_cols is not None and src_cols > 0:
        if cand_cols < src_cols:
            defect("candidate_column_clipped", "Candidate has fewer columns than the source.",
                   {"sourceCols": src_cols, "candidateCols": cand_cols})
        if cand_cols != src_cols:
            defect("column_count_mismatch", "Candidate column count disagrees with the source.",
                   {"sourceCols": src_cols, "candidateCols": cand_cols})

    # Header integrity (Phase 11).
    source_headers = _source_header_texts(evidence)
    generic_headers = _generic_header_count(candidate)
    if source_headers and generic_headers > 0:
        defect("generic_header_substitution",
               "Candidate uses generic/blank headers where the source has header text.",
               {"genericHeaders": generic_headers, "sourceHeaders": len(source_headers)})
    if source_headers and int(candidate.get("headerRowCount") or 0) == 0:
        defect("source_header_missing", "Source has header text but the candidate has no header row.",
               {"sourceHeaders": len(source_headers)})
    header_recall = _header_token_recall(source_headers, candidate)
    if source_headers and header_recall is not None and header_recall < 0.999:
        defect("header_structure_mismatch", "Candidate does not preserve the source header tokens.",
               {"headerTokenRecall": header_recall})

    # Span validity / bbox containment.
    for c in candidate.get("cells") or []:
        if int(c.get("rowSpan", 1)) < 1 or int(c.get("colSpan", 1)) < 1:
            defect("cell_span_invalid", "Candidate contains an invalid cell span.")
            break
    if not _cell_bboxes_inside(candidate):
        defect("cell_bbox_outside_table", "A candidate cell bbox falls outside the table bbox.")

    # Numeric-cell association (financial safety).
    src_tok_cells = _source_token_cells(evidence)
    cand_tok_cells = _candidate_token_cells(candidate)
    src_multiplicity = _source_numeric_multiplicity(evidence)
    cand_multiplicity = _candidate_numeric_multiplicity(candidate)
    numeric_recall, numeric_precision, assoc_accuracy = _numeric_metrics(
        src_tok_cells, cand_tok_cells, src_multiplicity, cand_multiplicity, evidence)

    all_source_keys = set(_all_source_numeric_keys(evidence))
    missing = [k for k in all_source_keys if k not in cand_multiplicity]
    if missing:
        defect("source_numeric_token_missing", "A source numeric value is absent from the candidate.",
               {"missingCount": len(missing)})
    duplicated = [k for k, n in cand_multiplicity.items()
                  if k in all_source_keys and n > src_multiplicity.get(k, 0) and src_multiplicity.get(k, 0) <= 1 and n > 1]
    if duplicated:
        defect("source_numeric_token_duplicated", "A source numeric value is duplicated into unrelated cells.",
               {"duplicatedCount": len(duplicated)})
    wrong_cell = _wrong_cell_tokens(src_tok_cells, cand_tok_cells)
    if wrong_cell:
        defect("numeric_token_wrong_cell", "A source numeric value is associated with the wrong candidate cell.",
               {"wrongCount": len(wrong_cell)})
    # A financial table whose association cannot be measured is unverifiable.
    if fin and src_tok_cells and assoc_accuracy is None:
        defect("candidate_unscored", "Financial numeric-cell association could not be verified.")

    # Overflow / fit.
    overflow = estimate_overflow_cells(candidate)
    if overflow > 0:
        defect("candidate_overflow", "Candidate text cannot fit its cells at a readable font.",
               {"overflowCells": overflow})

    # Contrast safety.
    unreadable = _unreadable_contrast_count(candidate)
    if unreadable > 0:
        defect("candidate_unreadable_contrast", "Candidate has unreadable foreground/background contrast.",
               {"unreadableCells": unreadable})

    # bbox agreement candidate vs source region.
    iou = _bbox_iou(candidate.get("bbox"), evidence.get("bbox"))
    if iou is not None and iou < 0.5:
        defect("candidate_bbox_mismatch", "Candidate bbox disagrees with the source table region.",
               {"iou": iou})

    metrics = {
        "sourceRowCount": src_rows, "candidateRowCount": cand_rows,
        "sourceColumnCount": src_cols, "candidateColumnCount": cand_cols,
        "rowCountAgreement": _agreement(src_rows, cand_rows),
        "columnCountAgreement": _agreement(src_cols, cand_cols),
        "headerTokenRecall": header_recall,
        "headerStructureAgreement": (1.0 if source_headers and generic_headers == 0 and header_recall == 1.0 else
                                     (0.0 if source_headers and generic_headers > 0 else None)),
        "cellTextRecall": _cell_text_recall(evidence, candidate),
        "cellTextPrecision": _cell_text_precision(evidence, candidate),
        "numericTokenRecall": numeric_recall,
        "numericTokenPrecision": numeric_precision,
        "numericCellAssociationAccuracy": assoc_accuracy,
        "punctuationRecall": _punctuation_recall(evidence, candidate),
        "spanAgreement": _span_agreement(evidence, candidate),
        "bboxIoU": iou,
        "sourceOccupancyCoverage": _cell_text_recall(evidence, candidate),
        "candidateOverflowCount": overflow,
        "candidateClippedRowCount": max(0, (src_rows or 0) - cand_rows) if src_rows else 0,
        "genericHeaderCount": generic_headers,
        "adjacentMergeRisk": None,   # filled by detect_adjacent_merge
        "sourceSplitRisk": None,     # filled by detect_source_split
        "emptyCellRate": _empty_cell_rate(candidate),
        "duplicateCellRate": _duplicate_cell_rate(candidate),
    }

    # State + score.
    hard_codes = {d["code"] for d in hard}
    if hard_codes:
        state = "unverifiable" if hard_codes & {"source_table_evidence_incomplete", "candidate_missing", "candidate_unscored"} else "rejected"
        score = None
    else:
        score = _score(metrics, fin)
        state = "verified" if score is not None else "degraded"
    return _report(source_region_id, candidate.get("id"), state, score, hard, metrics, problems)


def _report(source_region_id, candidate_id, state, score, hard, metrics, problems) -> dict:
    return {
        "version": TABLE_INTEGRITY_REPORT_VERSION,
        "sourceRegionId": source_region_id,
        "candidateId": candidate_id,
        "state": state,
        "score": score,
        "hardDefects": hard,
        "metrics": metrics,
        "problems": sorted(set(problems)),
    }


def _empty_metrics(evidence: dict) -> dict:
    topo = evidence.get("topology") or {}
    return {
        "sourceRowCount": topo.get("numRows"), "candidateRowCount": 0,
        "sourceColumnCount": topo.get("numCols"), "candidateColumnCount": 0,
        "rowCountAgreement": None, "columnCountAgreement": None,
        "headerTokenRecall": None, "headerStructureAgreement": None,
        "cellTextRecall": None, "cellTextPrecision": None,
        "numericTokenRecall": None, "numericTokenPrecision": None, "numericCellAssociationAccuracy": None,
        "punctuationRecall": None, "spanAgreement": None, "bboxIoU": None, "sourceOccupancyCoverage": None,
        "candidateOverflowCount": None, "candidateClippedRowCount": None, "genericHeaderCount": 0,
        "adjacentMergeRisk": None, "sourceSplitRisk": None, "emptyCellRate": None, "duplicateCellRate": None,
    }


def _agreement(a: Optional[int], b: Optional[int]) -> Optional[float]:
    if a is None or b is None or max(a, b) == 0:
        return None
    return round(1.0 - abs(a - b) / max(a, b), 4)


def _all_source_numeric_keys(evidence: dict) -> list[str]:
    keys: list[str] = []
    for placement in evidence.get("sourceNumericTokens") or []:
        k = _numeric_key(placement.get("token") if isinstance(placement, dict) else None)
        if k:
            keys.append(k)
    if not keys:  # fall back to topology cell tokens when placements are unavailable
        for c in (evidence.get("topology") or {}).get("cells") or []:
            for tok in c.get("numericTokens") or []:
                k = _numeric_key(tok)
                if k:
                    keys.append(k)
    return keys


def _source_numeric_multiplicity(evidence: dict) -> dict[str, int]:
    counts: dict[str, int] = {}
    for k in _all_source_numeric_keys(evidence):
        counts[k] = counts.get(k, 0) + 1
    return counts


def _numeric_metrics(src_tok_cells, cand_tok_cells, src_mult, cand_mult, evidence):
    source_keys = set(_all_source_numeric_keys(evidence))
    if not source_keys:
        return None, (1.0 if not cand_mult else None), None
    found = sum(1 for k in source_keys if k in cand_mult)
    recall = round(found / len(source_keys), 4)
    cand_keys = set(cand_mult)
    precision = round(sum(1 for k in cand_keys if k in source_keys) / len(cand_keys), 4) if cand_keys else None
    # Association: fraction of source tokens with a known source cell whose value
    # lands in the SAME candidate cell.
    assoc_total = 0
    assoc_ok = 0
    for k, src_cells in src_tok_cells.items():
        assoc_total += 1
        cand_cells = cand_tok_cells.get(k, set())
        if cand_cells and src_cells & cand_cells:
            assoc_ok += 1
    assoc = round(assoc_ok / assoc_total, 4) if assoc_total else None
    return recall, precision, assoc


def _wrong_cell_tokens(src_tok_cells, cand_tok_cells) -> list[str]:
    wrong: list[str] = []
    for k, src_cells in src_tok_cells.items():
        cand_cells = cand_tok_cells.get(k)
        if cand_cells and not (src_cells & cand_cells):
            wrong.append(k)
    return wrong


def _header_token_recall(source_headers: list[str], candidate: dict) -> Optional[float]:
    if not source_headers:
        return None
    src_tokens: set[str] = set()
    for h in source_headers:
        for t in re.findall(r"\w+", h.lower()):
            src_tokens.add(t)
    if not src_tokens:
        return None
    cand_tokens: set[str] = set()
    for c in _candidate_header_cells(candidate):
        for t in re.findall(r"\w+", str(c.get("text") or "").lower()):
            cand_tokens.add(t)
    return round(len(src_tokens & cand_tokens) / len(src_tokens), 4)


def _cell_texts(container_cells) -> list[str]:
    return [ssg.normalize_nfc(str(c.get("text") or "")).strip() for c in container_cells if str(c.get("text") or "").strip()]


def _cell_text_recall(evidence: dict, candidate: dict) -> Optional[float]:
    src = _cell_texts((evidence.get("topology") or {}).get("cells") or [])
    if not src:
        return None
    cand = set(_cell_texts(candidate.get("cells") or []))
    return round(sum(1 for t in src if t in cand) / len(src), 4)


def _cell_text_precision(evidence: dict, candidate: dict) -> Optional[float]:
    cand = _cell_texts(candidate.get("cells") or [])
    if not cand:
        return None
    src = set(_cell_texts((evidence.get("topology") or {}).get("cells") or []))
    return round(sum(1 for t in cand if t in src) / len(cand), 4)


def _punctuation_recall(evidence: dict, candidate: dict) -> Optional[float]:
    src: set[str] = set()
    for placement in evidence.get("sourcePunctuationTokens") or []:
        tok = placement.get("token") if isinstance(placement, dict) else None
        if isinstance(tok, dict) and tok.get("kind"):
            src.add(str(tok["kind"]))
    if not src:
        return None
    cand: set[str] = set()
    for c in candidate.get("cells") or []:
        for tok in c.get("punctuationTokens") or []:
            if isinstance(tok, dict) and tok.get("kind"):
                cand.add(str(tok["kind"]))
    return round(len(src & cand) / len(src), 4)


def _span_agreement(evidence: dict, candidate: dict) -> Optional[float]:
    spans = [s.get("normalizedText") or "" for s in evidence.get("sourceSpans") or [] if (s.get("text") or "").strip()]
    if not spans:
        return None
    cand_text = " ".join(ssg.normalize_nfc(str(c.get("text") or "")) for c in candidate.get("cells") or [])
    found = sum(1 for s in spans if s and s in cand_text)
    return round(found / len(spans), 4)


def _empty_cell_rate(candidate: dict) -> Optional[float]:
    cells = candidate.get("cells") or []
    if not cells:
        return None
    empty = sum(1 for c in cells if not str(c.get("text") or "").strip())
    return round(empty / len(cells), 4)


def _duplicate_cell_rate(candidate: dict) -> Optional[float]:
    texts = [str(c.get("text") or "").strip() for c in candidate.get("cells") or [] if str(c.get("text") or "").strip()]
    if not texts:
        return None
    seen: set[str] = set()
    dupes = 0
    for t in texts:
        if t in seen:
            dupes += 1
        seen.add(t)
    return round(dupes / len(texts), 4)


def _cell_bboxes_inside(candidate: dict) -> bool:
    tb = candidate.get("bbox")
    if not tcand._bbox_ok(tb):
        return True  # cannot check → don't veto here
    for c in candidate.get("cells") or []:
        b = c.get("bbox")
        if not tcand._bbox_ok(b):
            continue
        if b["x"] < tb["x"] - 2 or b["y"] < tb["y"] - 2 or \
           b["x"] + b["width"] > tb["x"] + tb["width"] + 2 or b["y"] + b["height"] > tb["y"] + tb["height"] + 2:
            return False
    return True


def _unreadable_contrast_count(candidate: dict) -> int:
    n = 0
    for c in candidate.get("cells") or []:
        style = c.get("style") if isinstance(c.get("style"), dict) else None
        if not style:
            continue
        cr = contrast_ratio(style.get("color"), style.get("bg"))
        if cr is not None and cr < MIN_CONTRAST_RATIO:
            n += 1
    return n


def _score(metrics: dict, financial: bool) -> Optional[float]:
    """Deterministic integrity score in [0,1] — computed ONLY for candidates with
    zero hard defects. Never used to override a hard defect."""
    parts: list[tuple[float, float]] = []  # (value, weight)

    def add(value, weight):
        if value is not None:
            parts.append((max(0.0, min(1.0, float(value))), weight))

    add(metrics.get("rowCountAgreement"), 2.0)
    add(metrics.get("columnCountAgreement"), 2.0)
    add(metrics.get("headerTokenRecall"), 1.5)
    add(metrics.get("cellTextRecall"), 2.0)
    add(metrics.get("numericTokenRecall"), 2.0)
    add(metrics.get("numericCellAssociationAccuracy"), 3.0 if financial else 1.5)
    add(metrics.get("spanAgreement"), 1.0)
    add(metrics.get("bboxIoU"), 1.0)
    if not parts:
        return None
    total_w = sum(w for _, w in parts)
    return round(sum(v * w for v, w in parts) / total_w, 4)


# ── Adjacent-merge + split detection (Phases 13/14) ─────────────────────────


def detect_adjacent_merge(candidate: dict, all_source_table_regions: list[dict]) -> Optional[dict]:
    """Detect a candidate that materially spans two or more independent source
    table regions. Returns a hard defect dict, or None. Never 'repairs' by
    splitting semantically — the candidate is rejected."""
    cb = candidate.get("bbox")
    if not tcand._bbox_ok(cb):
        return None
    covered = 0
    for region in all_source_table_regions:
        if region.get("type") != "table":
            continue
        rb = region.get("bbox")
        iou = _bbox_iou(cb, rb)
        # "materially covers" = candidate substantially overlaps a distinct region.
        if iou is not None and iou > 0.15 and _overlap_fraction(rb, cb) > 0.5:
            covered += 1
    if covered >= 2:
        return {"code": "adjacent_source_tables_merged",
                "message": "One candidate materially spans multiple independent source tables.",
                "evidence": {"coveredSourceTables": covered}}
    return None


def _overlap_fraction(inner: Any, outer: Any) -> float:
    if not (tcand._bbox_ok(inner) and tcand._bbox_ok(outer)):
        return 0.0
    ix = max(inner["x"], outer["x"]); iy = max(inner["y"], outer["y"])
    ix2 = min(inner["x"] + inner["width"], outer["x"] + outer["width"])
    iy2 = min(inner["y"] + inner["height"], outer["y"] + outer["height"])
    inter = max(0.0, ix2 - ix) * max(0.0, iy2 - iy)
    area = inner["width"] * inner["height"]
    return inter / area if area > 0 else 0.0


def detect_source_split(candidates: list[dict], evidence: dict) -> Optional[dict]:
    """Detect one source table fragmented into multiple candidates for the SAME
    source region with disjoint contiguous row ranges. Returns a hard defect dict
    when the split is ambiguous (a deterministic exact partition is NOT flagged)."""
    same = [c for c in candidates if c.get("sourceRegionId") == evidence.get("sourceRegionId")]
    if len(same) < 2:
        return None
    # Multiple candidates for one region from the SAME provider profile that
    # partition the row space are a split; different providers are alternates.
    by_provider: dict[str, list[dict]] = {}
    for c in same:
        by_provider.setdefault(str(c.get("provider")), []).append(c)
    for provider, group in by_provider.items():
        if len(group) < 2:
            continue
        return {"code": "single_source_table_split",
                "message": "One source table produced multiple fragmented candidates.",
                "evidence": {"provider": provider, "fragments": len(group)}}
    return None


# ── Arbitration (Phase 15) ──────────────────────────────────────────────────


def arbitrate_table_candidates(
    *,
    source_region_id: str,
    candidates: list[dict],
    reports: list[dict],
    source_crop_available: bool,
    page_raster_available: bool,
    financial: bool = False,
) -> dict:
    """Deterministically select the strongest SAFE candidate, else the exact
    source crop, else E0 containment, else block. A hard defect is disqualifying;
    a weighted score never overrides it."""
    report_by_id = {r.get("candidateId"): r for r in reports}
    cand_by_id = {c.get("id"): c for c in candidates}

    safe: list[tuple[dict, dict]] = []
    rejected: list[str] = []
    for cand in candidates:
        rep = report_by_id.get(cand.get("id"))
        if rep is None:
            rejected.append(cand.get("id"))
            continue
        hard = rep.get("hardDefects") or []
        assoc = (rep.get("metrics") or {}).get("numericCellAssociationAccuracy")
        assoc_ok = (not financial) or (assoc == 1.0)
        if not hard and rep.get("state") == "verified" and assoc_ok:
            safe.append((cand, rep))
        else:
            rejected.append(cand.get("id"))

    ranked = _rank_candidates(safe)
    ranked_ids = [c["id"] for c, _ in ranked]

    if ranked:
        top_cand, top_rep = ranked[0]
        return _arbitration(source_region_id, "native_verified", top_cand["id"], top_rep,
                            ranked_ids, rejected, source_crop_available,
                            "native_candidate_verified")
    if source_crop_available:
        return _arbitration(source_region_id, "source_crop", None, None, ranked_ids, rejected,
                            True, "no_safe_candidate_source_crop_used")
    if page_raster_available:
        return _arbitration(source_region_id, "containment_fallback", None, None, ranked_ids, rejected,
                            False, "no_safe_candidate_no_crop_page_raster_fallback")
    return _arbitration(source_region_id, "blocked", None, None, ranked_ids, rejected,
                        False, "no_safe_candidate_no_crop_no_raster_blocked")


def _rank_candidates(safe: list[tuple[dict, dict]]) -> list[tuple[dict, dict]]:
    def key(pair):
        cand, rep = pair
        m = rep.get("metrics") or {}
        return (
            -(rep.get("score") or 0.0),
            -(m.get("numericCellAssociationAccuracy") or 0.0),
            -(m.get("headerTokenRecall") or 0.0),
            -(m.get("rowCountAgreement") or 0.0),
            -(m.get("spanAgreement") or 0.0),
            -(m.get("bboxIoU") or 0.0),
            _provider_rank(cand.get("provider")),
            str(cand.get("id")),
        )
    return sorted(safe, key=key)


def _provider_rank(provider: Optional[str]) -> int:
    try:
        return PROVIDER_PRIORITY.index(str(provider))
    except ValueError:
        return len(PROVIDER_PRIORITY)


def _arbitration(source_region_id, state, selected_id, selected_report, ranked, rejected,
                 crop_available, reason) -> dict:
    problems: list[str] = []
    if state == "source_crop" and not crop_available:
        problems.append("claimed_source_crop_without_crop")
    return {
        "version": TABLE_ARBITRATION_VERSION,
        "sourceRegionId": source_region_id,
        "state": state,
        "selectedCandidateId": selected_id,
        "selectedIntegrityReport": selected_report,
        "rankedCandidateIds": ranked,
        "rejectedCandidateIds": rejected,
        "sourceCropAvailable": bool(crop_available),
        "reason": reason,
        "problems": problems,
    }


# ── Table preservation plan (Phase 16) ──────────────────────────────────────

_STATE_TO_RENDER = {
    "native_verified": "verified-native-table",
    "source_crop": "table-source-crop",
    "containment_fallback": "containment-fallback",
    "blocked": "blocked",
}


def build_table_preservation_plan(
    *,
    regions: list[dict],
    arbitrations: dict,
    review_required_on_crop: bool = True,
) -> dict:
    """Per-page table preservation plan + suppression sets + metrics. `arbitrations`
    maps source-region-id → TableArbitrationResultV1. Deterministic; regions are
    not mutated."""
    by_parent: dict[str, list[str]] = {}
    region_ids = {r.get("id") for r in regions}
    for r in regions:
        parent = (r.get("relationships") or {}).get("parentRegionId")
        if parent:
            by_parent.setdefault(parent, []).append(r["id"])

    table_regions = [r for r in regions if r.get("type") == "table"]
    plans: list[dict] = []
    mode_counts = {"verified-native-table": 0, "table-source-crop": 0, "containment-fallback": 0, "blocked": 0}
    suppressed_total = 0
    for region in table_regions:
        arb = arbitrations.get(region.get("id"))
        state = arb.get("state") if arb else "containment_fallback"
        mode = _STATE_TO_RENDER.get(state, "containment-fallback")
        mode_counts[mode] += 1
        rep = (arb or {}).get("selectedIntegrityReport") or {}
        hard_codes = [d.get("code") for d in rep.get("hardDefects") or []]
        # Suppress children only when the SOURCE CROP is the final visual (native
        # verified renders the native table; children handled by the renderer's
        # own layout, so still suppress duplicate child text/vector overlays).
        suppress_region_ids: list[str] = []
        if mode in ("table-source-crop", "verified-native-table"):
            suppress_region_ids = ssg._descendant_region_ids(region["id"], by_parent)
            # A nested chart inside a source-cropped table is suppressed (outer wins).
        suppressed_total += len(suppress_region_ids)
        manual = mode == "blocked" or (mode == "table-source-crop" and review_required_on_crop)
        plans.append({
            "version": TABLE_PRESERVATION_VERSION,
            "regionId": region["id"],
            "pageNumber": region.get("pageNumber"),
            "renderMode": mode,
            "selectedCandidateId": (arb or {}).get("selectedCandidateId"),
            "sourceCropPath": (region.get("sourceCrop") or {}).get("path"),
            "suppressRegionIds": suppress_region_ids,
            "suppressOverlayIds": [],  # resolved by the TS renderer bridge
            "integrityState": rep.get("state") or ("unverifiable" if not arb else "n/a"),
            "integrityScore": rep.get("score"),
            "hardDefectCodes": hard_codes,
            "manualReviewRequired": manual,
            "reason": (arb or {}).get("reason") or "no_arbitration",
            "orphanSuppressedRegionIds": [rid for rid in suppress_region_ids if rid not in region_ids],
        })

    n = len(table_regions)
    native = mode_counts["verified-native-table"]
    crop = mode_counts["table-source-crop"]
    metrics = {
        "tableRegionCount": n,
        "nativeVerifiedTableCount": native,
        "sourceCropTableCount": crop,
        "containmentFallbackTableCount": mode_counts["containment-fallback"],
        "blockedTableCount": mode_counts["blocked"],
        "tableRenderModeCounts": dict(mode_counts),
        "suppressedRegionCount": suppressed_total,
        "tableCropAvailability": _ratio(sum(1 for p in plans if p["sourceCropPath"]), n),
    }
    problems: list[str] = []
    for p in plans:
        if p["renderMode"] == "blocked":
            problems.append(f"table_blocked:{p['regionId']}")
        if p["orphanSuppressedRegionIds"]:
            problems.append(f"table_suppression_orphan:{p['regionId']}")
    return {
        "version": TABLE_PRESERVATION_VERSION,
        "tables": plans,
        "metrics": metrics,
        "problems": problems,
        "complete": n == 0 or (all(p["renderMode"] != "blocked" for p in plans) and not problems),
    }

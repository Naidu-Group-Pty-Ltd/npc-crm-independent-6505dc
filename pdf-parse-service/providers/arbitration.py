"""E9 — provider evidence conflict model + arbitration (pure).

The arbitrator decides which provider evidence becomes a CANDIDATE INPUT — it
never decides final output. A provider NEVER wins by name or by confidence alone.
Source agreement, exact numeric/punctuation integrity and table topology outrank
confidence, latency and cost. Conflicts are never resolved by averaging text or
numbers or by picking the highest confidence automatically.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .contracts import PROVIDER_ARBITRATION_VERSION, SourceBBox
from .normalization import critical_glyph_signature, normalize_text

CONFLICT_CODES: Tuple[str, ...] = (
    "provider_text_conflict", "provider_unicode_conflict", "provider_numeric_conflict",
    "provider_punctuation_conflict", "provider_bbox_conflict", "provider_region_type_conflict",
    "provider_table_topology_conflict", "provider_table_cell_conflict", "provider_chart_class_conflict",
    "provider_reading_order_conflict", "provider_page_count_conflict", "provider_page_geometry_conflict",
    "provider_missing_region", "provider_extra_region", "provider_confidence_conflict",
)

# Conflicts that BLOCK automatic preference of a provider (must fall to multiple
# candidates / fallback until E4/E5/E7/E8 resolve them).
_BLOCKING_CONFLICTS = frozenset({
    "provider_numeric_conflict", "provider_punctuation_conflict", "provider_unicode_conflict",
    "provider_table_cell_conflict", "provider_table_topology_conflict",
})


@dataclass
class ProviderConflictV1:
    conflict_type: str
    evidence_ids: List[str]
    canonical_region_id: Optional[str]
    measured_difference: Optional[float]
    resolution_state: str  # unresolved | source-preferred | multiple-candidates
    problems: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, object]:
        code = self.conflict_type if self.conflict_type in CONFLICT_CODES else "provider_text_conflict"
        return {
            "conflictType": code, "evidenceIds": list(self.evidence_ids), "canonicalRegionId": self.canonical_region_id,
            "measuredDifference": self.measured_difference, "resolutionState": self.resolution_state, "problems": list(self.problems),
        }


def numbers_in(text: str) -> List[str]:
    import re
    return re.findall(r"[-−]?\d[\d,\.]*", text or "")


def detect_text_conflict(evidence_id_a: str, text_a: str, evidence_id_b: str, text_b: str, region_id: Optional[str]) -> List[ProviderConflictV1]:
    """Compare two providers' text for the SAME region. Never resolves by averaging."""
    out: List[ProviderConflictV1] = []
    na, nb = normalize_text(text_a), normalize_text(text_b)
    if na["raw"] == nb["raw"]:
        return out  # agreement
    # numeric conflict (blocks automatic preference).
    if numbers_in(text_a) != numbers_in(text_b):
        out.append(ProviderConflictV1("provider_numeric_conflict", [evidence_id_a, evidence_id_b], region_id, None, "unresolved"))
    # critical punctuation/glyph conflict.
    if critical_glyph_signature(text_a) != critical_glyph_signature(text_b):
        out.append(ProviderConflictV1("provider_punctuation_conflict", [evidence_id_a, evidence_id_b], region_id, None, "unresolved"))
    # generic text conflict (recorded, non-blocking on its own).
    if na["searchNormalized"] != nb["searchNormalized"] and not out:
        out.append(ProviderConflictV1("provider_text_conflict", [evidence_id_a, evidence_id_b], region_id, None, "multiple-candidates"))
    return out


def bbox_iou(a: SourceBBox, b: SourceBBox) -> float:
    ix = max(a.x, b.x); iy = max(a.y, b.y)
    ix2 = min(a.x + a.width, b.x + b.width); iy2 = min(a.y + a.height, b.y + b.height)
    inter = max(0.0, ix2 - ix) * max(0.0, iy2 - iy)
    union = a.area() + b.area() - inter
    return inter / union if union > 0 else 0.0


# ── Arbitration ──────────────────────────────────────────────────────────────

@dataclass
class ProviderArbitrationResultV1:
    page_number: int
    region_id: Optional[str]
    candidate_evidence_ids: List[str]
    preferred_evidence_id: Optional[str]
    rejected_evidence_ids: List[str]
    unresolved_conflict_ids: List[str]
    resolution: str  # candidate-ready | multiple-candidates | source-evidence-only | fallback-required | blocked
    reason: str
    problems: List[str] = field(default_factory=list)
    version: str = PROVIDER_ARBITRATION_VERSION


@dataclass
class ArbitrationCandidateInput:
    evidence_id: str
    provider_id: str
    policy_permitted: bool
    scope_complete: bool
    source_visual_agreement: Optional[float]  # 0..1 vs source (None = not measured)
    numeric_integrity: bool
    punctuation_integrity: bool
    table_integrity: Optional[bool]  # None when not a table
    geometry_agreement: Optional[float]
    region_coverage: Optional[float]
    e7_score: Optional[float]
    latency_ms: Optional[float]
    estimated_cost: Optional[float]


def arbitrate(
    page_number: int,
    region_id: Optional[str],
    candidates: List[ArbitrationCandidateInput],
    conflicts: List[ProviderConflictV1],
) -> ProviderArbitrationResultV1:
    """Deterministic arbitration. Provider name/confidence never a criterion."""
    unresolved = [c for c in conflicts if c.resolution_state == "unresolved" and c.conflict_type in _BLOCKING_CONFLICTS]
    unresolved_ids = [":".join(sorted(c.evidence_ids)) for c in unresolved]

    eligible = [c for c in candidates if _hard_eligible(c)]
    rejected = [c.evidence_id for c in candidates if c not in eligible]

    if not candidates:
        return ProviderArbitrationResultV1(page_number, region_id, [], None, [], unresolved_ids, "source-evidence-only", "no_provider_candidates")
    if unresolved:
        # a blocking numeric/table/punctuation conflict → never auto-prefer.
        return ProviderArbitrationResultV1(page_number, region_id, [c.evidence_id for c in eligible], None, rejected, unresolved_ids, "multiple-candidates", "unresolved_blocking_conflict")
    if not eligible:
        return ProviderArbitrationResultV1(page_number, region_id, [], None, rejected, unresolved_ids, "fallback-required", "no_eligible_candidate")

    # Deterministic lexicographic key (higher first) — provider name absent. The
    # final tie-break is ascending evidence id: pre-sort ascending, then stable
    # reverse-sort on the numeric key preserves it among equals.
    def key(c: ArbitrationCandidateInput) -> Tuple:
        return (
            1 if c.policy_permitted else 0,
            1 if c.scope_complete else 0,
            round(c.source_visual_agreement or 0.0, 4),
            1 if c.numeric_integrity else 0,
            1 if c.punctuation_integrity else 0,
            1 if (c.table_integrity is None or c.table_integrity) else 0,
            round(c.geometry_agreement or 0.0, 4),
            round(c.region_coverage or 0.0, 4),
            round(c.e7_score or 0.0, 4),
            -round(c.latency_ms or 0.0, 2),          # lower latency better
            -round(c.estimated_cost or 0.0, 6),      # lower cost better (secondary)
        )

    by_id = sorted(eligible, key=lambda c: c.evidence_id)  # ascending id tie-break
    ranked = sorted(by_id, key=key, reverse=True)          # stable → id order kept on ties
    preferred = ranked[0]
    resolution = "candidate-ready" if len(ranked) == 1 else "multiple-candidates"
    return ProviderArbitrationResultV1(
        page_number, region_id, [c.evidence_id for c in ranked], preferred.evidence_id, rejected, unresolved_ids,
        resolution, "arbitrated_by_source_fidelity",
    )


def _hard_eligible(c: ArbitrationCandidateInput) -> bool:
    if not c.policy_permitted or not c.scope_complete:
        return False
    if not c.numeric_integrity or not c.punctuation_integrity:
        return False
    if c.table_integrity is False:
        return False
    return True

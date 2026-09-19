"""PDF Extraction V3 · E10 — routing audit (pdf-routing-audit-v1).

A compact, PII-safe, deterministic audit record of how a plan routed. It folds
the plan identity, the resolved-class distribution, the admission outcomes and
the reason-code histogram into ONE record whose ``audit_id`` is a pure function
of its content. It embeds NO signed URL, NO source path, NO wall-clock and NO
job id — only the plan's structural identity and aggregate routing facts.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List

from .contracts import (
    PDF_ROUTING_AUDIT_VERSION,
    PdfExtractionPlanV3,
    ROUTING_SAFE_REASON_CODES,
    stable_hash,
)


def build_routing_audit(plan: PdfExtractionPlanV3) -> Dict[str, Any]:
    """Summarize a plan's routing into a deterministic audit record."""
    class_pages: Counter = Counter()
    admitted_pages = 0
    degraded_pages = 0
    reason_hist: Counter = Counter()

    for decision in plan.route_decisions:
        n = len(decision.page_numbers)
        class_pages[decision.resolved_class] += n
        if decision.admitted:
            admitted_pages += n
        else:
            degraded_pages += n
        for code in decision.reason_codes:
            # Only record codes from the known safe vocabulary; drop anything
            # unexpected so the audit can never leak free-form text.
            if code in ROUTING_SAFE_REASON_CODES:
                reason_hist[code] += 1

    pages_by_class = {cls: class_pages[cls] for cls in sorted(class_pages)}
    reason_histogram = {code: reason_hist[code] for code in sorted(reason_hist)}

    audit = {
        "version": PDF_ROUTING_AUDIT_VERSION,
        "plan_id": plan.plan_id,
        "plan_hash": plan.plan_hash,
        "registry_id": plan.registry_id,
        "routing_policy_id": plan.routing_policy_id,
        "provider_policy_id": plan.provider_policy_id,
        "page_count": plan.page_count,
        "effective_mode": plan.effective_mode,
        "pages_by_class": pages_by_class,
        "admitted_pages": admitted_pages,
        "degraded_pages": degraded_pages,
        "chunk_count": len(plan.chunk_plan),
        "reason_histogram": reason_histogram,
    }
    audit["audit_id"] = stable_hash("raud", audit)
    return audit

"""PDF Extraction V3 · E10 — deterministic recovery planning (pdf-recovery-plan-v1).

When an execution attempt fails, the recovery layer chooses ONE deterministic
next action from the attempt history. The cardinal rules:

  * A RETRY reuses the SAME plan and the SAME route — the plan id/hash never
    change on a retry. Retries are bounded (``max_same_route_attempts``).
  * A REROUTE is a genuinely different route (e.g. degrade to a local class or
    to raster-only). A reroute is signalled as ``reroute`` and the caller MUST
    build a NEW plan for it — recovery never mutates the existing plan.
  * A raster-only fallback is always available EXCEPT when there is no source
    raster, in which case recovery ABORTS to manual review — never a false
    fallback claim.

The decision is a pure function of (route class, attempt outcomes, whether a
source raster exists, budget) — no wall-clock, no randomness.
"""
from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

from .contracts import (
    PDF_RECOVERY_PLAN_VERSION,
    SERVICE_CLASS_DOCAI_AU,
    SERVICE_CLASS_FAST_CPU,
    SERVICE_CLASS_HEAVY_CPU_AU,
    SERVICE_CLASS_RASTER_ONLY,
    SERVICE_CLASS_VLM_GPU_SG,
    ExecutionAttemptV1,
    stable_hash,
)

# How many attempts on the SAME route we allow before rerouting.
MAX_SAME_ROUTE_ATTEMPTS = 2

RECOVERY_ACTIONS = ("retry_same_route", "reroute", "fallback_raster_only", "abort_manual_review")

# Transient failures are worth a same-route retry; deterministic ones are not.
_TRANSIENT_ERROR_CODES = frozenset(
    {
        "provider_timeout",
        "provider_rate_limited",
        "provider_quota_exceeded",
        "route_target_unavailable",
        "execution_timeout",
        "execution_transient",
    }
)

# The deterministic reroute ladder for a failed class (never elevates). A failed
# remote class degrades to the strongest LOCAL class first (heavy AU CPU), then
# fast CPU, then raster-only — remote failures never re-attempt remotely.
_REROUTE_LADDER = {
    SERVICE_CLASS_VLM_GPU_SG: SERVICE_CLASS_HEAVY_CPU_AU,
    SERVICE_CLASS_DOCAI_AU: SERVICE_CLASS_HEAVY_CPU_AU,
    SERVICE_CLASS_HEAVY_CPU_AU: SERVICE_CLASS_FAST_CPU,
    SERVICE_CLASS_FAST_CPU: SERVICE_CLASS_RASTER_ONLY,
    SERVICE_CLASS_RASTER_ONLY: SERVICE_CLASS_RASTER_ONLY,
}


def _same_route_attempts(attempts: Sequence[ExecutionAttemptV1], route_class: str) -> int:
    return sum(1 for a in attempts if a.route_class == route_class)


def plan_recovery(
    current_class: str,
    attempts: Sequence[ExecutionAttemptV1],
    last_error_code: Optional[str],
    has_source_raster: bool,
    max_same_route_attempts: int = MAX_SAME_ROUTE_ATTEMPTS,
) -> dict:
    """Decide the single next recovery action deterministically.

    Returns a ``pdf-recovery-plan-v1`` dict: action, next_class (for reroute),
    reason_codes and a deterministic recovery_id.
    """
    reasons: List[str] = []
    same_route = _same_route_attempts(attempts, current_class)
    transient = last_error_code in _TRANSIENT_ERROR_CODES

    if transient and same_route < max_same_route_attempts:
        action = "retry_same_route"
        next_class = current_class
        reasons.append("recovery_retry_same_route")
    else:
        # No more same-route retries (or a deterministic failure). Reroute down
        # the ladder; a genuine reroute REQUIRES a new plan from the caller.
        next_class = _REROUTE_LADDER.get(current_class, SERVICE_CLASS_RASTER_ONLY)
        if next_class == current_class == SERVICE_CLASS_RASTER_ONLY:
            # Already at the floor. Only a source raster can save it.
            if has_source_raster:
                action = "fallback_raster_only"
                reasons.append("recovery_fallback_raster_only")
            else:
                action = "abort_manual_review"
                reasons.append("recovery_abort_no_source_raster")
                reasons.append("recovery_exhausted_manual_review")
        elif next_class == SERVICE_CLASS_RASTER_ONLY:
            # A reroute down to raster-only still requires a new plan (the route
            # class changed); it succeeds only when a source raster exists.
            if has_source_raster:
                action = "fallback_raster_only"
                reasons.append("recovery_reroute_new_plan")
                reasons.append("recovery_fallback_raster_only")
            else:
                action = "abort_manual_review"
                reasons.append("recovery_abort_no_source_raster")
        else:
            action = "reroute"
            reasons.append("recovery_reroute_new_plan")

    plan = {
        "version": PDF_RECOVERY_PLAN_VERSION,
        "action": action,
        "from_class": current_class,
        "next_class": next_class if action in ("reroute", "fallback_raster_only", "retry_same_route") else None,
        "same_route_attempts": same_route,
        "max_same_route_attempts": max_same_route_attempts,
        "has_source_raster": bool(has_source_raster),
        "reason_codes": reasons,
    }
    plan["recovery_id"] = stable_hash(
        "rcv",
        {
            "version": plan["version"],
            "action": plan["action"],
            "from_class": plan["from_class"],
            "next_class": plan["next_class"],
            "same_route_attempts": plan["same_route_attempts"],
            "max_same_route_attempts": plan["max_same_route_attempts"],
            "has_source_raster": plan["has_source_raster"],
            "reason_codes": plan["reason_codes"],
        },
    )
    return plan

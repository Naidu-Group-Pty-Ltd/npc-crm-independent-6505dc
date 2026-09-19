"""PDF Extraction V3 · E10 — service routing (policy + route decisions + targets).

Two-stage routing:

  1. DESIRED class — a deterministic function of page complexity alone. This is
     what the planner would pick with unlimited budget and every class enabled.
  2. RESOLVED class — the desired class after FAIL-CLOSED policy gating. A
     remote / GPU class is only granted when the policy independently approves
     the remote flag, the region residency, the GPU risk AND the per-job budget.
     Otherwise the route degrades deterministically to a permitted local class,
     and (worst case) to ``raster_only`` — never to a silently-elevated class.

Route decisions are grouped by resolved class over contiguous complexity so the
chunk plan is stable. A physical target is resolved SEPARATELY and never enters
plan identity — the plan names a class; the runtime binds the host.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

from .contracts import (
    PDF_EXECUTION_TARGET_VERSION,
    PDF_SERVICE_ROUTE_DECISION_VERSION,
    PDF_SERVICE_ROUTING_POLICY_VERSION,
    SERVICE_CLASS_DOCAI_AU,
    SERVICE_CLASS_FAST_CPU,
    SERVICE_CLASS_HEAVY_CPU_AU,
    SERVICE_CLASS_RASTER_ONLY,
    SERVICE_CLASS_VLM_GPU_SG,
    SERVICE_CLASS_REGION,
    ExecutionTargetV1,
    PdfPageComplexityV1,
    ServiceClassRegistryV1,
    ServiceRouteDecisionV1,
    ServiceRoutingPolicyV1,
    stable_hash,
)

# ── Default fail-closed policy ───────────────────────────────────────────────


def default_routing_policy() -> ServiceRoutingPolicyV1:
    """Local-only, remote + GPU disabled, zero remote/gpu budget. Fail-closed.

    A public caller can never elevate to a remote or GPU class with this policy;
    activating remote routing is an explicit, out-of-band configuration change
    (mirrors the E9 fail-closed provider policy).
    """
    policy_id = stable_hash(
        "svcpol",
        {
            "version": PDF_SERVICE_ROUTING_POLICY_VERSION,
            "enabled_classes": [SERVICE_CLASS_FAST_CPU, SERVICE_CLASS_HEAVY_CPU_AU, SERVICE_CLASS_RASTER_ONLY],
            "remote_classes_enabled": False,
            "gpu_classes_enabled": False,
            "approved_regions": ["local", "australia-southeast1"],
            "require_explicit_remote_approval": True,
            "max_remote_pages_per_job": 0,
            "max_gpu_pages_per_job": 0,
        },
    )
    return ServiceRoutingPolicyV1(
        version=PDF_SERVICE_ROUTING_POLICY_VERSION,
        policy_id=policy_id,
        enabled_classes=(SERVICE_CLASS_FAST_CPU, SERVICE_CLASS_HEAVY_CPU_AU, SERVICE_CLASS_RASTER_ONLY),
        remote_classes_enabled=False,
        gpu_classes_enabled=False,
        approved_regions=("local", "australia-southeast1"),
        require_explicit_remote_approval=True,
        max_remote_pages_per_job=0,
        max_gpu_pages_per_job=0,
    )


# ── Desired class from complexity (pre-policy) ───────────────────────────────

_TIER_DESIRED_CLASS = {
    "native_simple": SERVICE_CLASS_FAST_CPU,
    "native_rich": SERVICE_CLASS_HEAVY_CPU_AU,
    "scanned": SERVICE_CLASS_HEAVY_CPU_AU,
    "design_heavy": SERVICE_CLASS_HEAVY_CPU_AU,
    "unreadable": SERVICE_CLASS_RASTER_ONLY,
}

_DESIRED_REASON = {
    SERVICE_CLASS_FAST_CPU: "route_class_local_default",
    SERVICE_CLASS_HEAVY_CPU_AU: "route_class_heavy_tables",
    SERVICE_CLASS_DOCAI_AU: "route_class_docai_requested",
    SERVICE_CLASS_VLM_GPU_SG: "route_class_vlm_requested",
    SERVICE_CLASS_RASTER_ONLY: "route_class_raster_only",
}


def desired_class_for_page(page: PdfPageComplexityV1) -> str:
    """The class the planner wants for this page, ignoring policy/budget.

    VLM is only ever *desired* when a page explicitly requires it; OCR/scanned
    pages desire the heavy AU CPU class (Docling OCR), not a remote provider —
    remote is opt-in, never the default desire.
    """
    if page.requires_vlm:
        return SERVICE_CLASS_VLM_GPU_SG
    return _TIER_DESIRED_CLASS.get(page.tier, SERVICE_CLASS_HEAVY_CPU_AU)


# ── Fail-closed admission of a desired class ─────────────────────────────────


def _admit_class(
    desired: str,
    policy: ServiceRoutingPolicyV1,
    registry: ServiceClassRegistryV1,
    page_count: int,
    remote_approved: bool,
) -> Tuple[str, bool, List[str]]:
    """Resolve a desired class to a permitted one under fail-closed policy.

    Returns (resolved_class, admitted, reason_codes). ``admitted`` is True when
    the desired class itself was granted; False when it was degraded.
    """
    reasons: List[str] = [_DESIRED_REASON.get(desired, "route_class_local_default")]
    cap = registry.get(desired)

    # Unknown class or class not enabled -> degrade.
    if cap is None or desired not in policy.enabled_classes:
        reasons.append("route_blocked_class_disabled")
        return _degrade(desired, policy, registry, reasons)

    # Remote gating (fail-closed, each risk checked independently).
    if cap.remote:
        if not policy.remote_classes_enabled:
            reasons.append("route_blocked_remote_not_approved")
            return _degrade(desired, policy, registry, reasons)
        if policy.require_explicit_remote_approval and not remote_approved:
            reasons.append("route_blocked_remote_not_approved")
            return _degrade(desired, policy, registry, reasons)
        if cap.region not in policy.approved_regions:
            reasons.append("route_blocked_residency_not_approved")
            return _degrade(desired, policy, registry, reasons)
        if policy.max_remote_pages_per_job <= 0 or page_count > policy.max_remote_pages_per_job:
            reasons.append("route_blocked_budget_exhausted")
            return _degrade(desired, policy, registry, reasons)

    # GPU gating (independent of remote).
    if cap.gpu:
        if not policy.gpu_classes_enabled:
            reasons.append("route_blocked_gpu_not_approved")
            return _degrade(desired, policy, registry, reasons)
        if policy.max_gpu_pages_per_job <= 0 or page_count > policy.max_gpu_pages_per_job:
            reasons.append("route_blocked_budget_exhausted")
            return _degrade(desired, policy, registry, reasons)

    return desired, True, reasons


def _degrade(
    desired: str,
    policy: ServiceRoutingPolicyV1,
    registry: ServiceClassRegistryV1,
    reasons: List[str],
) -> Tuple[str, bool, List[str]]:
    """Deterministic degrade ladder: heavy_cpu_au -> fast_cpu -> raster_only.

    Never elevates. Picks the strongest LOCAL, ENABLED, non-remote, non-gpu
    class that can still do useful work, else raster-only.
    """
    ladder = (SERVICE_CLASS_HEAVY_CPU_AU, SERVICE_CLASS_FAST_CPU, SERVICE_CLASS_RASTER_ONLY)
    for candidate in ladder:
        cap = registry.get(candidate)
        if cap is None or candidate in (desired,):
            continue
        if candidate not in policy.enabled_classes:
            continue
        if cap.remote or cap.gpu:
            continue
        if candidate == SERVICE_CLASS_RASTER_ONLY:
            reasons.append("route_fallback_raster_only")
        return candidate, False, reasons
    # Absolute floor: raster-only, even if not "enabled" — a raster page is the
    # last-resort output, never a false success.
    reasons.append("route_fallback_raster_only")
    return SERVICE_CLASS_RASTER_ONLY, False, reasons


# ── Route decisions grouped into contiguous runs ─────────────────────────────


def route_pages(
    pages: Tuple[PdfPageComplexityV1, ...],
    policy: ServiceRoutingPolicyV1,
    registry: ServiceClassRegistryV1,
    remote_approved: bool = False,
) -> Tuple[ServiceRouteDecisionV1, ...]:
    """Produce grouped route decisions over contiguous same-resolved-class runs.

    Pages are processed in page-number order. Adjacent pages that resolve to the
    same class with the same desired class and reasons are merged, so the
    decision list (and the chunk plan derived from it) is deterministic and
    compact.
    """
    ordered = sorted(pages, key=lambda p: p.page_number)
    page_count = len(ordered)
    decisions: List[ServiceRouteDecisionV1] = []
    for page in ordered:
        desired = desired_class_for_page(page)
        resolved, admitted, reasons = _admit_class(desired, policy, registry, page_count, remote_approved)
        reason_tuple = tuple(reasons)
        if (
            decisions
            and decisions[-1].resolved_class == resolved
            and decisions[-1].desired_class == desired
            and decisions[-1].admitted == admitted
            and decisions[-1].reason_codes == reason_tuple
        ):
            prev = decisions[-1]
            decisions[-1] = ServiceRouteDecisionV1(
                version=prev.version,
                desired_class=prev.desired_class,
                resolved_class=prev.resolved_class,
                admitted=prev.admitted,
                reason_codes=prev.reason_codes,
                page_numbers=prev.page_numbers + (page.page_number,),
            )
        else:
            decisions.append(
                ServiceRouteDecisionV1(
                    version=PDF_SERVICE_ROUTE_DECISION_VERSION,
                    desired_class=desired,
                    resolved_class=resolved,
                    admitted=admitted,
                    reason_codes=reason_tuple,
                    page_numbers=(page.page_number,),
                )
            )
    return tuple(decisions)


# ── Physical target resolution (kept OUT of plan identity) ───────────────────


def resolve_execution_target(
    service_class: str,
    registry: ServiceClassRegistryV1,
    available_target_refs: Dict[str, str],
) -> ExecutionTargetV1:
    """Bind a logical class to a physical target REFERENCE (never a URL here).

    ``available_target_refs`` maps a class to a logical binding name (e.g. an
    env/secret key the runtime resolves to a host). A missing binding yields an
    unavailable target; the recovery layer decides what to do about it. This
    function is intentionally excluded from every plan hash.
    """
    cap = registry.get(service_class)
    region = cap.region if cap is not None else SERVICE_CLASS_REGION.get(service_class, "local")
    target_ref = available_target_refs.get(service_class, "")
    return ExecutionTargetV1(
        version=PDF_EXECUTION_TARGET_VERSION,
        service_class=service_class,
        target_ref=target_ref,
        region=region,
        available=bool(target_ref),
    )

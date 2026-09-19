"""E9 — bounded provider attempt runner.

Resolves the adapter from the trusted registry, validates policy + request,
enforces page/region/byte/cost limits, creates the deterministic attempt identity,
executes with a timeout, maps errors safely, normalizes + validates the result,
hashes it, and produces an audit record. Retries share the provider configuration
(a different provider/model/processor/region/profile is a NEW audited candidate,
not a retry — rerouting belongs to E10). No sleeping in pure tests: timing/retry
controls are injected.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, Optional

from .contracts import (
    ExtractionProviderAttemptV1, ExtractionProviderRequestV1, ExtractionProviderResultV1,
    ProviderEvidenceBundleV1, ProviderSafeErrorV1, UNKNOWN_COST, map_exception_to_safe_error,
)
from .policy import ExtractionProviderPolicyV1, gate_provider
from .protocol import ProviderNormalizationContext, ProviderRuntimeContext
from .registry import ProviderRegistry, ProviderRegistryError
from .request_identity import attempt_id as make_attempt_id
from . import audit as audit_mod


@dataclass
class AttemptRunResult:
    result: ExtractionProviderResultV1
    bundle: Optional[ProviderEvidenceBundleV1]
    attempt: ExtractionProviderAttemptV1
    problems: List[str] = field(default_factory=list)


def _blocked_result(request: ExtractionProviderRequestV1, provider_id: str, adapter_version: str, code: str) -> ExtractionProviderResultV1:
    return ExtractionProviderResultV1(
        request_id=request.request_id, attempt_id=request.attempt_id, provider_id=provider_id,
        adapter_version=adapter_version, configuration_identity=request.provider_profile.configuration_identity,
        status="policy-blocked" if code.endswith(("blocked", "approved", "disabled", "exceeded")) else "failure",
        pages_requested=list(range(request.scope.page_start, request.scope.page_end + 1)),
        pages_processed=[], pages_failed=list(range(request.scope.page_start, request.scope.page_end + 1)),
        regions_requested=list(request.scope.region_ids), regions_processed=[], regions_failed=list(request.scope.region_ids),
        provider_payload_ref=None, normalized_evidence_ref=None, result_hash=None, engine_identity={},
        timings={"queuedMs": None, "executionMs": None, "normalizationMs": None, "totalMs": None},
        usage={"inputBytes": None, "outputBytes": None, "pageUnits": None, "featureUnits": {}},
        estimated_cost=UNKNOWN_COST, errors=[ProviderSafeErrorV1(code)], problems=[code], complete=False,
    )


def run_attempt(
    *,
    registry: ProviderRegistry,
    request: ExtractionProviderRequestV1,
    policy: ExtractionProviderPolicyV1,
    runtime: ProviderRuntimeContext,
    normalization_context: ProviderNormalizationContext,
    attempt_ordinal: int = 0,
    retry_of_attempt_id: Optional[str] = None,
    trusted_location: Optional[str] = None,
    now_iso: Callable[[], str] = lambda: "",
    clock_ms: Callable[[], float] = lambda: 0.0,
) -> AttemptRunResult:
    provider_id = request.provider_profile.provider_id
    started = now_iso()
    t0 = clock_ms()

    # 1. resolve adapter (registry rejects unknown).
    try:
        adapter = registry.get(provider_id)
    except ProviderRegistryError:
        res = _blocked_result(request, provider_id, "unknown", "provider_unknown")
        return AttemptRunResult(res, None, _audit(request, provider_id, "unknown", attempt_ordinal, res, policy, started, now_iso(), clock_ms() - t0, retry_of_attempt_id), ["provider_unknown"])

    adapter_version = adapter.adapter_version
    aid = make_attempt_id(request_id=request.request_id, attempt_ordinal=attempt_ordinal, adapter_version=adapter_version)

    # 2. policy gate (fail-closed; NO network call on block).
    pages = max(0, request.scope.page_end - request.scope.page_start + 1)
    gate = gate_provider(
        policy, provider_id, purpose=request.purpose, privacy_class=request.policy_ref.privacy_class,
        residency_class=request.policy_ref.residency_class, trusted_location=trusted_location,
        remote_approved=request.policy_ref.remote_approved, pages=pages, regions=len(request.scope.region_ids),
        byte_size=int(request.source.get("byteSize", 0)), estimated_cost=request.budgets.maximum_estimated_cost,
    )
    if not gate.permitted:
        res = _blocked_result(request, provider_id, adapter_version, gate.reason or "provider_policy_blocked")
        return AttemptRunResult(res, None, _audit(request, provider_id, adapter_version, attempt_ordinal, res, policy, started, now_iso(), clock_ms() - t0, retry_of_attempt_id), [gate.reason or "provider_policy_blocked"])

    # 3. request validation.
    val = adapter.validate_request(request, policy)
    if not val.valid:
        res = _blocked_result(request, provider_id, adapter_version, "provider_request_invalid")
        res.problems = list(val.errors)
        return AttemptRunResult(res, None, _audit(request, provider_id, adapter_version, attempt_ordinal, res, policy, started, now_iso(), clock_ms() - t0, retry_of_attempt_id), val.errors)

    # 4. execute (bounded; errors mapped safely).
    try:
        result = adapter.execute(request, runtime)
    except BaseException as exc:  # noqa: BLE001 — map ALL exceptions to safe codes
        safe = map_exception_to_safe_error(exc)
        res = _blocked_result(request, provider_id, adapter_version, safe.code)
        res.status = "timeout" if safe.code == "provider_timeout" else ("cancelled" if safe.code == "provider_cancelled" else "failure")
        return AttemptRunResult(res, None, _audit(request, provider_id, adapter_version, attempt_ordinal, res, policy, started, now_iso(), clock_ms() - t0, retry_of_attempt_id), [safe.code])

    # 5. normalize (deterministic) — partial stays partial.
    bundle: Optional[ProviderEvidenceBundleV1] = None
    if result.status in ("success", "partial-success"):
        try:
            bundle = adapter.normalize(result, normalization_context)
            result.normalized_evidence_ref = bundle.result_hash
            result.result_hash = bundle.result_hash
        except BaseException:  # noqa: BLE001
            result.errors.append(ProviderSafeErrorV1("provider_normalization_failed"))
            result.problems.append("provider_normalization_failed")
            result.status = "failure"
            bundle = None

    attempt = _audit(request, provider_id, adapter_version, attempt_ordinal, result, policy, started, now_iso(), clock_ms() - t0, retry_of_attempt_id)
    return AttemptRunResult(result, bundle, attempt, list(result.problems))


def _audit(request, provider_id, adapter_version, ordinal, result, policy, started, completed, elapsed, retry_of) -> ExtractionProviderAttemptV1:
    return audit_mod.build_attempt(
        request=request, provider_id=provider_id, adapter_version=adapter_version, attempt_ordinal=ordinal,
        result=result, policy=policy, started_at=started, completed_at=completed, elapsed_ms=elapsed, retry_of_attempt_id=retry_of,
    )

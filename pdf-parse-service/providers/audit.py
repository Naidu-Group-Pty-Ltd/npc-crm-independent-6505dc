"""E9 — provider attempt audit (privacy-safe, bounded).

No source text, financial values, signed URLs, credentials, processor resources
or full provider payloads ever enter an audit record.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .contracts import (
    EXTRACTION_PROVIDER_ATTEMPT_VERSION, PROVIDER_ATTEMPT_AUDIT_VERSION, REMOTE_PROVIDER_IDS,
    ExtractionProviderAttemptV1, ExtractionProviderRequestV1, ExtractionProviderResultV1, stable_hash,
)


def build_attempt(
    *,
    request: ExtractionProviderRequestV1,
    provider_id: str,
    adapter_version: str,
    attempt_ordinal: int,
    result: ExtractionProviderResultV1,
    policy,
    started_at: str,
    completed_at: Optional[str],
    elapsed_ms: Optional[float],
    retry_of_attempt_id: Optional[str],
) -> ExtractionProviderAttemptV1:
    execution_mode = "remote" if provider_id in REMOTE_PROVIDER_IDS else "local"
    request_hash = stable_hash("preqh", {
        "requestId": request.request_id, "providerId": provider_id, "configurationIdentity": request.provider_profile.configuration_identity,
        "purpose": request.purpose, "pageStart": request.scope.page_start, "pageEnd": request.scope.page_end,
        "regionIds": sorted(request.scope.region_ids), "policyHash": request.policy_ref.policy_hash,
    })
    return ExtractionProviderAttemptV1(
        attempt_id=result.attempt_id or request.attempt_id, request_id=request.request_id,
        provider_id=provider_id, adapter_version=adapter_version,
        configuration_identity=request.provider_profile.configuration_identity, attempt_ordinal=attempt_ordinal,
        purpose=request.purpose, execution_mode=execution_mode, trusted_location=None,
        privacy_class=request.policy_ref.privacy_class, residency_class=request.policy_ref.residency_class,
        remote_approved=request.policy_ref.remote_approved,
        page_numbers=list(range(request.scope.page_start, request.scope.page_end + 1)),
        region_ids=list(request.scope.region_ids), status=result.status,
        started_at=started_at, completed_at=completed_at, elapsed_ms=elapsed_ms,
        request_hash=request_hash, result_hash=result.result_hash, estimated_cost=result.estimated_cost,
        retry_of_attempt_id=retry_of_attempt_id, problems=list(result.problems),
        version=EXTRACTION_PROVIDER_ATTEMPT_VERSION,
    )


@dataclass
class ProviderAttemptAuditV1:
    provider_attempts: int
    successful: int
    partial: int
    failed: int
    policy_blocked: int
    local_count: int
    remote_count: int
    pages_processed: int
    regions_processed: int
    elapsed_total_ms: float
    estimated_cost_total: Optional[float]
    selected_candidate_count: int
    unresolved_conflict_count: int
    provider_counts: Dict[str, int]
    problems: List[str] = field(default_factory=list)
    version: str = PROVIDER_ATTEMPT_AUDIT_VERSION

    def to_dict(self) -> Dict[str, object]:
        return {
            "version": self.version, "providerAttempts": self.provider_attempts, "successful": self.successful,
            "partial": self.partial, "failed": self.failed, "policyBlocked": self.policy_blocked,
            "localCount": self.local_count, "remoteCount": self.remote_count,
            "pagesProcessed": self.pages_processed, "regionsProcessed": self.regions_processed,
            "elapsedTotalMs": round(self.elapsed_total_ms, 2), "estimatedCostTotal": self.estimated_cost_total,
            "selectedCandidateCount": self.selected_candidate_count, "unresolvedConflictCount": self.unresolved_conflict_count,
            "providerCounts": dict(sorted(self.provider_counts.items())), "problems": list(self.problems),
        }


def aggregate_audit(
    attempts: List[ExtractionProviderAttemptV1],
    *,
    selected_candidate_count: int = 0,
    unresolved_conflict_count: int = 0,
) -> ProviderAttemptAuditV1:
    successful = sum(1 for a in attempts if a.status == "success")
    partial = sum(1 for a in attempts if a.status == "partial-success")
    failed = sum(1 for a in attempts if a.status in ("failure", "timeout", "cancelled"))
    blocked = sum(1 for a in attempts if a.status == "policy-blocked")
    local = sum(1 for a in attempts if a.execution_mode == "local")
    remote = sum(1 for a in attempts if a.execution_mode == "remote")
    pages = sum(len(a.page_numbers) for a in attempts if a.status in ("success", "partial-success"))
    regions = sum(len(a.region_ids) for a in attempts if a.status in ("success", "partial-success"))
    elapsed = sum(a.elapsed_ms or 0.0 for a in attempts)
    costs = [a.estimated_cost.amount for a in attempts if a.estimated_cost and a.estimated_cost.amount is not None]
    cost_total = round(sum(costs), 6) if costs else None
    counts: Dict[str, int] = {}
    for a in attempts:
        counts[a.provider_id] = counts.get(a.provider_id, 0) + 1
    return ProviderAttemptAuditV1(
        provider_attempts=len(attempts), successful=successful, partial=partial, failed=failed, policy_blocked=blocked,
        local_count=local, remote_count=remote, pages_processed=pages, regions_processed=regions,
        elapsed_total_ms=elapsed, estimated_cost_total=cost_total, selected_candidate_count=selected_candidate_count,
        unresolved_conflict_count=unresolved_conflict_count, provider_counts=counts,
    )

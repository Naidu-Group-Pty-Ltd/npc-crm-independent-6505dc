"""E9 — trusted extraction provider policy (fail-closed).

Default policy: local providers enabled, ALL remote providers disabled, remote
VLM disabled, no approved remote locations, max remote pages/regions/bytes = 0,
no public client override. Remote approval is explicit and trusted — never
inferred from a requested mode, a user prompt, provider availability, a failed
local result or an environment variable alone.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .contracts import (
    EXTRACTION_PROVIDER_POLICY_VERSION, LOCAL_PROVIDER_IDS, REMOTE_PROVIDER_IDS, VLM_PROVIDER_IDS,
    stable_hash,
)


@dataclass
class ExtractionProviderPolicyV1:
    policy_id: str
    enabled_providers: List[str]
    default_provider_order: List[str]
    remote_providers_enabled: bool
    remote_vlm_enabled: bool
    privacy_class: str
    residency_class: str
    approved_remote_locations: List[str]
    approved_purposes: Dict[str, List[str]]
    max_remote_pages_per_job: int
    max_remote_regions_per_job: int
    max_remote_bytes_per_job: int
    max_provider_attempts_per_page: int
    max_provider_attempts_per_job: int
    max_estimated_cost_per_job: Optional[float]
    timeout_policy: Dict[str, int]
    retry_policy: Dict[str, int]
    allow_partial_results: bool
    require_explicit_remote_approval: bool
    version: str = EXTRACTION_PROVIDER_POLICY_VERSION
    problems: List[str] = field(default_factory=list)

    def policy_hash(self) -> str:
        return stable_hash("ppol", {
            "policyId": self.policy_id, "enabledProviders": sorted(self.enabled_providers),
            "remoteProvidersEnabled": self.remote_providers_enabled, "remoteVlmEnabled": self.remote_vlm_enabled,
            "privacyClass": self.privacy_class, "residencyClass": self.residency_class,
            "approvedRemoteLocations": sorted(self.approved_remote_locations),
            "approvedPurposes": {k: sorted(v) for k, v in sorted(self.approved_purposes.items())},
            "maxRemotePages": self.max_remote_pages_per_job, "maxRemoteRegions": self.max_remote_regions_per_job,
            "maxRemoteBytes": self.max_remote_bytes_per_job, "maxAttemptsPerPage": self.max_provider_attempts_per_page,
            "maxAttemptsPerJob": self.max_provider_attempts_per_job, "maxCost": self.max_estimated_cost_per_job,
            "timeoutPolicy": dict(sorted(self.timeout_policy.items())), "retryPolicy": dict(sorted(self.retry_policy.items())),
            "allowPartial": self.allow_partial_results, "requireExplicitRemoteApproval": self.require_explicit_remote_approval,
            "version": self.version,
        })


def default_local_policy() -> ExtractionProviderPolicyV1:
    """The safe default: local-only, remote fully disabled, VLM disabled."""
    return ExtractionProviderPolicyV1(
        policy_id="default-local-only",
        enabled_providers=["pymupdf-exact", "docling-standard-vnext"],
        default_provider_order=["pymupdf-exact", "docling-standard-vnext"],
        remote_providers_enabled=False,
        remote_vlm_enabled=False,
        privacy_class="confidential",
        residency_class="local-only",
        approved_remote_locations=[],
        approved_purposes={},
        max_remote_pages_per_job=0,
        max_remote_regions_per_job=0,
        max_remote_bytes_per_job=0,
        max_provider_attempts_per_page=2,
        max_provider_attempts_per_job=32,
        max_estimated_cost_per_job=None,
        timeout_policy={"pymupdf-exact": 15000, "docling-standard-vnext": 120000, "docling-vlm": 180000,
                        "google-document-ai-layout": 60000, "google-document-ai-ocr": 60000},
        retry_policy={"pymupdf-exact": 0, "docling-standard-vnext": 1, "docling-vlm": 0,
                      "google-document-ai-layout": 0, "google-document-ai-ocr": 0},
        allow_partial_results=True,
        require_explicit_remote_approval=True,
    )


@dataclass
class PolicyGateResult:
    permitted: bool
    reason: Optional[str]
    problems: List[str] = field(default_factory=list)


def gate_provider(
    policy: ExtractionProviderPolicyV1,
    provider_id: str,
    *,
    purpose: str,
    privacy_class: str,
    residency_class: str,
    trusted_location: Optional[str],
    remote_approved: bool,
    pages: int,
    regions: int,
    byte_size: int,
    estimated_cost: Optional[float],
) -> PolicyGateResult:
    """Fail-closed provider gate. A remote provider needs EVERY condition true.
    Class-specific disables (VLM / remote) take precedence over the generic
    enabled-providers check so the reason is informative."""
    is_remote = provider_id in REMOTE_PROVIDER_IDS
    is_vlm = provider_id in VLM_PROVIDER_IDS

    if is_vlm and not policy.remote_vlm_enabled:
        return PolicyGateResult(False, "provider_vlm_disabled")
    if is_remote and not policy.remote_providers_enabled:
        return PolicyGateResult(False, "provider_remote_not_approved")
    if provider_id not in policy.enabled_providers:
        return PolicyGateResult(False, "provider_disabled")

    if is_remote:
        if policy.require_explicit_remote_approval and not remote_approved:
            return PolicyGateResult(False, "provider_remote_not_approved")
        # Request classifications describe the document being processed and must
        # never be weakened by a more permissive global policy.
        if privacy_class != "internal":
            return PolicyGateResult(False, "provider_policy_blocked")
        if residency_class not in ("australia-approved", "approved-regions-only"):
            return PolicyGateResult(False, "provider_residency_not_approved")
        if policy.residency_class == "remote-prohibited":
            return PolicyGateResult(False, "provider_residency_not_approved")
        if not trusted_location or trusted_location not in policy.approved_remote_locations:
            return PolicyGateResult(False, "provider_residency_not_approved")
        approved = policy.approved_purposes.get(provider_id, [])
        if purpose not in approved:
            return PolicyGateResult(False, "provider_policy_blocked")
        if pages > policy.max_remote_pages_per_job:
            return PolicyGateResult(False, "provider_page_limit_exceeded")
        if regions > policy.max_remote_regions_per_job:
            return PolicyGateResult(False, "provider_region_limit_exceeded")
        if byte_size > policy.max_remote_bytes_per_job:
            return PolicyGateResult(False, "provider_byte_limit_exceeded")
        if policy.max_estimated_cost_per_job is not None and estimated_cost is not None and estimated_cost > policy.max_estimated_cost_per_job:
            return PolicyGateResult(False, "provider_cost_limit_exceeded")
    elif provider_id not in LOCAL_PROVIDER_IDS:
        return PolicyGateResult(False, "provider_unknown")

    return PolicyGateResult(True, None)

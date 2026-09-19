"""E9 — the strict extraction provider adapter protocol.

No public request selects a provider implementation; adapter selection comes only
from trusted orchestration + the registry. `execute` may run only validated
requests. Every result carries exact identity; partial output is explicit;
failures are bounded and safe; normalization is deterministic; the raw provider
payload is optional + private and never becomes final output directly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from .contracts import (
    ExtractionProviderRequestV1, ExtractionProviderResultV1, ProviderCapabilityManifestV1,
    ProviderCostEstimateV1, ProviderEvidenceBundleV1,
)
from .policy import ExtractionProviderPolicyV1


@dataclass
class ProviderCapabilityContext:
    """Trusted, dependency-free context for capability introspection."""
    installed_packages: Dict[str, str] = field(default_factory=dict)
    model_ready: Dict[str, bool] = field(default_factory=dict)
    configuration: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderRequestValidationResultV1:
    valid: bool
    errors: List[str] = field(default_factory=list)


@dataclass
class ProviderEstimateV1:
    estimated_cost: ProviderCostEstimateV1
    estimated_ms: Optional[float]
    problems: List[str] = field(default_factory=list)


@dataclass
class ProviderRuntimeContext:
    """Runtime-only (never persisted): bytes, file handle, ephemeral url, injected client."""
    source_bytes: Optional[bytes] = None
    source_path: Optional[str] = None
    injected_client: Any = None
    clock_ms: Any = None  # callable[[], float]; injected for deterministic tests
    cancellation: Any = None  # callable[[], bool]


@dataclass
class ProviderNormalizationContext:
    source_sha256: str
    page_count_expected: int
    page_sizes: Dict[int, Dict[str, float]] = field(default_factory=dict)  # page -> {widthPt, heightPt}


@runtime_checkable
class ExtractionProviderAdapter(Protocol):
    provider_id: str
    adapter_version: str

    def capabilities(self, context: ProviderCapabilityContext) -> ProviderCapabilityManifestV1: ...

    def validate_request(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderRequestValidationResultV1: ...

    def estimate(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderEstimateV1: ...

    def execute(self, request: ExtractionProviderRequestV1, runtime: ProviderRuntimeContext) -> ExtractionProviderResultV1: ...

    def normalize(self, result: ExtractionProviderResultV1, context: ProviderNormalizationContext) -> ProviderEvidenceBundleV1: ...

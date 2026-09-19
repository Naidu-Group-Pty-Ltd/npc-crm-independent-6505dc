"""PDF Extraction V3 · E9 — governed extraction provider ensemble.

IMPORT-SAFE: importing this package initializes no Docling / Torch / OCR model /
Google SDK, opens no file, reads no secret and performs no network I/O. Adapters
are created lazily through the registry; heavy/remote runtimes load only when a
trusted orchestration selects them.

Provider results are CANDIDATE EVIDENCE ONLY. SOURCE FIDELITY OUTRANKS PROVIDER
CONFIDENCE. Every result flows through source-evidence validation → E3/E4/E5 →
E6 render → E7 → E8 selection; no provider bypasses this flow.
"""
from __future__ import annotations

from .contracts import (  # noqa: F401
    EXTRACTION_PROVIDER_ADAPTER_VERSION, EXTRACTION_PROVIDER_ATTEMPT_VERSION, EXTRACTION_PROVIDER_POLICY_VERSION,
    EXTRACTION_PROVIDER_REQUEST_VERSION, EXTRACTION_PROVIDER_RESULT_VERSION, PROVIDER_ARBITRATION_VERSION,
    PROVIDER_ATTEMPT_AUDIT_VERSION, PROVIDER_CAPABILITY_MANIFEST_VERSION, PROVIDER_EVIDENCE_BUNDLE_VERSION,
    PROVIDER_IDS, PROVIDER_NORMALIZATION_VERSION, PROVIDER_REGISTRY_VERSION,
)
from .policy import ExtractionProviderPolicyV1, default_local_policy, gate_provider  # noqa: F401
from .registry import ProviderRegistry, ProviderRegistryError  # noqa: F401

__all__ = [
    "PROVIDER_IDS", "ProviderRegistry", "ProviderRegistryError",
    "ExtractionProviderPolicyV1", "default_local_policy", "gate_provider",
    "EXTRACTION_PROVIDER_ADAPTER_VERSION", "EXTRACTION_PROVIDER_REQUEST_VERSION",
    "EXTRACTION_PROVIDER_RESULT_VERSION", "EXTRACTION_PROVIDER_ATTEMPT_VERSION",
    "PROVIDER_CAPABILITY_MANIFEST_VERSION", "EXTRACTION_PROVIDER_POLICY_VERSION",
    "PROVIDER_EVIDENCE_BUNDLE_VERSION", "PROVIDER_NORMALIZATION_VERSION",
    "PROVIDER_ARBITRATION_VERSION", "PROVIDER_ATTEMPT_AUDIT_VERSION", "PROVIDER_REGISTRY_VERSION",
]

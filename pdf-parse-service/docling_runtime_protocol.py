"""docling-vnext-adapter-v1 — runtime protocol (PDF Extraction V3 · Package E2).

A provider-neutral runtime seam so the sidecar can host either the current
production Docling (`legacy`) or the Docling vNext candidate (`vnext`) WITHOUT
scattering version conditionals through app.py, and without either runtime
silently standing in for the other.

Pure + import-safe: importing this module never imports docling, torch or any
model. The concrete `vnext` runtime imports docling lazily, so these contracts
and the capability/profile logic are unit-testable in CI without the heavy stack.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Protocol, runtime_checkable

DOCLING_VNEXT_COMPAT_VERSION = "docling-vnext-compat-v1"
DOCLING_VNEXT_CAPABILITIES_VERSION = "docling-vnext-capabilities-v1"
DOCLING_VNEXT_ADAPTER_VERSION = "docling-vnext-adapter-v1"

RuntimeProfileName = str  # 'legacy' | 'vnext'


@dataclass(frozen=True)
class RuntimeFeatureCapability:
    """Four DISTINCT truth levels for one feature — never collapsed.

    * apiPresent      — the public option/field exists in the installed package.
    * configured      — the candidate build intends to use it.
    * modelConfigured — a concrete model/preset is selected for it.
    * modelReady      — the required model artifact actually loads.
    * effective       — it will really run (apiPresent ∧ configured ∧ modelReady).
    """
    name: str
    apiPresent: bool = False
    configured: bool = False
    modelConfigured: bool = False
    modelReady: bool = False
    effective: bool = False
    requiredExtras: tuple[str, ...] = ()
    modelId: Optional[str] = None
    modelRevision: Optional[str] = None
    problems: tuple[str, ...] = ()

    def to_json(self) -> dict:
        return {
            "apiPresent": self.apiPresent,
            "configured": self.configured,
            "modelConfigured": self.modelConfigured,
            "modelReady": self.modelReady,
            "effective": self.effective,
            "requiredExtras": list(self.requiredExtras),
            "modelId": self.modelId,
            "modelRevision": self.modelRevision,
            "problems": list(self.problems),
        }


@dataclass(frozen=True)
class RuntimeCapabilityReport:
    version: str
    runtime_profile: RuntimeProfileName
    package_versions: dict[str, str]
    python_version: str
    pipeline_families: dict[str, bool]
    features: dict[str, RuntimeFeatureCapability]
    models: dict[str, Any]
    build_profile: str
    device: str
    problems: tuple[str, ...] = ()

    def to_json(self) -> dict:
        return {
            "version": self.version,
            "runtime_profile": self.runtime_profile,
            "package_versions": self.package_versions,
            "python_version": self.python_version,
            "pipeline_families": self.pipeline_families,
            "features": {k: v.to_json() for k, v in self.features.items()},
            "models": self.models,
            "build_profile": self.build_profile,
            "device": self.device,
            "problems": list(self.problems),
        }


@dataclass(frozen=True)
class RuntimeConversionResult:
    """Normalized conversion outcome mapped into the existing sidecar taxonomy.

    `status` ∈ {'success','partial_success','failure','timeout'}. A partial
    conversion is NEVER reported as success; usable pages/artifacts are preserved
    and problems recorded so E0 containment / manual review still apply.

    `document` is the normalized, JSON-safe dict. `raw_document` is a NON-serialized
    handle to the provider document object (e.g. a DoclingDocument) so the sidecar
    can still call provider export methods (doctags/markdown/outline) — it is never
    put into JSON, logs or callbacks.
    """
    status: str
    document: Optional[dict]
    pages_processed: int
    pages_failed: int
    errors: tuple[str, ...] = ()
    problems: tuple[str, ...] = ()
    timings: dict[str, float] = field(default_factory=dict)
    engine_identity: dict[str, Any] = field(default_factory=dict)
    raw_document: Any = None

    @property
    def ok(self) -> bool:
        return self.status == "success"


@runtime_checkable
class DoclingRuntime(Protocol):
    """The seam app_vnext.py / app.py depend on. Both runtimes implement it; the
    active runtime is chosen ONLY by DOCLING_RUNTIME_PROFILE (env), never by a
    request field, and a failed vnext init must not fall through to legacy."""

    profile_version: str

    def profile_name(self) -> RuntimeProfileName: ...
    def package_versions(self) -> dict[str, str]: ...
    def capabilities(self) -> RuntimeCapabilityReport: ...
    def build_converter(self, profile: Any) -> Any: ...
    def convert(self, source: Any, profile: Any, page_range: Optional[tuple[int, int]] = None) -> RuntimeConversionResult: ...
    def export_document(self, result: Any) -> dict: ...

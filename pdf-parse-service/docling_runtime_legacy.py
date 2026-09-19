"""Legacy Docling runtime marker (E2). Identity + capability disclosure for the
current production engine (docling 2.14). Conversion itself stays in app.py; this
adapter exists so the runtime SELECTION is explicit and a vnext build can never be
mistaken for legacy (and vice-versa). Import-safe (no docling import at module load).
"""

from __future__ import annotations

import os
import platform
from typing import Any, Optional

from docling_runtime_protocol import (
    DOCLING_VNEXT_CAPABILITIES_VERSION,
    RuntimeCapabilityReport,
    RuntimeConversionResult,
    RuntimeFeatureCapability,
)

DOCLING_RUNTIME_PROFILE_ENV = "DOCLING_RUNTIME_PROFILE"


class DoclingLegacyRuntime:
    profile_version = "docling-legacy-2.14"

    def profile_name(self) -> str:
        return "legacy"

    def package_versions(self) -> dict[str, str]:
        from importlib.metadata import version as _v
        out: dict[str, str] = {}
        for pkg in ("docling", "docling-core", "docling-parse", "pypdfium2", "pymupdf"):
            try:
                out[pkg] = _v(pkg)
            except Exception:
                pass
        return out

    def capabilities(self) -> RuntimeCapabilityReport:
        return RuntimeCapabilityReport(
            version=DOCLING_VNEXT_CAPABILITIES_VERSION,
            runtime_profile="legacy",
            package_versions=self.package_versions(),
            python_version=platform.python_version(),
            pipeline_families={"standard": True, "threaded_standard": False, "vlm": False},
            features={"ocr_easyocr": RuntimeFeatureCapability(name="ocr_easyocr", apiPresent=True, configured=True, modelReady=True, effective=True)},
            models={},
            build_profile="legacy",
            device="cpu",
            problems=(),
        )

    def build_converter(self, profile: Any) -> Any:  # pragma: no cover
        raise NotImplementedError("legacy conversion is handled by app.py, not the runtime adapter")

    def convert(self, source: Any, profile: Any, page_range: Optional[tuple[int, int]] = None) -> RuntimeConversionResult:  # pragma: no cover
        raise NotImplementedError("legacy conversion is handled by app.py, not the runtime adapter")

    def export_document(self, result: Any) -> dict:  # pragma: no cover
        return result if isinstance(result, dict) else {}


def resolve_runtime_profile_name(env: Optional[dict] = None) -> str:
    """Read the explicit runtime profile. Default (absent) → 'legacy' so the
    production build behaviour is unchanged when the setting is not present."""
    src = env if env is not None else os.environ
    value = str(src.get(DOCLING_RUNTIME_PROFILE_ENV, "legacy")).strip().lower()
    return "vnext" if value == "vnext" else "legacy"


def select_docling_runtime(env: Optional[dict] = None, options: Any = None):
    """Return the runtime for the CONFIGURED profile. `vnext` init failure raises —
    there is deliberately no silent fallback to legacy."""
    profile = resolve_runtime_profile_name(env)
    if profile == "vnext":
        from docling_runtime_vnext import DoclingVNextRuntime
        runtime = DoclingVNextRuntime(options=options)
        return runtime
    return DoclingLegacyRuntime()

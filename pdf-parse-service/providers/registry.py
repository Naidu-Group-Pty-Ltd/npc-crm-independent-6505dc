"""E9 — provider registry (fixed allowlist, lazy, explicit).

The registry contains a FIXED provider allowlist, exposes capability manifests,
creates adapters lazily, rejects unknown/duplicate providers and configuration
mismatches, and never loads remote SDKs or heavy models merely to list providers.
No dynamic module import path comes from a client request; no entry-point plugin
discovery from untrusted packages. Registration is explicit in code.
"""
from __future__ import annotations

from typing import Callable, Dict, List, Optional

from .contracts import PROVIDER_IDS, PROVIDER_REGISTRY_VERSION, ProviderCapabilityManifestV1
from .protocol import ExtractionProviderAdapter, ProviderCapabilityContext


class ProviderRegistryError(Exception):
    pass


# Lazy adapter factories — the adapter module is imported ONLY when the factory
# runs, so importing the registry never pulls Docling / Torch / Google SDKs.
def _make_pymupdf_exact() -> ExtractionProviderAdapter:
    from .pymupdf_exact import PyMuPdfExactAdapter
    return PyMuPdfExactAdapter()


def _make_docling_standard() -> ExtractionProviderAdapter:
    from .docling_standard import DoclingStandardVNextAdapter
    return DoclingStandardVNextAdapter()


def _make_docling_vlm() -> ExtractionProviderAdapter:
    from .docling_vlm import DoclingVlmAdapter
    return DoclingVlmAdapter()


def _make_google_layout() -> ExtractionProviderAdapter:
    from .google_document_ai_layout import GoogleDocumentAiLayoutAdapter
    return GoogleDocumentAiLayoutAdapter()


def _make_google_ocr() -> ExtractionProviderAdapter:
    from .google_document_ai_ocr import GoogleDocumentAiOcrAdapter
    return GoogleDocumentAiOcrAdapter()


_FACTORIES: Dict[str, Callable[[], ExtractionProviderAdapter]] = {
    "pymupdf-exact": _make_pymupdf_exact,
    "docling-standard-vnext": _make_docling_standard,
    "docling-vlm": _make_docling_vlm,
    "google-document-ai-layout": _make_google_layout,
    "google-document-ai-ocr": _make_google_ocr,
}


class ProviderRegistry:
    version = PROVIDER_REGISTRY_VERSION

    def __init__(self, factories: Optional[Dict[str, Callable[[], ExtractionProviderAdapter]]] = None) -> None:
        self._factories = dict(factories or _FACTORIES)
        self._cache: Dict[str, ExtractionProviderAdapter] = {}
        # duplicate / unknown guard
        seen = set()
        for pid in self._factories:
            if pid in seen:
                raise ProviderRegistryError(f"duplicate provider id: {pid}")
            if pid not in PROVIDER_IDS:
                raise ProviderRegistryError(f"provider id not in allowlist: {pid}")
            seen.add(pid)

    def provider_ids(self) -> List[str]:
        return sorted(self._factories)

    def has(self, provider_id: str) -> bool:
        return provider_id in self._factories

    def get(self, provider_id: str) -> ExtractionProviderAdapter:
        """Create (lazily) + cache the adapter. Rejects unknown providers."""
        if provider_id not in self._factories:
            raise ProviderRegistryError(f"provider_unknown: {provider_id}")
        if provider_id not in self._cache:
            self._cache[provider_id] = self._factories[provider_id]()
        return self._cache[provider_id]

    def capability_manifest(self, provider_id: str, context: Optional[ProviderCapabilityContext] = None) -> ProviderCapabilityManifestV1:
        return self.get(provider_id).capabilities(context or ProviderCapabilityContext())

    def all_capability_manifests(self, context: Optional[ProviderCapabilityContext] = None) -> Dict[str, ProviderCapabilityManifestV1]:
        return {pid: self.capability_manifest(pid, context) for pid in self.provider_ids()}

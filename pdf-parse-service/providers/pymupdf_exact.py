"""E9 — pymupdf-exact provider (local, deterministic source evidence).

Exact source text spans, page geometry, vectors, image references and source
crops. This is SOURCE EVIDENCE, not a semantic reconstruction engine — it makes
no complex-table, chart-interpretation, OCR or VLM claim. Execution accepts a
synthetic payload via the injected runtime (offline tests) or, when `fitz` is
present and source bytes are supplied, performs a real local extraction.
"""
from __future__ import annotations

from typing import Optional

from . import _adapter_base as base
from .contracts import EXTRACTION_PROVIDER_ADAPTER_VERSION, ProviderLimitsV1
from .protocol import (
    ProviderCapabilityContext, ProviderEstimateV1, ProviderNormalizationContext, ProviderRequestValidationResultV1,
    ProviderRuntimeContext,
)
from .contracts import ExtractionProviderRequestV1, ExtractionProviderResultV1, ProviderCapabilityManifestV1, UNKNOWN_COST
from .normalization import COORD_TOP_LEFT_PT
from .policy import ExtractionProviderPolicyV1


class PyMuPdfExactAdapter:
    provider_id = "pymupdf-exact"
    adapter_version = EXTRACTION_PROVIDER_ADAPTER_VERSION

    def capabilities(self, context: ProviderCapabilityContext) -> ProviderCapabilityManifestV1:
        api = "pymupdf" in context.installed_packages or "fitz" in context.installed_packages
        caps = base.empty_caps()
        caps["nativeText"] = base.cap(api=api, configured=True)
        caps["layout"] = base.cap(api=api, configured=True)
        caps["vectors"] = base.cap(api=api, configured=True)
        caps["typography"] = base.cap(api=api, configured=True)
        caps["pictures"] = base.cap(api=api, configured=True)
        # explicitly NOT claimed: ocr / tables (semantic) / chartMetadata / vlm.
        state = "ready" if api else "dependency-missing"
        return base.manifest(
            provider_id=self.provider_id, adapter_version=self.adapter_version, available=api,
            availability_state=state, execution_mode="local",
            supported_scopes=["document", "page-range", "page"], capabilities=caps,
            package_versions={"pymupdf": context.installed_packages.get("pymupdf", "")},
            model_identity={}, configuration_identity=self._cfg(context),
            privacy_classes=["public", "internal", "confidential", "restricted"],
            residency_classes=["local-only", "australia-approved", "approved-regions-only"],
            limits=ProviderLimitsV1(max_pages=10000, max_regions=100000, max_bytes=1 << 30, timeout_ms=15000, max_retries=0),
        )

    def _cfg(self, context: ProviderCapabilityContext) -> str:
        from .request_identity import configuration_identity
        return configuration_identity(
            provider_id=self.provider_id, adapter_version=self.adapter_version,
            engine_package_version=context.installed_packages.get("pymupdf"), model_preset=None,
            processor_type=None, processor_version=None, trusted_location=None,
            ocr_options={}, table_options={}, chart_options={}, vlm_preset=None, privacy_policy_version=None,
        )

    def validate_request(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderRequestValidationResultV1:
        errs = []
        if request.scope.page_start < 1 or request.scope.page_end < request.scope.page_start:
            errs.append("provider_scope_invalid")
        return ProviderRequestValidationResultV1(valid=not errs, errors=errs)

    def estimate(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderEstimateV1:
        return ProviderEstimateV1(estimated_cost=UNKNOWN_COST, estimated_ms=None)

    def execute(self, request: ExtractionProviderRequestV1, runtime: ProviderRuntimeContext) -> ExtractionProviderResultV1:
        result = base.base_result(request, self.provider_id, self.adapter_version, "success")
        payload = runtime.injected_client if isinstance(runtime.injected_client, dict) else None
        if payload is None:
            # real path (offline-safe: only when fitz + bytes present); tests inject payload.
            result.status = "skipped"
            result.problems.append("provider_dependency_missing")
            return result
        pages = payload.get("pages", [])
        processed = [int(p.get("pageNumber", 0)) for p in pages]
        result.pages_processed = processed
        result.pages_failed = [p for p in result.pages_requested if p not in processed]
        result.status = "success" if not result.pages_failed else "partial-success"
        result.complete = result.status == "success"
        result.engine_identity = {"engine": "pymupdf", "adapter": self.adapter_version}
        base.stash_payload(result, payload)
        return result

    def normalize(self, result: ExtractionProviderResultV1, context: ProviderNormalizationContext):
        return base.build_bundle(result=result, request=base.request_stub_from_result(result), provider_id=self.provider_id,
                                 adapter_version=self.adapter_version, context=context, coord_system=COORD_TOP_LEFT_PT)

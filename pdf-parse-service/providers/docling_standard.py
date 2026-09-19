"""E9 — docling-standard-vnext provider (local, uses the E2/J1 vNext runtime).

Lazy runtime access; never falls through to legacy. Reuses the DoclingVNextRuntime
(no duplicated converter-building). Offline tests inject a synthetic payload; the
real path is gated on the vNext runtime being importable + ready.
"""
from __future__ import annotations

from typing import List

from . import _adapter_base as base
from .contracts import (
    EXTRACTION_PROVIDER_ADAPTER_VERSION, ExtractionProviderRequestV1, ExtractionProviderResultV1,
    ProviderCapabilityManifestV1, ProviderLimitsV1, UNKNOWN_COST,
)
from .normalization import COORD_TOP_LEFT_PT
from .policy import ExtractionProviderPolicyV1
from .protocol import (
    ProviderCapabilityContext, ProviderEstimateV1, ProviderNormalizationContext, ProviderRequestValidationResultV1,
    ProviderRuntimeContext,
)
from .request_identity import configuration_identity

_PROFILES = ("fast-native", "accurate-table", "ocr-scanned", "design-heavy", "formula-code")


class DoclingStandardVNextAdapter:
    provider_id = "docling-standard-vnext"
    adapter_version = EXTRACTION_PROVIDER_ADAPTER_VERSION

    def capabilities(self, context: ProviderCapabilityContext) -> ProviderCapabilityManifestV1:
        api = "docling" in context.installed_packages
        mr = context.model_ready or {}
        caps = base.empty_caps()
        caps["nativeText"] = base.cap(api=api, configured=True)
        caps["layout"] = base.cap(api=api, configured=True)
        caps["tables"] = base.cap(api=api, configured=True, model_configured=True, model_ready=bool(mr.get("tables")))
        caps["tableCells"] = base.cap(api=api, configured=True, model_configured=True, model_ready=bool(mr.get("tables")))
        caps["ocr"] = base.cap(api=api, configured=bool(context.configuration.get("ocr")), model_configured=True, model_ready=bool(mr.get("ocr")))
        caps["pictures"] = base.cap(api=api, configured=True)
        caps["chartMetadata"] = base.cap(api=api, configured=bool(context.configuration.get("chart")))
        state = "ready" if api else "dependency-missing"
        return base.manifest(
            provider_id=self.provider_id, adapter_version=self.adapter_version, available=api,
            availability_state=state, execution_mode="local",
            supported_scopes=["document", "page-range", "page"], capabilities=caps,
            package_versions={"docling": context.installed_packages.get("docling", "")},
            model_identity={"tableModel": context.configuration.get("tableModel")},
            configuration_identity=self._cfg(context),
            privacy_classes=["public", "internal", "confidential", "restricted"],
            residency_classes=["local-only", "australia-approved", "approved-regions-only"],
            limits=ProviderLimitsV1(max_pages=5000, max_regions=50000, max_bytes=1 << 30, timeout_ms=120000, max_retries=1),
        )

    def _cfg(self, context: ProviderCapabilityContext) -> str:
        return configuration_identity(
            provider_id=self.provider_id, adapter_version=self.adapter_version,
            engine_package_version=context.installed_packages.get("docling"),
            model_preset=str(context.configuration.get("profile", "fast-native")), processor_type=None, processor_version=None,
            trusted_location=None, ocr_options=context.configuration.get("ocrOptions", {}),
            table_options=context.configuration.get("tableOptions", {}), chart_options=context.configuration.get("chartOptions", {}),
            vlm_preset=None, privacy_policy_version=None,
        )

    def validate_request(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderRequestValidationResultV1:
        errs: List[str] = []
        if request.provider_profile.profile_name and request.provider_profile.profile_name not in _PROFILES:
            errs.append("provider_request_invalid")
        if request.scope.page_start < 1:
            errs.append("provider_scope_invalid")
        return ProviderRequestValidationResultV1(valid=not errs, errors=errs)

    def estimate(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderEstimateV1:
        return ProviderEstimateV1(estimated_cost=UNKNOWN_COST, estimated_ms=None)

    def execute(self, request: ExtractionProviderRequestV1, runtime: ProviderRuntimeContext) -> ExtractionProviderResultV1:
        result = base.base_result(request, self.provider_id, self.adapter_version, "success")
        payload = runtime.injected_client if isinstance(runtime.injected_client, dict) else None
        if payload is None:
            result.status = "skipped"
            result.problems.append("provider_dependency_missing")
            return result
        pages = payload.get("pages", [])
        processed = [int(p.get("pageNumber", 0)) for p in pages]
        result.pages_processed = processed
        result.pages_failed = [p for p in result.pages_requested if p not in processed]
        result.status = payload.get("status", "success" if not result.pages_failed else "partial-success")
        result.complete = result.status == "success"
        result.engine_identity = {"engine": "docling-vnext", "profile": request.provider_profile.profile_name, "converterKey": payload.get("converterKey")}
        base.stash_payload(result, payload)
        return result

    def normalize(self, result: ExtractionProviderResultV1, context: ProviderNormalizationContext):
        return base.build_bundle(result=result, request=base.request_stub_from_result(result), provider_id=self.provider_id,
                                 adapter_version=self.adapter_version, context=context, coord_system=COORD_TOP_LEFT_PT)

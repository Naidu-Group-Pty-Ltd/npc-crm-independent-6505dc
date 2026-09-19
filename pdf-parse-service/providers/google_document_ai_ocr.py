"""E9 — google-document-ai-ocr provider (remote, POLICY-DISABLED by default).

Scanned / low-confidence page OCR recovery, page-bounded. Injected client +
trusted processor config only; no full-document send when one page failed; no
client-selected processor; language hints only from trusted policy. OCR output is
CANDIDATE text evidence — it never overwrites exact native PDF text, E5 critical
punctuation or E4 numeric-cell association (conflicts are recorded). No live API is
invoked in E9; state stays `unproven`.
"""
from __future__ import annotations

from typing import List

from . import _adapter_base as base
from .contracts import (
    EXTRACTION_PROVIDER_ADAPTER_VERSION, ExtractionProviderRequestV1, ExtractionProviderResultV1,
    ProviderCapabilityManifestV1, ProviderLimitsV1, UNKNOWN_COST,
)
from .normalization import COORD_NORMALIZED
from .policy import ExtractionProviderPolicyV1
from .protocol import (
    ProviderCapabilityContext, ProviderEstimateV1, ProviderNormalizationContext, ProviderRequestValidationResultV1,
    ProviderRuntimeContext,
)
from .request_identity import configuration_identity


class GoogleDocumentAiOcrAdapter:
    provider_id = "google-document-ai-ocr"
    adapter_version = EXTRACTION_PROVIDER_ADAPTER_VERSION

    def capabilities(self, context: ProviderCapabilityContext) -> ProviderCapabilityManifestV1:
        client_present = bool(context.configuration.get("injectedClientPresent"))
        processor = context.configuration.get("processorConfigured")
        caps = base.empty_caps()
        caps["ocr"] = base.cap(api=client_present, configured=bool(processor))
        caps["nativeText"] = base.cap(api=client_present, configured=bool(processor))
        state = "configuration-missing" if not (client_present and processor) else "unproven"
        return base.manifest(
            provider_id=self.provider_id, adapter_version=self.adapter_version, available=False,
            availability_state=state, execution_mode="remote", supported_scopes=["page"], capabilities=caps,
            package_versions={}, model_identity={"processorType": context.configuration.get("processorType")},
            configuration_identity=self._cfg(context),
            privacy_classes=["internal"], residency_classes=["australia-approved", "approved-regions-only"],
            limits=ProviderLimitsV1(max_pages=10, max_regions=0, max_bytes=1 << 25, timeout_ms=60000, max_retries=0),
            problems=["policy-disabled-by-default", "page-bounded-only", "no-live-call-in-e9"],
        )

    def _cfg(self, context: ProviderCapabilityContext) -> str:
        return configuration_identity(
            provider_id=self.provider_id, adapter_version=self.adapter_version, engine_package_version=None,
            model_preset=None, processor_type=context.configuration.get("processorType"),
            processor_version=context.configuration.get("processorVersion"), trusted_location=context.configuration.get("location"),
            ocr_options=context.configuration.get("ocrOptions", {}), table_options={}, chart_options={},
            vlm_preset=None, privacy_policy_version=context.configuration.get("privacyPolicyVersion"),
        )

    def validate_request(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderRequestValidationResultV1:
        errs: List[str] = []
        if not policy.remote_providers_enabled:
            errs.append("provider_remote_not_approved")
        if request.scope.type != "page":
            errs.append("provider_scope_invalid")  # OCR recovery is page-bounded
        pages = request.scope.page_end - request.scope.page_start + 1
        if pages > 10:
            errs.append("provider_page_limit_exceeded")  # never a full-document send
        return ProviderRequestValidationResultV1(valid=not errs, errors=errs)

    def estimate(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderEstimateV1:
        return ProviderEstimateV1(estimated_cost=UNKNOWN_COST, estimated_ms=None)

    def execute(self, request: ExtractionProviderRequestV1, runtime: ProviderRuntimeContext) -> ExtractionProviderResultV1:
        result = base.base_result(request, self.provider_id, self.adapter_version, "success")
        client = runtime.injected_client
        if client is None or not hasattr(client, "process_document"):
            result.status = "failure"
            result.problems.append("provider_configuration_missing")
            return result
        raw = client.process_document(
            processor_resource=getattr(runtime, "processor_resource", None) or "TRUSTED_OCR_PROCESSOR",
            content=runtime.source_bytes or b"", mime_type="application/pdf", field_mask=None,
            timeout_seconds=(request.budgets.timeout_ms or 60000) / 1000.0,
        )
        payload = raw if isinstance(raw, dict) else {"pages": []}
        pages = payload.get("pages", [])
        result.pages_processed = [int(p.get("pageNumber", 0)) for p in pages]
        result.status = payload.get("status", "success")
        result.complete = result.status == "success"
        result.engine_identity = {"engine": "google-document-ai-ocr"}
        base.stash_payload(result, payload)
        return result

    def normalize(self, result: ExtractionProviderResultV1, context: ProviderNormalizationContext):
        return base.build_bundle(result=result, request=base.request_stub_from_result(result), provider_id=self.provider_id,
                                 adapter_version=self.adapter_version, context=context, coord_system=COORD_NORMALIZED)

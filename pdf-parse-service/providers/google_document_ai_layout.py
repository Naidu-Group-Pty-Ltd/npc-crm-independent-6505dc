"""E9 — google-document-ai-layout provider (remote, POLICY-DISABLED by default).

Layout / reading-order / paragraph / block / table / form recovery. Uses an
INJECTED client + trusted server processor configuration only. No live API is
invoked during E9; capability state stays `unproven` until a later controlled
cloud gate. All table evidence normalizes through E4; text is supplemental to E5;
visual evidence is supplemental to E3. The raw response is never logged.
"""
from __future__ import annotations

from typing import List, Optional

from . import _adapter_base as base
from .contracts import (
    EXTRACTION_PROVIDER_ADAPTER_VERSION, ExtractionProviderRequestV1, ExtractionProviderResultV1,
    ProviderCapabilityManifestV1, ProviderCostEstimateV1, ProviderLimitsV1, UNKNOWN_COST,
)
from .normalization import COORD_BOTTOM_LEFT_PT, COORD_NORMALIZED
from .policy import ExtractionProviderPolicyV1
from .protocol import (
    ProviderCapabilityContext, ProviderEstimateV1, ProviderNormalizationContext, ProviderRequestValidationResultV1,
    ProviderRuntimeContext,
)
from .request_identity import configuration_identity


class GoogleDocumentAiLayoutAdapter:
    provider_id = "google-document-ai-layout"
    adapter_version = EXTRACTION_PROVIDER_ADAPTER_VERSION

    def capabilities(self, context: ProviderCapabilityContext) -> ProviderCapabilityManifestV1:
        client_present = bool(context.configuration.get("injectedClientPresent"))
        processor = context.configuration.get("processorConfigured")
        caps = base.empty_caps()
        caps["layout"] = base.cap(api=client_present, configured=bool(processor))
        caps["tables"] = base.cap(api=client_present, configured=bool(processor))
        caps["tableCells"] = base.cap(api=client_present, configured=bool(processor))
        caps["ocr"] = base.cap(api=client_present, configured=bool(processor))
        caps["pictures"] = base.cap(api=client_present, configured=bool(processor))
        # remote: `ready` requires trusted config + policy + injected client, but live
        # execution stays `unproven` until a controlled cloud gate.
        if not client_present:
            state = "configuration-missing"
        elif not processor:
            state = "configuration-missing"
        else:
            state = "unproven"
        return base.manifest(
            provider_id=self.provider_id, adapter_version=self.adapter_version, available=False,
            availability_state=state, execution_mode="remote",
            supported_scopes=["page-range", "page"], capabilities=caps,
            package_versions={}, model_identity={"processorType": context.configuration.get("processorType"), "processorVersion": context.configuration.get("processorVersion")},
            configuration_identity=self._cfg(context),
            privacy_classes=["internal"], residency_classes=["australia-approved", "approved-regions-only"],
            limits=ProviderLimitsV1(max_pages=30, max_regions=200, max_bytes=1 << 26, timeout_ms=60000, max_retries=0),
            problems=["policy-disabled-by-default", "no-live-call-in-e9"],
        )

    def _cfg(self, context: ProviderCapabilityContext) -> str:
        return configuration_identity(
            provider_id=self.provider_id, adapter_version=self.adapter_version, engine_package_version=None,
            model_preset=None, processor_type=context.configuration.get("processorType"),
            processor_version=context.configuration.get("processorVersion"), trusted_location=context.configuration.get("location"),
            ocr_options={}, table_options=context.configuration.get("tableOptions", {}), chart_options={},
            vlm_preset=None, privacy_policy_version=context.configuration.get("privacyPolicyVersion"),
        )

    def validate_request(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderRequestValidationResultV1:
        errs: List[str] = []
        if not policy.remote_providers_enabled:
            errs.append("provider_remote_not_approved")
        if request.scope.type not in ("page", "page-range"):
            errs.append("provider_scope_invalid")
        return ProviderRequestValidationResultV1(valid=not errs, errors=errs)

    def estimate(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderEstimateV1:
        # cost from a trusted rate card only; unknown when none configured.
        return ProviderEstimateV1(estimated_cost=UNKNOWN_COST, estimated_ms=None)

    def execute(self, request: ExtractionProviderRequestV1, runtime: ProviderRuntimeContext) -> ExtractionProviderResultV1:
        result = base.base_result(request, self.provider_id, self.adapter_version, "success")
        client = runtime.injected_client
        if client is None or not hasattr(client, "process_document"):
            result.status = "failure"
            result.problems.append("provider_configuration_missing")
            return result
        processor = getattr(runtime, "processor_resource", None) or getattr(client, "processor_resource", None)
        try:
            # processor_resource comes ONLY from trusted config; never client-derived / logged.
            raw = client.process_document(
                processor_resource=processor or "TRUSTED_PROCESSOR",
                content=runtime.source_bytes or b"",
                mime_type="application/pdf",
                field_mask=None,
                timeout_seconds=(request.budgets.timeout_ms or 60000) / 1000.0,
            )
        except BaseException:  # noqa: BLE001 — surfaced as a safe error by the runner
            raise
        payload = raw if isinstance(raw, dict) else {"pages": []}
        pages = payload.get("pages", [])
        result.pages_processed = [int(p.get("pageNumber", 0)) for p in pages]
        result.pages_failed = [p for p in result.pages_requested if p not in result.pages_processed]
        result.status = payload.get("status", "success" if not result.pages_failed else "partial-success")
        result.complete = result.status == "success"
        result.engine_identity = {"engine": "google-document-ai-layout"}
        base.stash_payload(result, payload)
        return result

    def normalize(self, result: ExtractionProviderResultV1, context: ProviderNormalizationContext):
        # Google layout typically reports normalized 0..1 coordinates.
        return base.build_bundle(result=result, request=base.request_stub_from_result(result), provider_id=self.provider_id,
                                 adapter_version=self.adapter_version, context=context, coord_system=COORD_NORMALIZED)

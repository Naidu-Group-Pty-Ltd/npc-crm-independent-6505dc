"""E9 — docling-vlm provider (local-only, DISABLED + UNPROVEN by default).

remote services false, external plugins false, trust_remote_code false. No
arbitrary prompt, no client-provided model or generation options. Never reports
`effective` until a real later runtime gate proves it. VLM output is UNTRUSTED
candidate evidence and can never overwrite exact numeric source evidence.
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


class DoclingVlmAdapter:
    provider_id = "docling-vlm"
    adapter_version = EXTRACTION_PROVIDER_ADAPTER_VERSION

    # hard-wired safety posture (never client-overridable).
    remote_services = False
    external_plugins = False
    trust_remote_code = False

    def capabilities(self, context: ProviderCapabilityContext) -> ProviderCapabilityManifestV1:
        api = "docling" in context.installed_packages
        model_present = bool(context.configuration.get("vlmModelPresent"))
        hardware_ok = bool(context.configuration.get("vlmHardwareAvailable"))
        model_ready = bool((context.model_ready or {}).get("vlm"))
        caps = base.empty_caps()
        # vlm capability is model_configured but NEVER effective until proven.
        caps["vlm"] = base.cap(api=api, configured=bool(context.configuration.get("vlmConfigured")),
                               model_configured=model_present, model_ready=model_ready and hardware_ok)
        caps["chartMetadata"] = base.cap(api=api, configured=bool(context.configuration.get("vlmConfigured")), model_configured=model_present, model_ready=model_ready and hardware_ok)
        if not api:
            state = "dependency-missing"
        elif not model_present:
            state = "model-missing"
        elif not hardware_ok:
            state = "unavailable"
        elif not model_ready:
            state = "unproven"  # configured but not proven effective
        else:
            state = "unproven"  # even ready stays unproven until a live gate
        return base.manifest(
            provider_id=self.provider_id, adapter_version=self.adapter_version, available=False,
            availability_state=state, execution_mode="local-optional",
            supported_scopes=["page", "region"], capabilities=caps,
            package_versions={"docling": context.installed_packages.get("docling", "")},
            model_identity={"vlmModel": context.configuration.get("vlmModel"), "vlmPreset": context.configuration.get("vlmPreset")},
            configuration_identity=self._cfg(context),
            privacy_classes=["confidential", "restricted"],
            residency_classes=["local-only"],
            limits=ProviderLimitsV1(max_pages=50, max_regions=200, max_bytes=1 << 28, timeout_ms=180000, max_retries=0),
            problems=["remote_services=false", "trust_remote_code=false", "external_plugins=false"],
        )

    def _cfg(self, context: ProviderCapabilityContext) -> str:
        return configuration_identity(
            provider_id=self.provider_id, adapter_version=self.adapter_version,
            engine_package_version=context.installed_packages.get("docling"), model_preset=None, processor_type=None,
            processor_version=None, trusted_location=None, ocr_options={}, table_options={}, chart_options={},
            vlm_preset=str(context.configuration.get("vlmPreset", "")), privacy_policy_version=None,
        )

    def validate_request(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderRequestValidationResultV1:
        errs: List[str] = []
        if not policy.remote_vlm_enabled:
            # VLM stays disabled by default; the runner also blocks via policy gate.
            errs.append("provider_vlm_disabled")
        if request.scope.type not in ("page", "region"):
            errs.append("provider_scope_invalid")
        return ProviderRequestValidationResultV1(valid=not errs, errors=errs)

    def estimate(self, request: ExtractionProviderRequestV1, policy: ExtractionProviderPolicyV1) -> ProviderEstimateV1:
        return ProviderEstimateV1(estimated_cost=UNKNOWN_COST, estimated_ms=None)

    def execute(self, request: ExtractionProviderRequestV1, runtime: ProviderRuntimeContext) -> ExtractionProviderResultV1:
        result = base.base_result(request, self.provider_id, self.adapter_version, "success")
        payload = runtime.injected_client if isinstance(runtime.injected_client, dict) else None
        if payload is None:
            result.status = "skipped"
            result.problems.append("provider_model_unproven")
            return result
        # fake VLM runtime output (tests) — untrusted candidate evidence.
        pages = payload.get("pages", [])
        result.pages_processed = [int(p.get("pageNumber", 0)) for p in pages]
        result.status = "success"
        result.complete = True
        result.engine_identity = {"engine": "docling-vlm", "trustRemoteCode": self.trust_remote_code, "remoteServices": self.remote_services}
        base.stash_payload(result, payload)
        return result

    def normalize(self, result: ExtractionProviderResultV1, context: ProviderNormalizationContext):
        return base.build_bundle(result=result, request=base.request_stub_from_result(result), provider_id=self.provider_id,
                                 adapter_version=self.adapter_version, context=context, coord_system=COORD_TOP_LEFT_PT)

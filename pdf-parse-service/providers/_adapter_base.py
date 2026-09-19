"""E9 — shared adapter helpers (pure).

Builds capability manifests, results and evidence bundles from a provider-neutral
"synthetic payload" so adapters stay small and testable offline. The raw payload
is carried on the result as a runtime-only attribute (never persisted).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .contracts import (
    CapabilityTruthV1, ExtractionProviderRequestV1, ExtractionProviderResultV1, ProviderCapabilityManifestV1,
    ProviderChartEvidenceV1, ProviderCodeEvidenceV1, ProviderEvidenceBundleV1, ProviderFormulaEvidenceV1,
    ProviderLimitsV1, ProviderPageEvidenceV1, ProviderPictureEvidenceV1, ProviderRegionEvidenceV1,
    ProviderTableEvidenceV1, ProviderTextSpanEvidenceV1, SourceBBox, UNKNOWN_COST,
)
from .normalization import (
    NormalizationError, geometry_hash, normalize_bbox, normalize_text, provider_evidence_id,
    table_topology_hash, text_hash,
)
from .protocol import ProviderNormalizationContext
from .request_identity import result_hash


def cap(api=False, configured=False, model_configured=False, model_ready=False) -> CapabilityTruthV1:
    """effective = apiPresent ∧ configured ∧ (model_configured→model_ready)."""
    effective = api and configured and (model_ready if model_configured else True)
    return CapabilityTruthV1(api_present=api, configured=configured, model_configured=model_configured, model_ready=model_ready, effective=effective)


def empty_caps() -> Dict[str, CapabilityTruthV1]:
    return {k: cap() for k in ("nativeText", "ocr", "layout", "tables", "tableCells", "pictures",
                               "chartMetadata", "formulas", "code", "typography", "vectors", "vlm")}


def manifest(
    *, provider_id: str, adapter_version: str, available: bool, availability_state: str, execution_mode: str,
    supported_scopes: List[str], capabilities: Dict[str, CapabilityTruthV1], package_versions: Dict[str, str],
    model_identity: Dict[str, Optional[str]], configuration_identity: str, privacy_classes: List[str],
    residency_classes: List[str], limits: ProviderLimitsV1, problems: Optional[List[str]] = None,
) -> ProviderCapabilityManifestV1:
    return ProviderCapabilityManifestV1(
        provider_id=provider_id, adapter_version=adapter_version, available=available,
        availability_state=availability_state, execution_mode=execution_mode, supported_scopes=supported_scopes,
        capabilities=capabilities, package_versions=package_versions, model_identity=model_identity,
        configuration_identity=configuration_identity, privacy_classes_allowed=privacy_classes,
        residency_classes_allowed=residency_classes, limits=limits, problems=problems or [],
    )


def base_result(request: ExtractionProviderRequestV1, provider_id: str, adapter_version: str, status: str) -> ExtractionProviderResultV1:
    pages = list(range(request.scope.page_start, request.scope.page_end + 1))
    return ExtractionProviderResultV1(
        request_id=request.request_id, attempt_id=request.attempt_id, provider_id=provider_id,
        adapter_version=adapter_version, configuration_identity=request.provider_profile.configuration_identity,
        status=status, pages_requested=pages, pages_processed=[], pages_failed=[],
        regions_requested=list(request.scope.region_ids), regions_processed=[], regions_failed=[],
        provider_payload_ref=None, normalized_evidence_ref=None, result_hash=None, engine_identity={},
        timings={"queuedMs": None, "executionMs": None, "normalizationMs": None, "totalMs": None},
        usage={"inputBytes": None, "outputBytes": None, "pageUnits": len(pages), "featureUnits": {}},
        estimated_cost=UNKNOWN_COST, errors=[], problems=[], complete=False,
    )


def stash_payload(result: ExtractionProviderResultV1, payload: Any) -> None:
    """Attach a runtime-only raw payload (never persisted)."""
    object.__setattr__(result, "_raw_payload", payload)


def request_stub_from_result(result: ExtractionProviderResultV1) -> ExtractionProviderRequestV1:
    """normalize() needs only request_id + configuration_identity from the request."""
    from .contracts import ProviderScopeV1, ProviderProfileRefV1, ProviderPolicyRefV1, ProviderBudgetsV1
    return ExtractionProviderRequestV1(
        request_id=result.request_id, import_id="", job_id="", attempt_id=result.attempt_id,
        source={}, scope=ProviderScopeV1("document", 1, 1), purpose="primary-extraction", requested_capabilities=[],
        provider_profile=ProviderProfileRefV1(result.provider_id, result.configuration_identity, "default", ""),
        policy_ref=ProviderPolicyRefV1("", "", "confidential", "local-only", False),
        budgets=ProviderBudgetsV1(0, 0, 0, 0, 0),
    )


def read_payload(result: ExtractionProviderResultV1) -> Any:
    return getattr(result, "_raw_payload", None)


def _span_evidence(provider_id, request_id, cfg, page, spans, page_w, page_h, coord_system) -> List[ProviderTextSpanEvidenceV1]:
    out: List[ProviderTextSpanEvidenceV1] = []
    for i, s in enumerate(spans):
        try:
            bbox = normalize_bbox(s.get("bbox", {}), system=coord_system, page_width_pt=page_w, page_height_pt=page_h) if s.get("bbox") else None
        except NormalizationError as e:
            out_id = provider_evidence_id(provider_id=provider_id, request_id=request_id, page_number=page, kind="span", provider_local_ref=str(s.get("ref", i)), bbox=None, ordinal=i, configuration_identity=cfg)
            out.append(ProviderTextSpanEvidenceV1(out_id, s.get("text", ""), normalize_text(s.get("text", ""))["normalizedNfc"], None, s.get("readingOrder"), s.get("confidence"), [f"bbox_rejected:{e.code}"]))
            continue
        nt = normalize_text(s.get("text", ""))
        eid = provider_evidence_id(provider_id=provider_id, request_id=request_id, page_number=page, kind="span", provider_local_ref=str(s.get("ref", i)), bbox=bbox, ordinal=i, configuration_identity=cfg)
        out.append(ProviderTextSpanEvidenceV1(eid, nt["raw"], nt["normalizedNfc"], bbox, s.get("readingOrder"), s.get("confidence"), []))
    return out


def build_bundle(
    *, result: ExtractionProviderResultV1, request: ExtractionProviderRequestV1, provider_id: str, adapter_version: str,
    context: ProviderNormalizationContext, coord_system: str,
) -> ProviderEvidenceBundleV1:
    payload = read_payload(result) or {}
    cfg = request.provider_profile.configuration_identity
    pages_in = payload.get("pages", [])
    pages: List[ProviderPageEvidenceV1] = []
    geo_hashes: List[str] = []
    text_hashes: List[str] = []
    table_hashes: List[str] = []
    refs: List[str] = []
    for p in pages_in:
        pn = int(p.get("pageNumber", 0))
        pw = float(p.get("widthPt") or context.page_sizes.get(pn, {}).get("widthPt", 595.0))
        ph = float(p.get("heightPt") or context.page_sizes.get(pn, {}).get("heightPt", 842.0))
        spans = _span_evidence(provider_id, request.request_id, cfg, pn, p.get("textSpans", []), pw, ph, coord_system)
        for s in spans:
            if s.bbox:
                geo_hashes.append(geometry_hash(s.bbox))
            text_hashes.append(text_hash(s.raw_text))
            refs.append(s.evidence_id)
        tables: List[ProviderTableEvidenceV1] = []
        for j, t in enumerate(p.get("tables", [])):
            eid = provider_evidence_id(provider_id=provider_id, request_id=request.request_id, page_number=pn, kind="table", provider_local_ref=str(t.get("ref", j)), bbox=None, ordinal=j, configuration_identity=cfg)
            cells = t.get("cells", [])
            cell_refs = [f"{c.get('row')}:{c.get('col')}:{text_hash(str(c.get('text','')))}" for c in cells]
            th = table_topology_hash(t.get("rows", 0), t.get("cols", 0), t.get("headerRows", 0), t.get("headerCols", 0), cell_refs)
            table_hashes.append(th)
            refs.append(eid)
            tables.append(ProviderTableEvidenceV1(
                eid, provider_id, adapter_version, cfg, t.get("profile", "default"), t.get("sourceRegionRef"),
                str(t.get("ref", j)), t.get("rows", 0), t.get("cols", 0), t.get("headerRows", 0), t.get("headerCols", 0),
                cells, t.get("numericTokens", []), t.get("punctuationTokens", []), t.get("confidence"), [],
            ))
        charts: List[ProviderChartEvidenceV1] = []
        for k, c in enumerate(p.get("charts", [])):
            eid = provider_evidence_id(provider_id=provider_id, request_id=request.request_id, page_number=pn, kind="chart", provider_local_ref=str(c.get("ref", k)), bbox=None, ordinal=k, configuration_identity=cfg)
            refs.append(eid)
            charts.append(ProviderChartEvidenceV1(eid, c.get("chartType"), c.get("caption"), c.get("axisLabels", []), c.get("legendLabels", []), c.get("seriesNames", []), c.get("numericLabels", []), None, c.get("confidence"), []))
        pics: List[ProviderPictureEvidenceV1] = []
        for m, pic in enumerate(p.get("pictures", [])):
            eid = provider_evidence_id(provider_id=provider_id, request_id=request.request_id, page_number=pn, kind="pic", provider_local_ref=str(pic.get("ref", m)), bbox=None, ordinal=m, configuration_identity=cfg)
            refs.append(eid)
            pics.append(ProviderPictureEvidenceV1(eid, None, pic.get("classification"), pic.get("confidence"), []))
        pages.append(ProviderPageEvidenceV1(
            page_number=pn, width_pt=pw, height_pt=ph, rotation=p.get("rotation"),
            text_spans=spans, layout_regions=[], tables=tables, pictures=pics, charts=charts,
            formulas=[], code_blocks=[], page_confidence=p.get("pageConfidence"), provider_page_ref=p.get("ref"),
            complete=bool(p.get("complete", True)), problems=list(p.get("problems", [])),
        ))
    completeness_problems = [] if result.status == "success" else ["partial"]
    rh = result_hash(
        provider_id=provider_id, adapter_version=adapter_version, configuration_identity=cfg, request_id=request.request_id,
        page_numbers=[p.page_number for p in pages], normalized_geometry_hashes=geo_hashes, normalized_text_hashes=text_hashes,
        table_topology_hashes=table_hashes, provider_refs=refs, status=result.status, completeness_problems=completeness_problems,
    )
    return ProviderEvidenceBundleV1(
        provider_id=provider_id, adapter_version=adapter_version, configuration_identity=cfg,
        request_id=request.request_id, attempt_id=result.attempt_id, status=result.status,
        document={"sourceSha256": context.source_sha256, "pageCountExpected": context.page_count_expected, "pageCountObserved": len(pages)},
        pages=pages, provider_problems=list(result.problems), result_hash=rh, complete=(result.status == "success"),
    )

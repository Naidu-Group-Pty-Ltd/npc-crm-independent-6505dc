"""E9 — deterministic provider request / attempt / configuration identities.

Identical requests → identical request IDs. Request identity excludes timestamps,
signed URLs, retry number, credentials, temp paths and random UUIDs. Retries share
one request ID but have distinct deterministic attempt IDs.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .contracts import fnv1a32, stable_json, strip_urls


def configuration_identity(
    *,
    provider_id: str,
    adapter_version: str,
    engine_package_version: Optional[str],
    model_preset: Optional[str],
    processor_type: Optional[str],
    processor_version: Optional[str],
    trusted_location: Optional[str],
    ocr_options: Dict[str, Any],
    table_options: Dict[str, Any],
    chart_options: Dict[str, Any],
    vlm_preset: Optional[str],
    privacy_policy_version: Optional[str],
) -> str:
    """Configuration identity — SEPARATE from provider id; never contains secrets."""
    payload = {
        "providerId": provider_id, "adapterVersion": adapter_version,
        "enginePackageVersion": engine_package_version, "modelPreset": model_preset,
        "processorType": processor_type, "processorVersion": processor_version,
        "trustedLocation": trusted_location,
        "ocrOptions": ocr_options, "tableOptions": table_options, "chartOptions": chart_options,
        "vlmPreset": vlm_preset, "privacyPolicyVersion": privacy_policy_version,
    }
    return f"pcfg-{fnv1a32(strip_urls(stable_json(payload)))}"


def options_hash(options: Dict[str, Any]) -> str:
    return f"popt-{fnv1a32(strip_urls(stable_json(options)))}"


def request_id(
    *,
    source_sha256: str,
    provider_id: str,
    configuration_identity: str,
    purpose: str,
    page_start: int,
    page_end: int,
    region_ids: List[str],
    region_bboxes: List[Dict[str, Any]],
    requested_capabilities: List[str],
    options_hash: str,
    policy_hash: str,
) -> str:
    payload = {
        "sourceSha256": source_sha256, "providerId": provider_id, "configurationIdentity": configuration_identity,
        "purpose": purpose, "pageStart": page_start, "pageEnd": page_end,
        "regionIds": sorted(region_ids),
        "regionBBoxes": sorted(region_bboxes, key=lambda b: (b.get("regionId", ""), b.get("pageNumber", 0))),
        "requestedCapabilities": sorted(requested_capabilities),
        "optionsHash": options_hash, "policyHash": policy_hash,
    }
    return f"preq-{fnv1a32(stable_json(payload))}"


def attempt_id(*, request_id: str, attempt_ordinal: int, adapter_version: str) -> str:
    return f"patt-{fnv1a32(f'{request_id}~{attempt_ordinal}~{adapter_version}')}"


def result_hash(
    *,
    provider_id: str,
    adapter_version: str,
    configuration_identity: str,
    request_id: str,
    page_numbers: List[int],
    normalized_geometry_hashes: List[str],
    normalized_text_hashes: List[str],
    table_topology_hashes: List[str],
    provider_refs: List[str],
    status: str,
    completeness_problems: List[str],
) -> str:
    """Deterministic normalized-evidence hash; excludes timestamps/urls/paths/creds
    and ordering that is semantically irrelevant (sorted)."""
    payload = {
        "providerId": provider_id, "adapterVersion": adapter_version, "configurationIdentity": configuration_identity,
        "requestId": request_id, "pageNumbers": sorted(page_numbers),
        "geometry": sorted(normalized_geometry_hashes), "text": sorted(normalized_text_hashes),
        "tables": sorted(table_topology_hashes), "providerRefs": sorted(provider_refs),
        "status": status, "completenessProblems": sorted(completeness_problems),
    }
    return f"pres-{fnv1a32(strip_urls(stable_json(payload)))}"

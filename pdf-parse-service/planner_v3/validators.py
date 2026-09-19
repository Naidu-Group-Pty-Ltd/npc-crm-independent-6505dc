"""PDF Extraction V3 · E10 — persisted-shape validators (bounded diagnostics).

Reject anything that would corrupt cache safety or leak a secret if persisted:
  * a wrong/absent contract version;
  * a legacy (V1/V2) cache contract masquerading as reusable by V3;
  * a signed URL, absolute path or traversal ref where a durable ref belongs;
  * a non-finite number.
These return a bounded list of stable problem codes (never raise), so a caller
can fail closed on a malformed record instead of trusting it.
"""
from __future__ import annotations

from typing import Any, Dict, List

from .contracts import (
    PDF_CACHE_ENTRY_V3_VERSION,
    PDF_CACHE_FINGERPRINT_V3_VERSION,
    PDF_EXTRACTION_PLAN_V3_VERSION,
    is_signed_url,
)

_LEGACY_CACHE_CONTRACTS = frozenset(
    {"parse-cache-safety-v1", "pdf-cache-contract-v1", "pdf-cache-contract-v2"}
)


def _scan_forbidden(value: Any, depth: int = 0) -> List[str]:
    if depth > 8 or value is None:
        return []
    if isinstance(value, str):
        return ["signed_url_persisted"] if is_signed_url(value) else []
    if isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        import math

        return [] if math.isfinite(float(value)) else ["non_finite_number"]
    if isinstance(value, (bytes, bytearray)):
        return ["raw_payload_persisted"]
    if isinstance(value, (list, tuple)):
        out: List[str] = []
        for v in value:
            out.extend(_scan_forbidden(v, depth + 1))
        return out
    if isinstance(value, dict):
        out = []
        for k, v in value.items():
            # Durable-ref carrier keys are exempt from the signed-url scan.
            if k in ("durable_path", "durable_ref", "ref", "target_ref"):
                continue
            out.extend(_scan_forbidden(v, depth + 1))
        return out
    return []


def validate_plan_v3_shape(value: Any) -> List[str]:
    problems: List[str] = []
    if not isinstance(value, dict):
        return ["plan_not_object"]
    if value.get("version") != PDF_EXTRACTION_PLAN_V3_VERSION:
        problems.append("plan_invalid_version")
    if not isinstance(value.get("plan_id"), str) or not value.get("plan_id"):
        problems.append("plan_missing_id")
    if not isinstance(value.get("plan_hash"), str) or not value.get("plan_hash"):
        problems.append("plan_missing_hash")
    problems.extend(_scan_forbidden(value))
    return sorted(set(problems))


def validate_cache_entry_v3_shape(value: Any) -> List[str]:
    problems: List[str] = []
    if not isinstance(value, dict):
        return ["cache_entry_not_object"]
    if value.get("version") != PDF_CACHE_ENTRY_V3_VERSION:
        problems.append("cache_entry_invalid_version")
    contract = value.get("contract_version")
    if contract in _LEGACY_CACHE_CONTRACTS:
        problems.append("cache_reuse_forbidden_legacy_contract")
    elif contract != PDF_CACHE_FINGERPRINT_V3_VERSION:
        problems.append("cache_entry_invalid_contract")
    if not isinstance(value.get("cache_fingerprint"), str) or not value.get("cache_fingerprint"):
        problems.append("cache_entry_missing_fingerprint")
    problems.extend(_scan_forbidden(value))
    return sorted(set(problems))

"""PDF Extraction V3 · E10 — Planner V3, service routing, cache safety and recovery.

This package is the sidecar-side mirror of the canonical shared TypeScript
Planner V3 contracts (``supabase/functions/_shared/pdfExtractionPlanV3.pure.ts``
and siblings). It produces ONE immutable Plan V3 from a fixed set of planner
inputs, so that:

    same source
  + same requested output
  + same planner inputs
  + same provider policy
  + same service registry
  + same implementation versions

deterministically yields the SAME plan id, plan hash, page classifications,
service routes, provider policy, chunk plan and cache fingerprint — on both the
Python sidecar and the TypeScript edge/runtime, byte-for-byte for ASCII inputs.

IMPORT-SAFETY: importing this package (or any module in it) initializes no
Docling / Torch / OCR model / Google SDK, opens no file, reads no secret, and
performs no network I/O. Every identity is a pure function of structural inputs
(sorted-key compact JSON, with SHA-256 for cache fingerprints and legacy
FNV-1a-32 for non-security identifiers — no timestamps, signed URLs,
credentials, temp paths, job ids or retry counters).

BACKWARD COMPATIBILITY: nothing here is wired into the live parse path. Planner
V3 is additive and shadow-mode by default; existing Plan V2 dispatch, the C1
cache contract v2, and every prior E-package guarantee are preserved unchanged.
Logical service CLASSES (``fast_cpu`` / ``heavy_cpu_au`` / ``docai_au`` /
``vlm_gpu_sg`` / ``raster_only``) are deliberately separate from physical service
URLs — a route decision names a class, never a host.
"""
from __future__ import annotations

# Re-export the stable public surface. These imports are all pure-Python and
# side-effect free, so importing the package stays import-safe.
from .contracts import (  # noqa: F401
    PDF_EXTRACTION_PREFLIGHT_VERSION,
    PDF_PAGE_COMPLEXITY_VERSION,
    PDF_EXTRACTION_PLAN_V3_VERSION,
    PDF_SERVICE_CLASS_REGISTRY_VERSION,
    PDF_SERVICE_ROUTING_POLICY_VERSION,
    PDF_SERVICE_ROUTE_DECISION_VERSION,
    PDF_EXECUTION_TARGET_VERSION,
    PDF_EXECUTION_ATTEMPT_VERSION,
    PDF_CACHE_FINGERPRINT_V3_VERSION,
    PDF_CACHE_ENTRY_V3_VERSION,
    PDF_ARTIFACT_COMPLETENESS_VERSION,
    PDF_RECOVERY_PLAN_VERSION,
    PDF_ROUTING_AUDIT_VERSION,
    SERVICE_CLASSES,
    ServiceClass,
    fnv1a32,
    stable_json,
    stable_hash,
)

__all__ = [
    "PDF_EXTRACTION_PREFLIGHT_VERSION",
    "PDF_PAGE_COMPLEXITY_VERSION",
    "PDF_EXTRACTION_PLAN_V3_VERSION",
    "PDF_SERVICE_CLASS_REGISTRY_VERSION",
    "PDF_SERVICE_ROUTING_POLICY_VERSION",
    "PDF_SERVICE_ROUTE_DECISION_VERSION",
    "PDF_EXECUTION_TARGET_VERSION",
    "PDF_EXECUTION_ATTEMPT_VERSION",
    "PDF_CACHE_FINGERPRINT_V3_VERSION",
    "PDF_CACHE_ENTRY_V3_VERSION",
    "PDF_ARTIFACT_COMPLETENESS_VERSION",
    "PDF_RECOVERY_PLAN_VERSION",
    "PDF_ROUTING_AUDIT_VERSION",
    "SERVICE_CLASSES",
    "ServiceClass",
    "fnv1a32",
    "stable_json",
    "stable_hash",
]

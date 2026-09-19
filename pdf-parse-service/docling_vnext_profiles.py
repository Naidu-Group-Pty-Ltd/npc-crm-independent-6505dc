"""docling-vnext-compat-v1 — vNext converter profile + lane mapping (E2).

Pure + deterministic + import-safe (no docling). Defines the immutable
`VNextConverterProfile` (every field that changes the vNext converter or its
model graph), a stable `converter_key` for converter caching, the build-level
capability ceiling (`VNextBuildOptions`), and `resolve_vnext_converter_profile`
which maps the existing Lane Policy V2 intent onto vNext options — WITHOUT
duplicating lane resolution (`lane_policy.resolve_execution_policy` stays the
source of request/lane semantics) and WITHOUT enabling any feature whose model
is not ready or whose build ceiling forbids it.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field, replace
from typing import Any, Optional

MODEL_MANIFEST_VERSION = "docling-model-manifest-v1"

PipelineFamily = str  # 'standard' | 'threaded_standard' | 'vlm'


@dataclass(frozen=True)
class VNextBuildOptions:
    """Build-time capability CEILING. A feature can only be enabled by a lane if
    the build allows it AND the runtime reports it model-ready. Request data can
    NEVER raise this ceiling (security: remote services / plugins / arbitrary
    models stay off)."""
    build_profile: str = "vnext-cpu-standard"
    device: str = "cpu"
    num_threads: int = 4
    allow_ocr: bool = True
    ocr_engine: str = "easyocr"
    allow_table_structure: bool = True
    allow_picture_classification: bool = True
    allow_picture_description: bool = False
    allow_chart_extraction: bool = False
    allow_chart_to_csv: bool = False
    allow_chart_to_code: bool = False
    allow_chart_to_summary: bool = False
    allow_formula_enrichment: bool = False
    allow_code_enrichment: bool = False
    allow_threaded_pipeline: bool = False
    allow_vlm: bool = False
    images_scale: float = 2.0
    # Hard security invariants — never overridable by a request.
    enable_remote_services: bool = False
    allow_external_plugins: bool = False
    trust_remote_code: bool = False


@dataclass(frozen=True)
class VNextConverterProfile:
    """Immutable, hashable, JSON-safe. Two profiles differing in ANY field below
    must not share a converter; identical profiles may. Post-processing-only
    request fields are intentionally excluded."""
    pipeline_family: PipelineFamily = "standard"
    device: str = "cpu"
    num_threads: int = 4

    do_ocr: bool = False
    ocr_engine: str = "easyocr"
    ocr_languages: tuple[str, ...] = ("en",)
    force_full_page_ocr: bool = False
    bitmap_area_threshold: float = 0.05

    do_table_structure: bool = True
    table_mode: str = "fast"           # 'fast' | 'accurate'
    table_cell_matching: bool = True
    table_model: Optional[str] = None

    do_picture_classification: bool = False
    picture_classifier_model: Optional[str] = None

    do_picture_description: bool = False
    picture_description_model: Optional[str] = None

    do_chart_extraction: bool = False
    chart_model: Optional[str] = None
    chart_to_csv: bool = False
    chart_to_code: bool = False
    chart_to_summary: bool = False

    do_formula_enrichment: bool = False
    do_code_enrichment: bool = False
    code_formula_model: Optional[str] = None

    generate_page_images: bool = False
    generate_picture_images: bool = False
    generate_table_images: bool = False
    generate_parsed_pages: bool = False
    images_scale: float = 2.0

    force_backend_text: bool = True
    heading_hierarchy: bool = True
    document_timeout: Optional[float] = None

    # Threaded standard pipeline knobs.
    ocr_batch_size: int = 4
    layout_batch_size: int = 4
    table_batch_size: int = 4
    queue_max_size: int = 100
    batch_polling_interval: float = 0.05

    # Optional local VLM.
    vlm_model: Optional[str] = None
    vlm_engine: Optional[str] = None       # 'transformers' | 'vllm' | ...
    vlm_scale: float = 2.0
    vlm_response_format: Optional[str] = None
    vlm_temperature: float = 0.0
    vlm_max_tokens: int = 0
    vlm_local: bool = True

    model_manifest_version: str = MODEL_MANIFEST_VERSION

    # Security invariants carried on the profile so they are part of the identity.
    enable_remote_services: bool = False
    allow_external_plugins: bool = False
    trust_remote_code: bool = False

    def to_json(self) -> dict:
        return asdict(self)

    def with_overrides(self, **kw: Any) -> "VNextConverterProfile":
        return replace(self, **kw)


def converter_key(profile: VNextConverterProfile) -> str:
    """Deterministic converter-cache key over EVERY converter-affecting field.

    Uses a sorted-key canonical JSON so field order can never change the key, and
    a SHA-256 over it. Identical profiles → identical key; any differing field →
    different key (proven exhaustively by the E2 converter-key tests)."""
    canonical = json.dumps(profile.to_json(), sort_keys=True, separators=(",", ":"), default=str)
    return f"{profile.pipeline_family}:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:24]}"


# ── Lane → profile mapping (Phase 8) ────────────────────────────────────────

_KNOWN_LANES = {
    "unplanned", "fast_native", "accurate_table", "ocr_scanned",
    "design_heavy", "pixel_raster_only",
}


def _feature_ready(capabilities: Any, name: str) -> bool:
    """A feature may be enabled only when the runtime reports it effective/ready.
    Accepts either a RuntimeCapabilityReport or a plain {name: bool} mapping; an
    unknown/None capability set is treated as NOT ready (safe default)."""
    if capabilities is None:
        return False
    features = getattr(capabilities, "features", None)
    if features is None and isinstance(capabilities, dict):
        features = capabilities.get("features", capabilities)
    if not isinstance(features, dict):
        return False
    feat = features.get(name)
    if feat is None:
        return False
    if isinstance(feat, bool):
        return feat
    eff = getattr(feat, "effective", None)
    if eff is None and isinstance(feat, dict):
        eff = feat.get("effective")
    return bool(eff)


def resolve_vnext_converter_profile(
    effective_lane_policy: dict,
    build_capabilities: Any,
    options: Optional[VNextBuildOptions] = None,
) -> VNextConverterProfile:
    """Map an EffectiveLanePolicy (as_dict) to a vNext converter profile.

    `build_capabilities` is a hard ceiling: a feature stays OFF unless it is both
    allowed by `options` and reported model-ready by capabilities. Lane semantics
    (do_ocr / force_full_page_ocr / table_mode) come from the existing policy.
    """
    opts = options or VNextBuildOptions()
    lane = str(effective_lane_policy.get("lane") or "unplanned")
    if lane not in _KNOWN_LANES:
        lane = "unplanned"

    policy_do_ocr = bool(effective_lane_policy.get("do_ocr")) and opts.allow_ocr
    policy_full_ocr = bool(effective_lane_policy.get("force_full_page_ocr")) and policy_do_ocr
    policy_table_mode = str(effective_lane_policy.get("table_mode") or "fast").lower()
    policy_pic_class = bool(effective_lane_policy.get("do_picture_classification"))

    can_class = opts.allow_picture_classification and _feature_ready(build_capabilities, "picture_classification")
    can_chart = opts.allow_chart_extraction and _feature_ready(build_capabilities, "chart_extraction")
    can_desc = opts.allow_picture_description and _feature_ready(build_capabilities, "picture_description")
    can_formula = opts.allow_formula_enrichment and _feature_ready(build_capabilities, "formula_enrichment")
    can_code = opts.allow_code_enrichment and _feature_ready(build_capabilities, "code_enrichment")
    threaded = opts.allow_threaded_pipeline and _feature_ready(build_capabilities, "threaded_standard_pipeline")
    family: PipelineFamily = "threaded_standard" if threaded else "standard"

    base = VNextConverterProfile(
        pipeline_family=family,
        device=opts.device,
        num_threads=opts.num_threads,
        ocr_engine=opts.ocr_engine,
        images_scale=opts.images_scale,
        enable_remote_services=False,
        allow_external_plugins=False,
        trust_remote_code=False,
    )

    if lane == "pixel_raster_only":
        # Source raster is authoritative; only the minimum for the artifact contract.
        return base.with_overrides(
            do_ocr=False, force_full_page_ocr=False,
            do_table_structure=False, do_picture_classification=False,
            do_chart_extraction=False, do_formula_enrichment=False, do_code_enrichment=False,
            do_picture_description=False,
            generate_page_images=False, generate_picture_images=False,
            force_backend_text=True,
        )

    if lane == "fast_native":
        return base.with_overrides(
            do_ocr=False, force_full_page_ocr=False,
            do_table_structure=True, table_mode="fast", table_cell_matching=True,
            do_picture_classification=False, do_chart_extraction=False,
            do_formula_enrichment=False, do_code_enrichment=False,
            force_backend_text=True,
        )

    if lane == "accurate_table":
        return base.with_overrides(
            do_ocr=policy_do_ocr, force_full_page_ocr=False,
            do_table_structure=True, table_mode="accurate", table_cell_matching=True,
            do_picture_classification=can_class and policy_pic_class,
            do_chart_extraction=False,
            do_formula_enrichment=can_formula, do_code_enrichment=False,
            force_backend_text=True,
        )

    if lane == "ocr_scanned":
        return base.with_overrides(
            do_ocr=True, force_full_page_ocr=True,
            do_table_structure=True, table_mode="accurate", table_cell_matching=True,
            do_picture_classification=can_class and policy_pic_class,
            do_chart_extraction=can_chart,  # only if chart-like evidence + build allows
            do_formula_enrichment=False, do_code_enrichment=False,
            force_backend_text=False,
        )

    if lane == "design_heavy":
        return base.with_overrides(
            do_ocr=policy_do_ocr, force_full_page_ocr=policy_full_ocr,
            do_table_structure=True, table_mode="accurate", table_cell_matching=True,
            do_picture_classification=can_class,
            do_picture_description=can_desc,
            do_chart_extraction=can_chart,
            chart_to_csv=can_chart and opts.allow_chart_to_csv,
            chart_to_code=False,
            chart_to_summary=can_chart and opts.allow_chart_to_summary,
            do_formula_enrichment=can_formula, do_code_enrichment=False,
            generate_page_images=True, generate_picture_images=True,
            images_scale=max(2.0, opts.images_scale),
            force_backend_text=True,
        )

    # unplanned — conservative compatibility profile; do NOT auto-enable every
    # expensive feature (keeps prewarm cheap).
    return base.with_overrides(
        do_ocr=policy_do_ocr, force_full_page_ocr=False,
        do_table_structure=True, table_mode=policy_table_mode if policy_table_mode in ("fast", "accurate") else "fast",
        table_cell_matching=True,
        do_picture_classification=False, do_chart_extraction=False,
        do_formula_enrichment=False, do_code_enrichment=False,
        force_backend_text=True,
    )


def accurate_table_candidates(base: VNextConverterProfile) -> dict[str, VNextConverterProfile]:
    """Produce the two testable accurate-table candidates (cell-matching on/off)
    for E4 to arbitrate later. E2 does NOT choose a winner."""
    return {
        "accurate_cell_matching_on": base.with_overrides(table_mode="accurate", table_cell_matching=True),
        "accurate_cell_matching_off": base.with_overrides(table_mode="accurate", table_cell_matching=False),
        "fast_table": base.with_overrides(table_mode="fast", table_cell_matching=True),
    }

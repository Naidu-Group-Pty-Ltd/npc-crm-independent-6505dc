"""Lane Policy V2 — the single, versioned source of truth for extraction-lane
behaviour in the PDF-import sidecar (Path-to-100 v2 · G1).

This module is intentionally free of any Docling / heavy imports so the pure
policy + converter-cache-key logic can be unit-tested cheaply (no model
download). `app.py` builds a :class:`GlobalCapabilities` from its environment
and calls :func:`resolve_execution_policy` from every parse path — synchronous
``/parse``, async monolithic ``/parse``, and ``/parse-chunk`` — so two execution
paths can never resolve the same lane differently.

Design:

* A lane declares its *intent*. ``INHERIT`` means "use the globally configured
  default" (used by the backwards-compatible ``unplanned`` lane).
* Global capability flags are a **hard ceiling**: a lane can never enable a
  feature the process has globally disabled (``effective = intent AND global``).
* A request may **disable** an optional output/enrichment a lane allows, but may
  **not enable** a feature the lane forbids.
* Forced lane requirements (``ocr_scanned`` full-page OCR, ``pixel_raster_only``
  pixel-perfect/raster-only) are authoritative, subject only to the global
  ceiling.
* The :class:`ConverterProfile` derived from the policy is the complete converter
  cache key — every Docling-``PdfPipelineOptions``-affecting field is in it.

Policy objects are frozen dataclasses; ``LANE_PROFILES`` is never mutated.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import Any, Optional


# v3: the process-level `force_full_page_ocr_default` is no longer derived from
# OCR *availability* (see app.py GLOBAL_CAPABILITIES), and formula/code
# enrichment now default off. Lane intents in LANE_PROFILES are unchanged, but
# every INHERIT cell resolves differently, so v2 artifacts must never be reused
# for a v3 request. The dispatcher's LANE_POLICY_VERSION mirror is bumped in
# lockstep — deploy the sidecar and dispatcher together (G3).
LANE_ENFORCEMENT_VERSION = "extractor-lane-policy-v3"

# Sentinel: "inherit the globally configured default for this field."
INHERIT = "__inherit_global__"

KNOWN_LANES = (
    "unplanned",
    "fast_native",
    "accurate_table",
    "ocr_scanned",
    "design_heavy",
    "pixel_raster_only",
)

# Gated features whose lane intent is ANDed with a global capability ceiling.
# Maps the policy field -> the GlobalCapabilities attribute that ceilings it.
GATED_FIELD_CAPABILITY = {
    "do_ocr": "ocr",
    "use_picture_description": "picture_description",
    "do_picture_classification": "picture_classification",
    "formula_enrichment": "formula",
    "code_enrichment": "code",
    "use_fitz_layers": "fitz",
}

_VALID_TABLE_MODES = {"FAST", "ACCURATE"}


# ---------------------------------------------------------------------------
# Lane intent matrix (Lane Policy V2). Concrete values are the lane's intent;
# INHERIT defers to the global configured default. Gated fields are additionally
# capped by the global capability ceiling in the resolver.
# ---------------------------------------------------------------------------
LANE_PROFILES: dict[str, dict[str, Any]] = {
    # Backwards-compatible default when planning data is missing / unknown lane.
    "unplanned": {
        "force_mode": None,
        "force_raster": False,
        "raster_dpi": None,
        "do_ocr": INHERIT,
        "force_full_page_ocr": INHERIT,
        "do_table_structure": True,
        "table_mode": INHERIT,
        "use_picture_description": INHERIT,
        "do_picture_classification": INHERIT,
        "formula_enrichment": INHERIT,
        "code_enrichment": INHERIT,
        "include_doctags": True,
        "include_markdown": True,
        "use_fitz_layers": INHERIT,
        "generate_picture_images": True,
        "memory_profile": "standard",
    },
    # Selectable-text PDFs, low complexity — avoid heavy OCR + enrichment.
    "fast_native": {
        "force_mode": None,
        "force_raster": False,
        "raster_dpi": None,
        "do_ocr": False,
        "force_full_page_ocr": False,
        "do_table_structure": True,
        "table_mode": "FAST",
        "use_picture_description": False,
        "do_picture_classification": False,
        "formula_enrichment": False,
        "code_enrichment": False,
        "include_doctags": False,
        "include_markdown": False,
        "use_fitz_layers": True,
        "generate_picture_images": True,
        "memory_profile": "fast",
    },
    # Native / mixed PDFs with structured financial/table content.
    "accurate_table": {
        "force_mode": None,
        "force_raster": True,
        "raster_dpi": 144,
        "do_ocr": True,  # fallback OCR, not forced full-page
        "force_full_page_ocr": False,
        "do_table_structure": True,
        "table_mode": "ACCURATE",
        "use_picture_description": False,
        "do_picture_classification": False,
        "formula_enrichment": True,  # capped by global capability
        "code_enrichment": False,  # finance product: off by default
        "include_doctags": True,
        "include_markdown": True,
        "use_fitz_layers": True,
        "generate_picture_images": True,
        "memory_profile": "standard",
    },
    # Image-based / low-selectable-text PDFs.
    "ocr_scanned": {
        "force_mode": None,
        "force_raster": True,
        "raster_dpi": 144,
        "do_ocr": True,
        "force_full_page_ocr": True,  # forced (authoritative, subject to ceiling)
        "do_table_structure": True,
        "table_mode": "ACCURATE",
        "use_picture_description": False,
        "do_picture_classification": False,
        "formula_enrichment": False,
        "code_enrichment": False,
        "include_doctags": True,
        "include_markdown": True,
        "use_fitz_layers": False,
        "generate_picture_images": True,
        "memory_profile": "heavy",
    },
    # Image-heavy, branded, brochure-like, complex-layout PDFs.
    "design_heavy": {
        "force_mode": None,
        "force_raster": True,
        "raster_dpi": 200,
        "do_ocr": True,  # fallback OCR
        "force_full_page_ocr": False,
        "do_table_structure": True,
        "table_mode": "ACCURATE",
        "use_picture_description": True,  # capped by global capability
        "do_picture_classification": True,  # capped by global capability
        "formula_enrichment": True,  # capped by global capability
        "code_enrichment": False,  # no product test justifies code enrichment here
        "include_doctags": True,
        "include_markdown": True,
        "use_fitz_layers": True,
        "generate_picture_images": True,
        "memory_profile": "heavy",
    },
    # Final raster fidelity with minimal semantic processing.
    "pixel_raster_only": {
        "force_mode": "pixel_perfect",
        "force_raster": True,
        "raster_dpi": 200,
        "do_ocr": False,
        "force_full_page_ocr": False,
        "do_table_structure": False,
        "table_mode": "FAST",
        "use_picture_description": False,
        "do_picture_classification": False,
        "formula_enrichment": False,
        "code_enrichment": False,
        "include_doctags": False,
        "include_markdown": False,
        "use_fitz_layers": False,
        "generate_picture_images": False,
        "memory_profile": "raster_only",
    },
}


@dataclass(frozen=True)
class GlobalCapabilities:
    """Process-level capability ceilings + configured defaults (from env).

    A lane can never enable a feature that is globally disabled here.
    """

    ocr: bool = True
    picture_description: bool = True
    picture_classification: bool = True
    formula: bool = True
    code: bool = True
    fitz: bool = True
    force_full_page_ocr_default: bool = True
    default_table_mode: str = "ACCURATE"
    images_scale: float = 2.0
    raster_dpi_default: int = 300


@dataclass(frozen=True)
class ConverterProfile:
    """The complete set of Docling ``PdfPipelineOptions``-affecting fields.

    Used as the converter cache key: two profiles that differ in ANY field must
    not share a converter; identical profiles reuse one. Non-converter policy
    fields (doctags/markdown/fitz/raster/mode) are deliberately excluded so the
    cache stays bounded to the small set of real pipeline variants.
    """

    do_ocr: bool
    force_full_page_ocr: bool
    do_table_structure: bool
    table_mode: str
    use_picture_description: bool
    do_picture_classification: bool
    formula_enrichment: bool
    code_enrichment: bool
    generate_picture_images: bool
    images_scale: float

    def as_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


@dataclass(frozen=True)
class EffectiveLanePolicy:
    """The single normalized effective policy for one request, applied
    identically by every parse path."""

    lane: str
    lane_known: bool
    version: str
    requested_mode: str
    effective_mode: str
    force_mode: Optional[str]
    force_raster: bool
    raster_dpi: Optional[int]
    do_ocr: bool
    force_full_page_ocr: bool
    do_table_structure: bool
    table_mode: str
    use_picture_description: bool
    do_picture_classification: bool
    formula_enrichment: bool
    code_enrichment: bool
    include_doctags: bool
    include_markdown: bool
    use_fitz_layers: bool
    generate_picture_images: bool
    images_scale: float
    memory_profile: str

    def converter_profile(self) -> ConverterProfile:
        return ConverterProfile(
            do_ocr=self.do_ocr,
            force_full_page_ocr=self.force_full_page_ocr,
            do_table_structure=self.do_table_structure,
            table_mode=self.table_mode,
            use_picture_description=self.use_picture_description,
            do_picture_classification=self.do_picture_classification,
            formula_enrichment=self.formula_enrichment,
            code_enrichment=self.code_enrichment,
            generate_picture_images=self.generate_picture_images,
            images_scale=self.images_scale,
        )

    def resolve_raster_dpi(self, request_dpi: Optional[int], process_default: Optional[int]) -> int:
        """Effective raster DPI: explicit request → lane floor → process default →
        mode fallback, with the lane's DPI enforced as a *minimum* so a weaker
        dispatcher default can never override a stronger lane policy.

        NOTE ON `process_default` (`DOCLING_RASTER_DPI`): it is a FALLBACK, not a
        floor, and deliberately so — `test_raster_dpi_floor` pins that
        `resolve_raster_dpi(220, 300) == 220`. The caller knows the output grade
        it needs; a site-wide default must not silently promote every alignment
        underlay to 300 DPI and quadruple the render cost of work that is thrown
        away after layout.

        The consequence is that `DOCLING_RASTER_DPI` has no effect whenever the
        caller passes an explicit value, which the dispatcher always does. That
        is intended: **the DPI decision belongs to the dispatcher**, which is the
        only layer that knows whether a raster is a throwaway underlay or the
        deliverable. See `requestedRasterDpi()` in pdf-parse-dispatch.
        """
        mode_fallback = 200 if "pixel" in (self.effective_mode or "") else 144
        candidates = [request_dpi, self.raster_dpi, process_default, mode_fallback]
        chosen = next((int(c) for c in candidates if c), mode_fallback)
        if self.raster_dpi:
            chosen = max(chosen, int(self.raster_dpi))
        return chosen

    def as_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


def normalize_lane(lane: Optional[str]) -> tuple[str, bool]:
    """Return ``(normalized_lane, known)``. Hyphens/underscores + case are
    normalized; an unknown lane falls back to ``unplanned`` with ``known=False``
    so the caller can emit a structured warning."""
    normalized = (lane or "unplanned").strip().lower().replace("-", "_")
    if normalized in LANE_PROFILES:
        return normalized, True
    return "unplanned", False


def normalize_mode(mode: Optional[str]) -> str:
    return (mode or "semantic").strip().lower().replace("-", "_")


def normalize_table_mode(mode: Optional[str], default: str = "ACCURATE") -> str:
    requested = (mode or default or "ACCURATE").strip().upper()
    if requested in {"ACCURATE", "PRECISE", "HIGH"}:
        return "ACCURATE"
    if requested in {"FAST", "QUICK"}:
        return "FAST"
    return "ACCURATE"


def _resolve_field(raw: Any, inherited_default: Any) -> Any:
    return inherited_default if raw is INHERIT else raw


def resolve_execution_policy(
    lane: Optional[str],
    requested_mode: Optional[str],
    request_overrides: Optional[dict[str, Any]] = None,
    capabilities: Optional[GlobalCapabilities] = None,
) -> EffectiveLanePolicy:
    """Resolve one request's effective policy. Pure — never mutates
    ``LANE_PROFILES`` or its inputs."""
    caps = capabilities or GlobalCapabilities()
    overrides = request_overrides or {}
    norm_lane, known = normalize_lane(lane)

    # Merge unplanned base with the selected lane (a fresh dict each call).
    profile: dict[str, Any] = dict(LANE_PROFILES["unplanned"])
    profile.update(LANE_PROFILES.get(norm_lane, {}))

    inherit_defaults = {
        "do_ocr": caps.ocr,
        "force_full_page_ocr": caps.force_full_page_ocr_default,
        "table_mode": caps.default_table_mode,
        "use_picture_description": caps.picture_description,
        "do_picture_classification": caps.picture_classification,
        "formula_enrichment": caps.formula,
        "code_enrichment": caps.code,
        "use_fitz_layers": caps.fitz,
    }

    def field(name: str) -> Any:
        return _resolve_field(profile.get(name), inherit_defaults.get(name))

    # Gated features: intent AND global ceiling.
    def gated(name: str) -> bool:
        cap_attr = GATED_FIELD_CAPABILITY[name]
        return bool(field(name)) and bool(getattr(caps, cap_attr))

    do_ocr = gated("do_ocr")
    # Forced full-page OCR is authoritative for its lane, but cannot exceed the
    # OCR ceiling (no OCR at all -> no forced full-page OCR).
    force_full_page_ocr = bool(field("force_full_page_ocr")) and do_ocr

    use_picture_description = gated("use_picture_description")
    do_picture_classification = gated("do_picture_classification")
    formula_enrichment = gated("formula_enrichment")
    code_enrichment = gated("code_enrichment")
    use_fitz_layers = gated("use_fitz_layers")

    do_table_structure = bool(field("do_table_structure"))
    table_mode = normalize_table_mode(field("table_mode"), caps.default_table_mode)
    generate_picture_images = bool(field("generate_picture_images"))
    include_doctags = bool(field("include_doctags"))
    include_markdown = bool(field("include_markdown"))

    # --- Request overrides: DISABLE-ONLY. A request can turn an allowed feature
    # off, but can never enable a feature the lane (or the global ceiling)
    # forbids. Forced requirements are not overridable.
    if "enable_picture_description" in overrides and overrides["enable_picture_description"] is not None:
        use_picture_description = use_picture_description and bool(overrides["enable_picture_description"])
    if "include_doctags" in overrides and overrides["include_doctags"] is not None:
        include_doctags = include_doctags and bool(overrides["include_doctags"])
    if "include_markdown" in overrides and overrides["include_markdown"] is not None:
        include_markdown = include_markdown and bool(overrides["include_markdown"])

    # Effective mode.
    req_mode = normalize_mode(requested_mode)
    force_mode = profile.get("force_mode")
    if force_mode:
        effective_mode = normalize_mode(str(force_mode))
    elif bool(profile.get("force_raster")) and req_mode == "semantic":
        effective_mode = "hybrid"
    else:
        effective_mode = req_mode

    raster_dpi = profile.get("raster_dpi")

    return EffectiveLanePolicy(
        lane=norm_lane,
        lane_known=known,
        version=LANE_ENFORCEMENT_VERSION,
        requested_mode=req_mode,
        effective_mode=effective_mode,
        force_mode=(str(force_mode).lower().replace("-", "_") if force_mode else None),
        force_raster=bool(profile.get("force_raster")),
        raster_dpi=(int(raster_dpi) if raster_dpi else None),
        do_ocr=do_ocr,
        force_full_page_ocr=force_full_page_ocr,
        do_table_structure=do_table_structure,
        table_mode=table_mode,
        use_picture_description=use_picture_description,
        do_picture_classification=do_picture_classification,
        formula_enrichment=formula_enrichment,
        code_enrichment=code_enrichment,
        include_doctags=include_doctags,
        include_markdown=include_markdown,
        use_fitz_layers=use_fitz_layers,
        generate_picture_images=generate_picture_images,
        images_scale=caps.images_scale,
        memory_profile=str(profile.get("memory_profile") or "standard"),
    )


def describe_lane_defaults(capabilities: Optional[GlobalCapabilities] = None) -> dict[str, dict[str, Any]]:
    """Resolve each known lane's default effective policy (semantic mode, no
    request overrides) for the ``/capabilities`` endpoint."""
    caps = capabilities or GlobalCapabilities()
    out: dict[str, dict[str, Any]] = {}
    for lane in KNOWN_LANES:
        policy = resolve_execution_policy(lane, "semantic", None, caps)
        data = policy.as_dict()
        data.pop("lane_known", None)
        out[lane] = data
    return out

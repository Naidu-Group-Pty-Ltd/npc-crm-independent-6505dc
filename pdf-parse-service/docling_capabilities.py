"""docling-vnext-capabilities-v1 — capability registry (E2).

Replaces warning-driven `_safe_set` capability guessing with a structured
registry that distinguishes FOUR truth levels (apiPresent / configured /
modelConfigured / modelReady / effective). `introspect_installed()` inspects the
INSTALLED package's public option models (Pydantic `model_fields`) — it is the
authority, not online docs. Import-safe: with docling absent every probe is
False and the report is honest (nothing is claimed effective).

A feature is `effective` only when: apiPresent ∧ configured (build ceiling) ∧
modelReady. `chart_extraction=true` is never reported when no chart model loads;
`formula_capable=true` is never reported when the field exists but the model
cannot be built.
"""

from __future__ import annotations

import platform
from typing import Any, Optional

from docling_runtime_protocol import (
    DOCLING_VNEXT_CAPABILITIES_VERSION,
    RuntimeCapabilityReport,
    RuntimeFeatureCapability,
)
from docling_vnext_profiles import VNextBuildOptions

# Feature → extras needed to install its backend, and the build-option flag that
# expresses configured intent. `probe_key` names the introspection signal.
FEATURE_SPECS: dict[str, dict[str, Any]] = {
    "ocr_easyocr": {"extras": ("easyocr",), "option": "allow_ocr"},
    "ocr_rapidocr": {"extras": ("rapidocr",), "option": "allow_ocr"},
    "force_full_page_ocr": {"extras": ("easyocr",), "option": "allow_ocr"},
    "table_structure": {"extras": (), "option": "allow_table_structure"},
    "table_accurate_mode": {"extras": (), "option": "allow_table_structure"},
    "table_cell_matching": {"extras": (), "option": "allow_table_structure"},
    "picture_image_generation": {"extras": (), "option": None},
    "table_image_generation": {"extras": (), "option": None},
    "page_image_generation": {"extras": (), "option": None},
    "picture_classification": {"extras": (), "option": "allow_picture_classification"},
    "picture_description": {"extras": ("vlm",), "option": "allow_picture_description"},
    "chart_extraction": {"extras": ("vlm",), "option": "allow_chart_extraction"},
    "chart_to_csv": {"extras": ("vlm",), "option": "allow_chart_to_csv"},
    "chart_to_code": {"extras": ("vlm",), "option": "allow_chart_to_code"},
    "chart_to_summary": {"extras": ("vlm",), "option": "allow_chart_to_summary"},
    "formula_enrichment": {"extras": (), "option": "allow_formula_enrichment"},
    "code_enrichment": {"extras": (), "option": "allow_code_enrichment"},
    "threaded_standard_pipeline": {"extras": (), "option": "allow_threaded_pipeline"},
    "vlm_pipeline_local": {"extras": ("vlm",), "option": "allow_vlm"},
    "backend_text": {"extras": (), "option": None},
}


def introspect_installed() -> dict[str, Any]:
    """Probe the INSTALLED docling package. Returns {feature: apiPresent} plus
    package_versions/device/pipeline_families. All False + a problem when docling
    is not importable (planning/CI environments)."""
    out: dict[str, Any] = {
        "docling_importable": False,
        "package_versions": {},
        "api_present": {name: False for name in FEATURE_SPECS},
        "pipeline_families": {"standard": False, "threaded_standard": False, "vlm": False},
        "device": "cpu",
        "cuda": False,
        "problems": [],
    }
    try:
        from importlib.metadata import version as _pkg_version
    except Exception:  # pragma: no cover
        out["problems"].append("importlib_metadata_unavailable")
        return out

    for pkg in ("docling", "docling-core", "docling-ibm-models", "docling-parse",
                "pypdfium2", "pymupdf", "torch", "transformers", "easyocr"):
        try:
            out["package_versions"][pkg] = _pkg_version(pkg)
        except Exception:
            pass

    try:
        # Standard PDF pipeline option surface (torch-backed; absent in planning env).
        from docling.datamodel.pipeline_options import PdfPipelineOptions  # type: ignore
        out["docling_importable"] = True
        fields = set(getattr(PdfPipelineOptions, "model_fields", {}).keys())
        present = out["api_present"]
        present["ocr_easyocr"] = "do_ocr" in fields
        present["force_full_page_ocr"] = "force_full_page_ocr" in fields
        present["table_structure"] = "do_table_structure" in fields
        present["table_accurate_mode"] = "table_structure_options" in fields
        present["table_cell_matching"] = "table_structure_options" in fields
        present["picture_classification"] = "do_picture_classification" in fields
        present["picture_description"] = "do_picture_description" in fields
        present["formula_enrichment"] = "do_formula_enrichment" in fields
        present["code_enrichment"] = "do_code_enrichment" in fields
        present["picture_image_generation"] = "generate_picture_images" in fields
        present["page_image_generation"] = "generate_page_images" in fields
        present["table_image_generation"] = "generate_table_images" in fields
        present["backend_text"] = "force_backend_text" in fields
        # Chart extraction option model (may live in a submodule / newer field).
        present["chart_extraction"] = any(
            "chart" in f.lower() for f in fields
        ) or _module_has("docling.datamodel.pipeline_options", ("ChartExtractionModelOptions",))
        for k in ("chart_to_csv", "chart_to_code", "chart_to_summary"):
            present[k] = present["chart_extraction"]
        out["pipeline_families"]["standard"] = True
        out["pipeline_families"]["threaded_standard"] = _module_has(
            "docling.pipeline.threaded_standard_pdf_pipeline", ("ThreadedStandardPdfPipeline",)
        )
        present["threaded_standard_pipeline"] = out["pipeline_families"]["threaded_standard"]
        out["pipeline_families"]["vlm"] = _module_has("docling.pipeline.vlm_pipeline", ("VlmPipeline",))
        present["vlm_pipeline_local"] = out["pipeline_families"]["vlm"]
        present["ocr_rapidocr"] = _module_has("docling.models.rapid_ocr_model", ("RapidOcrModel",))
        # Device.
        try:
            import torch  # type: ignore
            out["cuda"] = bool(torch.cuda.is_available())
            out["device"] = "cuda" if out["cuda"] else "cpu"
        except Exception:
            out["device"] = "cpu"
    except Exception as exc:
        out["problems"].append(f"docling_option_import_failed:{type(exc).__name__}")

    return out


def _module_has(module: str, names: tuple[str, ...]) -> bool:
    try:
        import importlib
        mod = importlib.import_module(module)
        return all(hasattr(mod, n) for n in names)
    except Exception:
        return False


def build_capability_report(
    runtime_profile: str,
    options: Optional[VNextBuildOptions] = None,
    probe: Optional[dict] = None,
    model_ready: Optional[dict[str, bool]] = None,
) -> RuntimeCapabilityReport:
    """Assemble the structured report. `model_ready` (from a real minimal-inference
    probe at build/CI time) gates `effective`; when unknown, `modelReady=False`
    so nothing is over-claimed."""
    opts = options or VNextBuildOptions()
    probe = probe if probe is not None else introspect_installed()
    api_present = probe.get("api_present", {})
    model_ready = model_ready or {}

    features: dict[str, RuntimeFeatureCapability] = {}
    for name, spec in FEATURE_SPECS.items():
        api = bool(api_present.get(name, False))
        option = spec.get("option")
        configured = getattr(opts, option) if isinstance(option, str) and hasattr(opts, option) else (option is None and api)
        mready = bool(model_ready.get(name, False))
        problems: list[str] = []
        if configured and not api:
            problems.append("configured_but_api_absent")
        if configured and api and not mready:
            problems.append("model_not_verified_ready")
        effective = api and bool(configured) and mready
        features[name] = RuntimeFeatureCapability(
            name=name,
            apiPresent=api,
            configured=bool(configured),
            modelConfigured=bool(configured) and api,
            modelReady=mready,
            effective=effective,
            requiredExtras=tuple(spec.get("extras", ())),
            problems=tuple(problems),
        )

    # Hard security features — always disclosed as off unless explicitly built on.
    features["remote_vlm"] = RuntimeFeatureCapability(
        name="remote_vlm", apiPresent=True, configured=opts.enable_remote_services,
        effective=opts.enable_remote_services,
    )
    features["cuda"] = RuntimeFeatureCapability(
        name="cuda", apiPresent=True, configured=False,
        modelReady=bool(probe.get("cuda")), effective=bool(probe.get("cuda")),
    )

    report_problems = tuple(probe.get("problems", ()))
    return RuntimeCapabilityReport(
        version=DOCLING_VNEXT_CAPABILITIES_VERSION,
        runtime_profile=runtime_profile,
        package_versions=probe.get("package_versions", {}),
        python_version=platform.python_version(),
        pipeline_families=probe.get("pipeline_families", {}),
        features=features,
        models={},
        build_profile=opts.build_profile,
        device=probe.get("device", "cpu"),
        problems=report_problems,
    )

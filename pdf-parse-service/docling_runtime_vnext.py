"""docling vNext runtime (E2). Implements DoclingRuntime for Docling 2.113+.

Import-safe: docling is imported LAZILY inside methods, so this module (and the
capability/profile logic) imports in CI without torch/docling. A vNext response
always discloses that the vNext runtime executed; a failed vNext initialisation
RAISES — it never silently runs legacy while reporting vNext.
"""

from __future__ import annotations

from typing import Any, Optional

from docling_runtime_protocol import (
    DOCLING_VNEXT_ADAPTER_VERSION,
    RuntimeCapabilityReport,
    RuntimeConversionResult,
)
from docling_vnext_profiles import VNextBuildOptions, VNextConverterProfile, converter_key
from docling_capabilities import build_capability_report, introspect_installed
from docling_vnext_adapter import (
    DOCLING_VNEXT_ADAPTER_VERSION as ADAPTER_VERSION,
    normalize_conversion_status,
    normalize_document,
)


class DoclingVNextRuntime:
    profile_version = DOCLING_VNEXT_ADAPTER_VERSION

    def __init__(self, options: Optional[VNextBuildOptions] = None, *, docling_version: Optional[str] = None):
        self.options = options or VNextBuildOptions()
        self._docling_version = docling_version
        self._converters: dict[str, Any] = {}
        self._last_applied: dict = {}
        self._probe = introspect_installed()

    def profile_name(self) -> str:
        return "vnext"

    def package_versions(self) -> dict[str, str]:
        return dict(self._probe.get("package_versions", {}))

    def capabilities(self) -> RuntimeCapabilityReport:
        return build_capability_report("vnext", self.options, probe=self._probe)

    def require_docling(self) -> None:
        """Fail loudly if docling is not importable — never fall back to legacy."""
        if not self._probe.get("docling_importable"):
            raise RuntimeError(
                "vnext runtime selected but docling pipeline options are not importable; "
                "refusing to fall back to legacy (would misreport the engine that ran)."
            )

    def build_converter(self, profile: VNextConverterProfile) -> Any:
        """Construct (and cache) a DocumentConverter for this profile. Caching is
        keyed by `converter_key(profile)` so any converter-affecting field change
        yields a distinct converter."""
        self.require_docling()
        key = converter_key(profile)
        if key in self._converters:
            return self._converters[key]
        converter, self._last_applied = self._construct_converter(profile)
        self._converters[key] = converter
        return converter

    def build_pipeline_options(self, profile: VNextConverterProfile) -> tuple[Any, dict]:
        """Apply every profile field to a real `PdfPipelineOptions` against the
        INSTALLED docling API, returning `(options, applied_report)`. The report
        records per field: applied | unsupported | disabled — so a configured field
        that cannot be applied is visible (not silently dropped). Requires docling."""
        self.require_docling()
        from docling.datamodel.pipeline_options import (
            PdfPipelineOptions, TableFormerMode, AcceleratorOptions, AcceleratorDevice,
        )
        opts = PdfPipelineOptions()
        applied: dict[str, str] = {}

        def apply(field: str, value: Any) -> None:
            applied[field] = "applied" if _safe_public_set(opts, field, value) else "unsupported"

        apply("do_ocr", profile.do_ocr)
        apply("do_table_structure", profile.do_table_structure)
        apply("do_picture_classification", profile.do_picture_classification)
        apply("do_picture_description", profile.do_picture_description)
        apply("do_formula_enrichment", profile.do_formula_enrichment)
        apply("do_code_enrichment", profile.do_code_enrichment)
        apply("do_chart_extraction", profile.do_chart_extraction)
        apply("generate_page_images", profile.generate_page_images)
        apply("generate_picture_images", profile.generate_picture_images)
        apply("generate_table_images", profile.generate_table_images)
        apply("generate_parsed_pages", profile.generate_parsed_pages)
        apply("images_scale", profile.images_scale)
        apply("force_backend_text", profile.force_backend_text)
        # Security invariants — always forced off, regardless of profile.
        applied["enable_remote_services"] = "applied" if _safe_public_set(opts, "enable_remote_services", False) else "unsupported"
        applied["allow_external_plugins"] = "applied" if _safe_public_set(opts, "allow_external_plugins", False) else "unsupported"
        if profile.document_timeout:
            apply("document_timeout", profile.document_timeout)
        # Threaded batch/queue knobs (present on 2.113 PdfPipelineOptions).
        apply("layout_batch_size", profile.layout_batch_size)
        apply("ocr_batch_size", profile.ocr_batch_size)
        apply("table_batch_size", profile.table_batch_size)
        apply("queue_max_size", profile.queue_max_size)
        apply("batch_polling_interval_seconds", profile.batch_polling_interval)

        # Accelerator (device + threads) — a nested public model.
        try:
            device = {
                "cpu": AcceleratorDevice.CPU, "cuda": AcceleratorDevice.CUDA,
                "auto": AcceleratorDevice.AUTO,
            }.get(profile.device, AcceleratorDevice.CPU)
            opts.accelerator_options = AcceleratorOptions(device=device, num_threads=profile.num_threads)
            applied["accelerator_options"] = "applied"
        except Exception:
            applied["accelerator_options"] = "unsupported"

        # OCR engine + force-full-page live on the OCR options object (NOT top-level).
        if profile.do_ocr:
            try:
                from docling.datamodel.pipeline_options import EasyOcrOptions
                ocr = EasyOcrOptions()
                _safe_public_set(ocr, "force_full_page_ocr", profile.force_full_page_ocr)
                _safe_public_set(ocr, "lang", list(profile.ocr_languages))
                opts.ocr_options = ocr
                applied["ocr_options.force_full_page_ocr"] = "applied"
            except Exception:
                applied["ocr_options.force_full_page_ocr"] = "unsupported"
        else:
            applied["ocr_options.force_full_page_ocr"] = "disabled"

        # Table mode + cell matching.
        table_opts = getattr(opts, "table_structure_options", None)
        if table_opts is not None:
            mode = TableFormerMode.ACCURATE if profile.table_mode == "accurate" else TableFormerMode.FAST
            applied["table_structure_options.mode"] = "applied" if _safe_public_set(table_opts, "mode", mode) else "unsupported"
            applied["table_structure_options.do_cell_matching"] = "applied" if _safe_public_set(table_opts, "do_cell_matching", profile.table_cell_matching) else "unsupported"

        # Chart extraction outputs live on the chart options object.
        if profile.do_chart_extraction:
            chart_opts = getattr(opts, "chart_extraction_options", None)
            if chart_opts is not None:
                _safe_public_set(chart_opts, "chart2csv", profile.chart_to_csv)
                _safe_public_set(chart_opts, "chart2code", profile.chart_to_code)
                _safe_public_set(chart_opts, "chart2summary", profile.chart_to_summary)
                applied["chart_extraction_options"] = "applied"
            else:
                applied["chart_extraction_options"] = "unsupported"
        else:
            applied["chart_extraction_options"] = "disabled"

        return opts, applied

    def _construct_converter(self, profile: VNextConverterProfile) -> tuple[Any, dict]:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.base_models import InputFormat

        opts, applied = self.build_pipeline_options(profile)
        fmt_kwargs: dict[str, Any] = {"pipeline_options": opts}
        # Pipeline family selects the actual pipeline class (standard is default).
        if profile.pipeline_family == "threaded_standard":
            try:
                from docling.pipeline.threaded_standard_pdf_pipeline import ThreadedStandardPdfPipeline
                fmt_kwargs["pipeline_cls"] = ThreadedStandardPdfPipeline
                applied["pipeline_family"] = "threaded_standard"
            except Exception:
                applied["pipeline_family"] = "standard_fallback_threaded_unavailable"
        elif profile.pipeline_family == "vlm":
            try:
                from docling.pipeline.vlm_pipeline import VlmPipeline
                fmt_kwargs["pipeline_cls"] = VlmPipeline
                applied["pipeline_family"] = "vlm"
            except Exception:
                applied["pipeline_family"] = "standard_fallback_vlm_unavailable"
        else:
            applied["pipeline_family"] = "standard"
        converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(**fmt_kwargs)})
        return converter, applied

    def convert(self, source: Any, profile: VNextConverterProfile,
                page_range: Optional[tuple[int, int]] = None) -> RuntimeConversionResult:
        """THE vNext conversion entry point. Every vNext parse path routes here so
        the executing engine is unambiguously vNext. Requires docling."""
        self.require_docling()
        converter = self.build_converter(profile)
        try:
            kwargs: dict[str, Any] = {}
            if page_range:
                kwargs["page_range"] = page_range
            result = converter.convert(source, **kwargs)
        except Exception as exc:
            return RuntimeConversionResult(
                status="failure", document=None, pages_processed=0, pages_failed=0,
                errors=(f"{type(exc).__name__}: {str(exc)[:200]}",),
                engine_identity=self.engine_identity(profile),
            )
        raw_doc = getattr(result, "document", result)
        doc = self.export_document(result)
        pages_total = len(doc.get("pages") or {})
        errors = [str(e)[:200] for e in (getattr(result, "errors", None) or [])]
        status = normalize_conversion_status(getattr(getattr(result, "status", None), "name", getattr(result, "status", None)),
                                             pages_total=pages_total, pages_failed=len(errors))
        return RuntimeConversionResult(
            status=status, document=doc, pages_processed=pages_total, pages_failed=len(errors),
            errors=tuple(errors), engine_identity=self.engine_identity(profile), raw_document=raw_doc,
        )

    def export_document(self, result: Any) -> dict:
        doc = getattr(result, "document", result)
        if hasattr(doc, "export_to_dict"):
            raw = doc.export_to_dict()
        elif hasattr(doc, "model_dump"):
            raw = doc.model_dump(mode="json")
        else:
            raw = dict(doc)
        return normalize_document(raw)

    def engine_identity(self, profile: VNextConverterProfile) -> dict:
        versions = self.package_versions()
        return {
            "runtime_profile": "vnext",
            "adapter_version": ADAPTER_VERSION,
            "docling_version": versions.get("docling") or self._docling_version,
            "pipeline_family": profile.pipeline_family,
            "ocr_engine": profile.ocr_engine if profile.do_ocr else None,
            "table_mode": profile.table_mode,
            "table_cell_matching": profile.table_cell_matching,
            "chart_extraction": profile.do_chart_extraction,
            "device": profile.device,
            "converter_key": converter_key(profile),
            "build_profile": self.options.build_profile,
            "applied_fields": dict(self._last_applied),
        }


def _safe_public_set(obj: Any, attr: str, value: Any) -> bool:
    """Set an attribute only when the PUBLIC field exists (Pydantic model_fields /
    attribute). Never touches private/underscore internals."""
    try:
        fields = getattr(type(obj), "model_fields", None)
        if fields is not None and attr not in fields and not hasattr(obj, attr):
            return False
        if fields is None and not hasattr(obj, attr):
            return False
        setattr(obj, attr, value)
        return True
    except Exception:
        return False

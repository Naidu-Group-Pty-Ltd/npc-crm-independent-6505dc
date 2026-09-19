"""
pdf-parse-service — Docling sidecar for the template PDF import pipeline.

Endpoints
---------
GET  /healthz                      — liveness/readiness probe.
POST /parse   { url | pdf_base64 } — returns Docling DoclingDocument JSON + per-page metadata.
POST /raster  { url | pdf_base64, dpi, pages? } — rasterises pages to base64 PNG/JPEG for Hybrid/Pixel-Perfect modes.

Auth
----
Every request must carry `Authorization: Bearer $PDF_PARSE_SERVICE_TOKEN`.

Phase D additions
-----------------
* Formula + code enrichment toggles (LaTeX / code-language detection).
* Picture-image extraction at images_scale=2.0 so embedded crops are sharp.
* Optional EasyOCR fallback (heavy) gated by ENABLE_OCR_FALLBACK.
* DocTags + Markdown serialisations returned alongside the JSON doc.
* Document outline (TOC), cross-references, and per-page language exposed.
* Layout-model override via LAYOUT_MODEL env (best-effort across Docling versions).

Wave F-Option-3 (callback / async) additions
--------------------------------------------
When `/parse` receives `callback_url` + `callback_token` + `job_id`, the sidecar
runs parse (and optional rasterise) as a BackgroundTask, uploads artifacts
directly to the Supabase `pdf-import-diagnostics` bucket via the Storage REST
API, and POSTs the completion payload to `callback_url`. The HTTP response to
`/parse` returns immediately with 202 so the edge dispatcher's wall-clock
budget is freed.

Required additional env for callback uploads:
    SUPABASE_URL                       Base URL for the Supabase REST API.
    SUPABASE_SERVICE_ROLE_KEY          Service role key (storage upload auth).
    PDF_DIAGNOSTICS_BUCKET             Defaults to "pdf-import-diagnostics".
"""

from __future__ import annotations

import base64
import hashlib
import io
import importlib.metadata as importlib_metadata
import json
import logging
import os
import re
import time
import uuid
from contextvars import ContextVar
from typing import Any, Optional

import httpx
import pypdfium2 as pdfium

try:
    import fitz  # PyMuPDF (AGPL-3.0) — see NOTICE.md. Phase 2 vector + typography pass.
    _FITZ_AVAILABLE = True
except Exception:  # pragma: no cover - extraction degrades gracefully without fitz
    fitz = None  # type: ignore
    _FITZ_AVAILABLE = False

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
from docling.document_converter import DocumentConverter, PdfFormatOption

# G1 — Lane Policy V2 (pure, Docling-free; unit-tested in test_lane_policy.py).
from lane_policy import (
    LANE_ENFORCEMENT_VERSION,
    LANE_PROFILES,
    GlobalCapabilities,
    ConverterProfile,
    EffectiveLanePolicy,
    resolve_execution_policy,
    describe_lane_defaults,
    normalize_lane,
)

# OCR language contract (pure; unit-tested in test_ocr_config.py without Docling).
from ocr_languages import (
    OCR_LANGUAGE_CONTRACT_VERSION,
    resolve_ocr_languages,
)

# G2 — Sidecar Operational Metrics V1 (pure; unit-tested in test_operational_metrics.py).
from operational_metrics import (
    OperationalMetricsAccumulator,
    operational_metrics_capabilities,
    SIDECAR_OPERATIONAL_METRICS_VERSION,
    NOT_APPLICABLE as METRICS_NOT_APPLICABLE,
)
# E1 — source-scene-graph-v2 pure producer (no Docling model init on import).
import source_scene_graph as ssg
# E4 — table candidate arbitration + preservation (pure; no Docling init on import).
import table_candidates as tcand
import table_integrity as tinteg
# E5 — source typography evidence + font assets (pure; no Docling init on import).
import source_typography as stypo
import font_assets as fassets
from source_url_security import UnsafeSourceUrl, fetch_public_url
# Text alignment inference (pure; gated by ci.yml — see the module header for
# what shipped wrong while it lived in this file).
from text_alignment import MIN_JUSTIFY_LINES, infer_alignment  # noqa: F401
# Font cmap repair (pure; gated by ci.yml). The file surgery below uses
# fontTools; everything that decides WHAT to write lives in that module.
from font_cmap_repair import (  # noqa: F401
    coverage_ranges,
    parse_tounicode_cmap,
    plan_cmap_repair,
)

REQUEST_ID: ContextVar[str] = ContextVar("request_id", default="-")


class JsonRequestFormatter(logging.Formatter):
    """Emit one JSON object per log line so Cloud Run can index request fields."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "severity": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", REQUEST_ID.get()),
        }
        for key in ("method", "path", "status_code", "duration_ms", "error_code", "retryable"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


handler = logging.StreamHandler()
handler.setFormatter(JsonRequestFormatter())
logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
LOG = logging.getLogger("pdf-parse-service")

SERVICE_TOKEN = os.environ.get("PDF_PARSE_SERVICE_TOKEN", "").strip()
SERVICE_TOKEN_NEXT = os.environ.get("PDF_PARSE_SERVICE_TOKEN_NEXT", "").strip()
SERVICE_TOKENS = {t for t in (SERVICE_TOKEN, SERVICE_TOKEN_NEXT) if t}
# `align-v2` is a SEMANTIC change to a field that already existed: `text_align`
# no longer reports justify for a two-line block. A cached artifact carries the
# old meaning under the same key, so the version has to move or the cache serves
# it. See _infer_alignment / MIN_JUSTIFY_LINES.
ENGINE_VERSION = "docling-2.14.0+phaseD+waveD+option3+waveG-chunked+phase1-plan-router+phase3-raster-manifest+phase4j-capability-activation+phase2-fitz-vectors-typography+phase3-fonts+phase6e-stroke-style+subset-fonts-v1+source-measure-v2+coverage-ranges-v1+align-v2+cmap-repair-v1+font-metrics-v1"
DOCLING_CAPABILITY_ACTIVATION_VERSION = "docling-capability-activation-v1"
MAX_PDF_BYTES = int(os.environ.get("DOCLING_MAX_PDF_MB", "50")) * 1024 * 1024
# Each page currently produces seven objects plus one job manifest.  Bound the
# page namespace as well as the input bytes so small, high-page-count PDFs
# cannot amplify into an unbounded number of service-role Storage writes.
MAX_PER_PAGE_ARTIFACT_PAGES = int(os.environ.get("DOCLING_MAX_PER_PAGE_ARTIFACT_PAGES", "500"))
# Phase 3 raster artifact config.
RASTER_ARTIFACT_MODE = os.environ.get("DOCLING_RASTER_ARTIFACT_MODE", "manifest").lower()
WRITE_LEGACY_RASTERS_JSON = os.environ.get("DOCLING_WRITE_LEGACY_RASTERS_JSON", "false").lower() == "true"
RASTER_FORMAT = os.environ.get("DOCLING_RASTER_FORMAT", "png").lower()
# E1 — Source Scene Graph V2. Additive to V2 artifacts; disabled → the pipeline is
# byte-identical to pre-E1. Critical-region crops render at their own high DPI so
# the full-page raster keeps its current DPI.
ENABLE_SOURCE_SCENE_GRAPH = os.environ.get("DOCLING_ENABLE_SOURCE_SCENE_GRAPH", "true").lower() == "true"
SOURCE_SCENE_CROP_DPI = int(os.environ.get("DOCLING_SOURCE_SCENE_CROP_DPI", "300"))
# Phase 2: raise the default reference-raster DPI for a crisper builder underlay.
# (Cloud Run memory/time scales with DPI^2 — override down if cold-starts regress.)
RASTER_DPI = int(os.environ.get("DOCLING_RASTER_DPI", "300"))
# Phase 2: PyMuPDF vector/typography extraction toggles. (_env_bool is defined
# below; keep this check self-contained so module import order doesn't matter.)
ENABLE_FITZ_LAYERS = os.environ.get("DOCLING_ENABLE_FITZ_LAYERS", "true").strip().lower() not in {"", "0", "false", "no"}
MAX_VECTORS_PER_PAGE = int(os.environ.get("DOCLING_MAX_VECTORS_PER_PAGE", "400"))
# Per-span extents shipped per text line, so the client can reconcile a
# mixed-style line rather than collapse it to its widest span. Bounded because
# the count is attacker-influenced and this rides on every text item.
MAX_SPANS_PER_LINE = int(os.environ.get("DOCLING_MAX_SPANS_PER_LINE", "24"))
# Measured line records shipped per text item, for the same reason.
MAX_MEASURED_LINES = int(os.environ.get("DOCLING_MAX_MEASURED_LINES", "64"))
# Bumped when the shape of `item.source_measure` changes, so a consumer can tell
# a missing measurement from one it does not understand.
#
# v2 adds per-line `x0Pt` / `x1Pt` / `baselineYPt`. Additive — a v1 consumer
# ignores them — but a v2 consumer needs to know it is looking at v1 and must
# fall back rather than treat absent geometry as geometry at the origin.
SOURCE_MEASURE_VERSION = "source-measure-v2"
MIN_VECTOR_SIZE_PT = float(os.environ.get("DOCLING_MIN_VECTOR_SIZE_PT", "1.0"))
# Phase 3: font metadata extraction (names + embeddable programs).
MAX_FONTS = int(os.environ.get("DOCLING_MAX_FONTS", "48"))
MAX_FONT_BYTES = int(os.environ.get("DOCLING_MAX_FONT_BYTES", str(512 * 1024)))
MAX_EMBEDDED_FONT_BYTES = int(os.environ.get("DOCLING_MAX_EMBEDDED_FONT_BYTES", str(4 * 1024 * 1024)))
# CSS unicode-range segments per embedded face. Dropping a segment only sends
# those glyphs to the stack fallback — safe direction — so the cap keeps the
# LARGEST segments rather than refusing to scope at all.
MAX_COVERAGE_RANGES = int(os.environ.get("DOCLING_MAX_COVERAGE_RANGES", "64"))

# Wave F-Option-3 storage upload config.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
DIAGNOSTICS_BUCKET = os.environ.get("PDF_DIAGNOSTICS_BUCKET", "pdf-import-diagnostics").strip()


class SidecarError(Exception):
    def __init__(self, status_code: int, error_code: str, message: str, *, retryable: bool = False):
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        self.retryable = retryable
        super().__init__(message)


def _enforce_per_page_artifact_quota(page_numbers: list[int]) -> None:
    """Reject a per-job artifact set before serialization or Storage writes."""
    highest_page = max(page_numbers, default=0)
    if len(page_numbers) > MAX_PER_PAGE_ARTIFACT_PAGES or highest_page > MAX_PER_PAGE_ARTIFACT_PAGES:
        raise SidecarError(
            413,
            "per_page_artifact_limit_exceeded",
            f"Per-page artifacts are limited to {MAX_PER_PAGE_ARTIFACT_PAGES} pages per job.",
        )


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip() not in {"", "0", "false", "False", "no", "NO"}


PREWARM_ON_STARTUP = _env_bool("DOCLING_PREWARM_ON_STARTUP", True)


# Phase B/D toggles. Expensive enrichments remain available as explicit opt-ins.
ENABLE_PICTURE_CLASSIFICATION = _env_bool("ENABLE_PICTURE_CLASSIFICATION", True)
ENABLE_PICTURE_DESCRIPTION_DEFAULT = _env_bool("ENABLE_PICTURE_DESCRIPTION", False)
# Formula and code enrichment target scientific papers and source listings. This
# product ingests property and finance PDFs, where both load extra models and
# add per-page work for no measured benefit — so they are opt-in, not opt-out.
ENABLE_FORMULA_ENRICHMENT = _env_bool("ENABLE_FORMULA_ENRICHMENT", False)
ENABLE_CODE_ENRICHMENT = _env_bool("ENABLE_CODE_ENRICHMENT", False)
# OCR fallback and full-page OCR are resource-intensive and must be enabled explicitly.
ENABLE_OCR_FALLBACK = _env_bool("ENABLE_OCR_FALLBACK", False)
FORCE_FULL_PAGE_OCR = _env_bool("DOCLING_FORCE_FULL_PAGE_OCR", False)
# Multi-language OCR. Resolved through the pure `ocr_languages` contract, which
# aliases non-EasyOCR spellings (`zh` -> `ch_sim`), drops unknown codes, and
# reduces incompatible script mixes to a constructible group. Without it an
# unconstructible language list fails the whole conversion rather than degrading
# the OCR pass — see ocr_languages.py.
_OCR_LANG_RESOLUTION = resolve_ocr_languages(os.environ.get("DOCLING_OCR_LANGS"))
OCR_LANGS = list(_OCR_LANG_RESOLUTION.languages)
if _OCR_LANG_RESOLUTION.changed:
    LOG.warning(
        "DOCLING_OCR_LANGS adjusted for EasyOCR compatibility: using %s (group=%s, dropped=%s)",
        OCR_LANGS,
        _OCR_LANG_RESOLUTION.primary_group,
        _OCR_LANG_RESOLUTION.dropped,
    )
# Lower bitmap threshold = OCR runs even on lightly-bitmapped regions.
BITMAP_AREA_THRESHOLD = float(os.environ.get("DOCLING_BITMAP_AREA_THRESHOLD", "0.05"))
# Picture-crop resolution, expressed as a multiplier on 72 DPI: 2.0 == 144 DPI,
# 4.0 == 288 DPI. Docling RE-RENDERS a picture's page region at this scale
# rather than extracting the embedded stream, so this is a hard ceiling on
# embedded-image quality — a 600 DPI photograph in the source was permanently
# resampled to 144 DPI before it ever reached the template, which is a large
# part of the reported pixelation.
#
# Raised to 4.0 (288 DPI, just under the 300 DPI print floor). Cost scales with
# the square, but it applies to picture REGIONS rather than whole pages, and the
# per-page artifact caps still bound the total. Dial back via the env var if a
# picture-dense corpus regresses cold-start memory.
IMAGES_SCALE = float(os.environ.get("DOCLING_IMAGES_SCALE", "4.0"))
TABLE_MODE = os.environ.get("DOCLING_TABLE_MODE", "ACCURATE").strip().upper() or "ACCURATE"
LAYOUT_MODEL = os.environ.get("DOCLING_LAYOUT_MODEL", "").strip() or None
# Accelerator: AUTO lets Docling pick CUDA / MPS / CPU as available.
ACCEL_DEVICE = os.environ.get("DOCLING_ACCEL_DEVICE", "AUTO").strip().upper()
ACCEL_THREADS = int(os.environ.get("DOCLING_ACCEL_THREADS", os.environ.get("OMP_NUM_THREADS", "4")))
# Wave A: markdown serialisation is now ON by default so downstream consumers always get it.
INCLUDE_MARKDOWN_DEFAULT = _env_bool("DOCLING_INCLUDE_MARKDOWN_DEFAULT", True)

# G1 — the process-level capability ceilings + configured defaults handed to the
# pure lane-policy resolver. A lane can never enable a feature disabled here.
GLOBAL_CAPABILITIES = GlobalCapabilities(
    # OCR *availability*. Forcing full-page OCR implies needing OCR at all, so
    # either flag raises the ceiling.
    ocr=(ENABLE_OCR_FALLBACK or FORCE_FULL_PAGE_OCR),
    picture_description=ENABLE_PICTURE_DESCRIPTION_DEFAULT,
    picture_classification=ENABLE_PICTURE_CLASSIFICATION,
    formula=ENABLE_FORMULA_ENRICHMENT,
    code=ENABLE_CODE_ENRICHMENT,
    fitz=(_FITZ_AVAILABLE and ENABLE_FITZ_LAYERS),
    # OCR *forcing* — deliberately NOT `(FORCE_FULL_PAGE_OCR or ENABLE_OCR_FALLBACK)`.
    #
    # These two fields were previously the same expression, which made "OCR is
    # available" and "OCR every page of every document" a single switch. The
    # `unplanned` lane inherits this default, so enabling the fallback silently
    # forced full-page OCR across the largest slice of production traffic — on
    # documents whose measured `ocr_page_ratio` was 0.0.
    #
    # Setting ENABLE_OCR_FALLBACK=false was not a workaround: `ocr` is a hard
    # ceiling (lane_policy rule 4), so that would have left `ocr_scanned` unable
    # to OCR a genuinely scanned document. There was no env-var combination for
    # "OCR available, not forced" — hence the decoupling here.
    #
    # `ocr_scanned` still forces full-page OCR: its lane profile sets
    # force_full_page_ocr=True authoritatively, capped only by the `ocr` ceiling.
    force_full_page_ocr_default=FORCE_FULL_PAGE_OCR,
    default_table_mode=TABLE_MODE,
    images_scale=IMAGES_SCALE,
    raster_dpi_default=RASTER_DPI,
)


def _resolve_policy(lane, mode, *, enable_picture_description=None, include_doctags=None, include_markdown=None) -> EffectiveLanePolicy:
    """Single entry point every parse path uses to resolve the effective policy."""
    return resolve_execution_policy(
        lane,
        mode,
        {
            "enable_picture_description": enable_picture_description,
            "include_doctags": include_doctags,
            "include_markdown": include_markdown,
        },
        GLOBAL_CAPABILITIES,
    )


def _normalize_extractor_lane(lane: Optional[str]) -> str:
    """Backwards-compatible helper: normalized lane string only."""
    return normalize_lane(lane)[0]


app = FastAPI(title="pdf-parse-service", version=ENGINE_VERSION)


# ---------------------------------------------------------------------------
# Pipeline construction
# ---------------------------------------------------------------------------
def _safe_set(options: object, attr: str, value: Any) -> bool:
    """Best-effort setter for Docling pipeline flags that vary across releases."""
    try:
        setattr(options, attr, value)
        return True
    except Exception as exc:  # pragma: no cover
        LOG.warning("docling option %s=%r not supported: %s", attr, value, exc)
        return False


def _resolve_table_former_mode(mode: Optional[str]) -> Any:
    requested = (mode or TABLE_MODE or "ACCURATE").strip().upper()
    if requested in {"ACCURATE", "PRECISE", "HIGH"}:
        return getattr(TableFormerMode, "ACCURATE", TableFormerMode.FAST)
    if requested in {"FAST", "QUICK"}:
        return TableFormerMode.FAST
    LOG.warning("Unknown DOCLING_TABLE_MODE=%s; falling back to ACCURATE", requested)
    return getattr(TableFormerMode, "ACCURATE", TableFormerMode.FAST)


def _build_converter(profile: ConverterProfile) -> tuple[DocumentConverter, dict]:
    """Build a Docling converter for one :class:`ConverterProfile`. Returns the
    converter plus a ``support`` map recording whether each best-effort
    ``_safe_set`` actually took effect (so /capabilities never reports a feature
    active when the Docling build rejected it). G1: every pipeline field is
    driven by the profile — no unconditional ``pipeline.do_ocr = True``."""
    pipeline = PdfPipelineOptions()
    pipeline.do_ocr = bool(profile.do_ocr)
    pipeline.do_table_structure = bool(profile.do_table_structure)
    if profile.do_table_structure:
        pipeline.table_structure_options.mode = _resolve_table_former_mode(profile.table_mode)
        pipeline.table_structure_options.do_cell_matching = True
    pipeline.generate_page_images = False
    pipeline.generate_picture_images = bool(profile.generate_picture_images)
    images_scale_supported = _safe_set(pipeline, "images_scale", profile.images_scale)

    support: dict[str, bool] = {
        "do_ocr": bool(profile.do_ocr),
        "do_table_structure": bool(profile.do_table_structure),
        "generate_picture_images": bool(profile.generate_picture_images),
        "images_scale": images_scale_supported,
        "picture_classification": _safe_set(pipeline, "do_picture_classification", True) if profile.do_picture_classification else False,
        "picture_description": _safe_set(pipeline, "do_picture_description", True) if profile.use_picture_description else False,
        "formula_enrichment": _safe_set(pipeline, "do_formula_enrichment", True) if profile.formula_enrichment else False,
        "code_enrichment": _safe_set(pipeline, "do_code_enrichment", True) if profile.code_enrichment else False,
        "force_full_page_ocr": False,
    }

    if profile.do_ocr:
        ocr_opts = getattr(pipeline, "ocr_options", None)
        if ocr_opts is not None:
            support["force_full_page_ocr"] = _safe_set(ocr_opts, "force_full_page_ocr", bool(profile.force_full_page_ocr))
            if OCR_LANGS:
                _safe_set(ocr_opts, "lang", OCR_LANGS)
            _safe_set(ocr_opts, "bitmap_area_threshold", BITMAP_AREA_THRESHOLD)
        else:
            support["force_full_page_ocr"] = _safe_set(pipeline, "force_full_page_ocr", bool(profile.force_full_page_ocr))

    try:
        from docling.datamodel.pipeline_options import AcceleratorOptions, AcceleratorDevice  # type: ignore
        try:
            device = getattr(AcceleratorDevice, ACCEL_DEVICE, AcceleratorDevice.AUTO)
        except Exception:
            device = AcceleratorDevice.AUTO
        _safe_set(
            pipeline,
            "accelerator_options",
            AcceleratorOptions(num_threads=ACCEL_THREADS, device=device),
        )
    except Exception as exc:  # pragma: no cover
        LOG.info("AcceleratorOptions not available in this Docling build: %s", exc)

    if LAYOUT_MODEL:
        if not _safe_set(pipeline, "layout_model", LAYOUT_MODEL):
            layout_opts = getattr(pipeline, "layout_options", None)
            if layout_opts is not None:
                _safe_set(layout_opts, "model", LAYOUT_MODEL)

    LOG.info(
        "Building Docling converter variant do_ocr=%s force_full_page_ocr=%s table_mode=%s picture_description=%s formula=%s(supported=%s) code=%s(supported=%s) gen_images=%s",
        profile.do_ocr,
        profile.force_full_page_ocr,
        profile.table_mode,
        profile.use_picture_description,
        profile.formula_enrichment,
        support["formula_enrichment"],
        profile.code_enrichment,
        support["code_enrichment"],
        profile.generate_picture_images,
    )

    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline)}
    )
    return converter, support


# The default (unplanned) profile is prewarmed + used for backwards-compatible
# behaviour. The cache is keyed by the complete ConverterProfile so two lanes
# that differ in ANY converter-affecting field never share a converter.
DEFAULT_POLICY = resolve_execution_policy("unplanned", "semantic", None, GLOBAL_CAPABILITIES)
DEFAULT_CONVERTER_PROFILE = DEFAULT_POLICY.converter_profile()
CONVERTER, _DEFAULT_SUPPORT = _build_converter(DEFAULT_CONVERTER_PROFILE)
_CONVERTER_VARIANTS: dict[ConverterProfile, tuple[DocumentConverter, dict]] = {
    DEFAULT_CONVERTER_PROFILE: (CONVERTER, _DEFAULT_SUPPORT),
}


def _get_converter(profile: ConverterProfile) -> tuple[DocumentConverter, dict]:
    cached = _CONVERTER_VARIANTS.get(profile)
    if cached is not None:
        return cached
    built = _build_converter(profile)
    _CONVERTER_VARIANTS[profile] = built
    return built


LOG.info(
    "Docling converter ready (version=%s, callback_upload_configured=%s)",
    ENGINE_VERSION,
    bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY),
)


def _build_prewarm_pdf() -> bytes:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length 44 >>\nstream\nBT /F1 12 Tf 40 120 Td (Docling warmup) Tj ET\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{idx} 0 obj\n".encode("ascii"))
        out.extend(obj)
        out.extend(b"\nendobj\n")
    xref_at = len(out)
    out.extend(f"xref\n0 {len(offsets)}\n".encode("ascii"))
    out.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        out.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    out.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode("ascii"))
    return bytes(out)


@app.on_event("startup")
async def prewarm_docling() -> None:
    if not PREWARM_ON_STARTUP:
        LOG.info("Docling startup prewarm disabled")
        return
    started = time.monotonic()
    from docling.datamodel.base_models import DocumentStream

    try:
        stream = DocumentStream(name="prewarm.pdf", stream=io.BytesIO(_build_prewarm_pdf()))
        CONVERTER.convert(stream)
        LOG.info("Docling startup prewarm complete", extra={"duration_ms": int((time.monotonic() - started) * 1000)})
    except Exception as exc:  # pragma: no cover
        LOG.warning("Docling startup prewarm failed: %s", exc, extra={"duration_ms": int((time.monotonic() - started) * 1000)})


# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------
@app.middleware("http")
async def require_bearer(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    token = REQUEST_ID.set(request_id)
    started = time.monotonic()
    try:
        if request.url.path in {"/healthz", "/"}:
            response = await call_next(request)
        elif not SERVICE_TOKENS:
            response = error_response(503, "service_token_not_configured", "PDF_PARSE_SERVICE_TOKEN is not configured.", retryable=True)
        else:
            auth = request.headers.get("authorization", "")
            if not auth.lower().startswith("bearer ") or auth.split(" ", 1)[1].strip() not in SERVICE_TOKENS:
                response = error_response(401, "unauthorised", "Invalid bearer token.", retryable=False)
            else:
                response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        LOG.info(
            "request complete",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": int((time.monotonic() - started) * 1000),
            },
        )
        return response
    finally:
        REQUEST_ID.reset(token)


def error_response(status_code: int, error_code: str, message: str, *, retryable: bool) -> JSONResponse:
    return JSONResponse(
        {"error_code": error_code, "message": message, "retryable": retryable},
        status_code=status_code,
    )


@app.exception_handler(SidecarError)
async def sidecar_error_handler(_request: Request, exc: SidecarError) -> JSONResponse:
    LOG.warning(exc.message, extra={"error_code": exc.error_code, "retryable": exc.retryable})
    return error_response(exc.status_code, exc.error_code, exc.message, retryable=exc.retryable)


@app.exception_handler(HTTPException)
async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    status = int(exc.status_code)
    retryable = status in {408, 429, 500, 502, 503, 504}
    return error_response(status, f"http_{status}", str(exc.detail), retryable=retryable)


@app.exception_handler(Exception)
async def unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    LOG.exception("Unhandled sidecar error", extra={"error_code": "internal_error", "retryable": True})
    return error_response(500, "internal_error", str(exc), retryable=True)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ParseRequest(BaseModel):
    url: Optional[str] = Field(default=None)
    pdf_base64: Optional[str] = Field(default=None)
    enable_picture_description: Optional[bool] = Field(default=None)
    include_doctags: bool = Field(default=True)
    include_markdown: bool = Field(default_factory=lambda: INCLUDE_MARKDOWN_DEFAULT)
    redact_pii: bool = Field(default=False)
    # Wave F-Option-3 callback fields. When all three are present, sidecar runs
    # parse + raster in a BackgroundTask, uploads artifacts to Supabase Storage,
    # and POSTs completion to `callback_url`. Sidecar returns 202 immediately.
    callback_url: Optional[str] = Field(default=None)
    callback_token: Optional[str] = Field(default=None)
    job_id: Optional[str] = Field(default=None)
    # Hybrid / pixel-perfect → also rasterise in the same background task.
    mode: Optional[str] = Field(default=None)
    extractor_lane: Optional[str] = None
    raster_dpi: Optional[int] = Field(default=None, ge=72, le=300)
    raster_format: str = Field(default="png", pattern="^(png|jpeg)$")
    allow_mode_override: bool = Field(default=True)


class RasterRequest(BaseModel):
    url: Optional[str] = None
    pdf_base64: Optional[str] = None
    dpi: int = Field(default=144, ge=72, le=300)
    pages: Optional[list[int]] = Field(default=None)
    format: str = Field(default="png", pattern="^(png|jpeg)$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _resolve_pdf_bytes(url: Optional[str], pdf_base64: Optional[str]) -> bytes:
    if not url and not pdf_base64:
        raise SidecarError(400, "missing_source", "Either `url` or `pdf_base64` is required.")
    if pdf_base64:
        try:
            data = base64.b64decode(pdf_base64, validate=True)
        except Exception as exc:
            raise SidecarError(400, "invalid_base64", f"Invalid base64: {exc}") from exc
    else:
        try:
            resp = await fetch_public_url(url)  # type: ignore[arg-type]
        except UnsafeSourceUrl as exc:
            raise SidecarError(400, "unsafe_source_url", str(exc)) from exc
        except httpx.TooManyRedirects as exc:
            raise SidecarError(400, "source_fetch_redirects", "Source URL returned too many redirects.") from exc
        except httpx.TimeoutException as exc:
            raise SidecarError(504, "source_fetch_timeout", "Timed out fetching source PDF.", retryable=True) from exc
        except httpx.RequestError as exc:
            raise SidecarError(502, "source_fetch_error", f"Could not fetch source PDF: {exc}", retryable=True) from exc
        if resp.status_code != 200:
            retryable = resp.status_code in {408, 429, 500, 502, 503, 504}
            raise SidecarError(
                502 if retryable else 400,
                "source_fetch_bad_status",
                f"Source URL returned {resp.status_code}.",
                retryable=retryable,
            )
        data = resp.content
    if len(data) > MAX_PDF_BYTES:
        raise SidecarError(413, "pdf_too_large", f"PDF exceeds {MAX_PDF_BYTES} bytes")
    if not data.startswith(b"%PDF"):
        raise SidecarError(400, "invalid_pdf", "Payload is not a PDF.")
    return data


async def _resolve_source_timed(metrics: OperationalMetricsAccumulator, url, pdf_base64) -> bytes:
    """G2: resolve source bytes while recording the correct source phase +
    bytes_in on the metrics accumulator. URL → source_download_ms (network);
    base64 → source_resolve_ms (decode/validate, no network). On failure the
    phase stays un-measured (partial metrics) — never a fabricated timing."""
    phase = "source_resolve_ms" if pdf_base64 else "source_download_ms"
    start = metrics.now()
    data = await _resolve_pdf_bytes(url, pdf_base64)
    metrics.record_since(phase, start)
    metrics.set_bytes_in(len(data))
    return data


def _log_operational_metrics(metrics_dict: dict, *, callback_attempt_count=None, callback_attempt_ms=None, error_code=None) -> None:
    """Structured, PII-safe operational-metrics log line — never tokens, URLs,
    document text, or raw artifact contents."""
    t = metrics_dict.get("timings", {}) or {}
    c = metrics_dict.get("counts", {}) or {}
    LOG.info(
        "operational_metrics contract=%s scope=%s status=%s job_id=%s chunk_index=%s lane=%s effective_mode=%s "
        "elapsed_ms=%s parse_ms=%s raster_ms=%s upload_ms=%s per_page_ms=%s pages=%s callback_attempts=%s completed_callback_attempt_ms=%s error_code=%s",
        metrics_dict.get("contract_version"), metrics_dict.get("scope"), metrics_dict.get("status"),
        metrics_dict.get("job_id"), metrics_dict.get("chunk_index"), metrics_dict.get("extractor_lane"),
        metrics_dict.get("effective_mode"), t.get("sidecar_elapsed_before_callback_ms"),
        t.get("parse_ms"), t.get("raster_ms"), t.get("artifact_upload_ms"), t.get("per_page_artifact_ms"),
        c.get("page_count"),
        callback_attempt_count if callback_attempt_count is not None else metrics_dict.get("callback_attempt_count"),
        callback_attempt_ms, error_code,
    )


PII_PATTERNS = [
    (re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE), "[redacted-email]"),
    (re.compile(r"\b(?:\+?61|0)[2-478](?:[ -]?\d){8}\b"), "[redacted-phone]"),
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[redacted-number]"),
    (re.compile(r"\b(?:BSB|Account(?: Number)?|Acct)[:# ]+[0-9 -]{4,}\b", re.IGNORECASE), "[redacted-account]"),
    (re.compile(r"\b(?:TFN|Tax File Number)[:# ]+[0-9 -]{8,}\b", re.IGNORECASE), "[redacted-tax-id]"),
]

def _redact_text(value: str) -> str:
    out = value
    for pattern, replacement in PII_PATTERNS:
        out = pattern.sub(replacement, out)
    return out

def _redact_docling_pii(node: Any) -> int:
    redactions = 0
    if isinstance(node, dict):
        for key, value in list(node.items()):
            if key in {"text", "caption", "orig", "markdown"} and isinstance(value, str):
                redacted = _redact_text(value)
                if redacted != value:
                    node[key] = redacted
                    redactions += 1
            else:
                redactions += _redact_docling_pii(value)
    elif isinstance(node, list):
        for item in node:
            redactions += _redact_docling_pii(item)
    return redactions

def _extract_outline(doc: Any) -> list[dict]:
    outline: list[dict] = []
    for attr in ("outlines", "outline", "toc"):
        nodes = getattr(doc, attr, None)
        if not nodes:
            continue
        try:
            for node in nodes:
                outline.append({
                    "title": getattr(node, "title", None) or getattr(node, "text", None) or "",
                    "level": getattr(node, "level", 1),
                    "page_no": getattr(node, "page_no", None) or getattr(node, "page", None),
                })
            if outline:
                return outline
        except Exception:  # pragma: no cover
            continue
    texts = getattr(doc, "texts", None) or []
    for t in texts:
        label = getattr(t, "label", None)
        if label in ("title", "section_header"):
            prov = getattr(t, "prov", None) or []
            page_no = prov[0].page_no if prov else None
            outline.append({
                "title": getattr(t, "text", "") or "",
                "level": 1 if label == "title" else max(1, min(6, int(getattr(t, "level", 2) or 2))),
                "page_no": page_no,
            })
    return outline


def _extract_languages(doc_dict: dict) -> dict[int, str]:
    counts: dict[int, dict[str, int]] = {}
    for t in (doc_dict.get("texts") or []):
        lang = (t.get("language") or t.get("lang") or "").lower().strip()
        if not lang:
            continue
        for p in (t.get("prov") or []):
            pn = p.get("page_no")
            if pn is None:
                continue
            counts.setdefault(pn, {}).setdefault(lang, 0)
            counts[pn][lang] += 1
    out: dict[int, str] = {}
    for pn, hist in counts.items():
        out[pn] = max(hist.items(), key=lambda kv: kv[1])[0]
    return out


def _summarise_doc(doc_dict: dict) -> dict:
    texts = doc_dict.get("texts") or []
    tables = doc_dict.get("tables") or []
    pictures = doc_dict.get("pictures") or doc_dict.get("figures") or []
    total_chars = 0
    ocr_chars = 0
    ocr_pages: set[int] = set()
    conf_sum = 0.0
    conf_n = 0
    page_conf: dict[int, dict[str, float | int]] = {}
    for t in texts:
        s = t.get("text") or ""
        total_chars += len(s)
        origin = (t.get("origin") or t.get("source") or "").lower()
        if "ocr" in origin:
            ocr_chars += len(s)
            for p in (t.get("prov") or []):
                pn = p.get("page_no")
                if pn is not None:
                    ocr_pages.add(int(pn))
        conf = t.get("confidence")
        if isinstance(conf, (int, float)) and 0.0 <= float(conf) <= 1.0:
            conf_value = float(conf)
            conf_sum += conf_value
            conf_n += 1
            for p in (t.get("prov") or []):
                pn = p.get("page_no")
                if pn is None:
                    continue
                bucket = page_conf.setdefault(int(pn), {"sum": 0.0, "count": 0})
                bucket["sum"] = float(bucket["sum"]) + conf_value
                bucket["count"] = int(bucket["count"]) + 1
    table_cells = 0
    for tbl in tables:
        data = tbl.get("data") or {}
        rows = data.get("table_cells") or data.get("cells") or []
        if isinstance(rows, list):
            table_cells += len(rows)
    return {
        "text_chars": total_chars,
        "ocr_chars": ocr_chars,
        "ocr_pages": sorted(ocr_pages),
        "avg_text_confidence": round(conf_sum / conf_n, 4) if conf_n else None,
        "page_confidence": [
            {
                "page_no": page_no,
                "avg_text_confidence": round(float(vals["sum"]) / int(vals["count"]), 4) if int(vals["count"]) else None,
                "text_block_count": int(vals["count"]),
            }
            for page_no, vals in sorted(page_conf.items())
        ],
        "table_count": len(tables),
        "table_cell_count": table_cells,
        "picture_count": len(pictures),
        "text_block_count": len(texts),
    }


# ---------------------------------------------------------------------------
# Phase 2 — PyMuPDF (fitz) vector + typography extraction
# ---------------------------------------------------------------------------
def _fmt(n: float) -> str:
    return f"{float(n):.2f}".rstrip("0").rstrip(".")


def _fitz_fill_color_to_hex(color: Any) -> Optional[str]:
    """fitz drawing fill/stroke colors are (r,g,b) floats in 0..1, or None."""
    if not color:
        return None
    try:
        r, g, b = float(color[0]), float(color[1]), float(color[2])
    except Exception:
        return None
    clamp = lambda v: max(0, min(255, round(v * 255)))
    return "#%02x%02x%02x" % (clamp(r), clamp(g), clamp(b))


def _fitz_span_color_to_hex(color: Any) -> Optional[str]:
    """get_text('dict') span colors are packed sRGB integers."""
    try:
        c = int(color)
    except Exception:
        return None
    if c < 0:
        return None
    return "#%02x%02x%02x" % ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def _drawing_to_svg_path(drawing: dict) -> str:
    parts: list[str] = []
    for it in drawing.get("items", []) or []:
        try:
            op = it[0]
            if op == "l":
                p1, p2 = it[1], it[2]
                parts.append(f"M{_fmt(p1.x)},{_fmt(p1.y)} L{_fmt(p2.x)},{_fmt(p2.y)}")
            elif op == "c":
                p1, p2, p3, p4 = it[1], it[2], it[3], it[4]
                parts.append(
                    f"M{_fmt(p1.x)},{_fmt(p1.y)} C{_fmt(p2.x)},{_fmt(p2.y)} "
                    f"{_fmt(p3.x)},{_fmt(p3.y)} {_fmt(p4.x)},{_fmt(p4.y)}"
                )
            elif op == "re":
                r = it[1]
                parts.append(f"M{_fmt(r.x0)},{_fmt(r.y0)} H{_fmt(r.x1)} V{_fmt(r.y1)} H{_fmt(r.x0)} Z")
            elif op == "qu":
                q = it[1]
                parts.append(
                    f"M{_fmt(q.ul.x)},{_fmt(q.ul.y)} L{_fmt(q.ur.x)},{_fmt(q.ur.y)} "
                    f"L{_fmt(q.lr.x)},{_fmt(q.lr.y)} L{_fmt(q.ll.x)},{_fmt(q.ll.y)} Z"
                )
        except Exception:
            continue
    return " ".join(parts)


_LINE_CAP_MAP = {0: "butt", 1: "round", 2: "square"}
_LINE_JOIN_MAP = {0: "miter", 1: "round", 2: "bevel"}


def _coerce_enum_index(value) -> Optional[int]:
    """fitz exposes lineCap/lineJoin as an int, or (older builds) a tuple of ints."""
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    return None


def _dash_to_svg(dashes) -> Optional[str]:
    """Convert fitz PDF dash notation (e.g. '[3 2] 0') to an SVG dasharray ('3 2').
    Returns None for solid lines ('[] 0', empty, or an all-zero dash array)."""
    if not dashes or not isinstance(dashes, str):
        return None
    m = re.search(r"\[(.*?)\]", dashes)
    inner = (m.group(1) if m else dashes).strip()
    if not inner:
        return None
    nums = [p for p in inner.replace(",", " ").split() if p]
    try:
        if not nums or not any(float(n) > 0 for n in nums):
            return None
    except ValueError:
        return None
    return " ".join(nums)


def _page_vectors(page) -> list[dict]:
    """Extract vector drawings for one fitz page → DoclingVectorItem-shaped dicts."""
    out: list[dict] = []
    try:
        drawings = page.get_drawings()
    except Exception as exc:  # pragma: no cover
        LOG.warning("fitz get_drawings failed: %s", exc)
        return out
    for d in drawings:
        rect = d.get("rect")
        if rect is None:
            continue
        w = float(rect.x1 - rect.x0)
        h = float(rect.y1 - rect.y0)
        if w < MIN_VECTOR_SIZE_PT and h < MIN_VECTOR_SIZE_PT:
            continue
        path_d = _drawing_to_svg_path(d)
        if not path_d:
            continue
        dtype = d.get("type") or ""
        fill = _fitz_fill_color_to_hex(d.get("fill")) if "f" in dtype else None
        stroke = _fitz_fill_color_to_hex(d.get("color")) if "s" in dtype else None
        if not fill and not stroke:
            stroke = _fitz_fill_color_to_hex(d.get("color")) or "#000000"
        path: dict[str, Any] = {"d": path_d}
        if fill:
            path["fill"] = fill
        if stroke:
            path["stroke"] = stroke
            path["strokeWidth"] = float(d.get("width") or 1.0)
            # Phase 6E — stroke styling (dashed rules, rounded caps/joins). Emit
            # only non-default values to keep the JSON lean.
            dash = _dash_to_svg(d.get("dashes"))
            if dash:
                path["strokeDasharray"] = dash
            cap = _coerce_enum_index(d.get("lineCap"))
            if cap is not None and cap in _LINE_CAP_MAP and cap != 0:
                path["strokeLinecap"] = _LINE_CAP_MAP[cap]
            join = _coerce_enum_index(d.get("lineJoin"))
            if join is not None and join in _LINE_JOIN_MAP and join != 0:
                path["strokeLinejoin"] = _LINE_JOIN_MAP[join]
        if d.get("even_odd"):
            path["fillRule"] = "evenodd"
        opacity = d.get("fill_opacity")
        if opacity is None:
            opacity = d.get("stroke_opacity")
        if isinstance(opacity, (int, float)) and 0 <= opacity < 1:
            path["opacity"] = float(opacity)
        out.append({
            "viewBox": f"{_fmt(float(rect.x0))} {_fmt(float(rect.y0))} {_fmt(w)} {_fmt(h)}",
            "paths": [path],
            "bbox": {"l": float(rect.x0), "t": float(rect.y0), "r": float(rect.x1), "b": float(rect.y1)},
            "confidence": 0.9,
        })
        if len(out) >= MAX_VECTORS_PER_PAGE:
            break
    return out


def _page_text_lines(page) -> list[dict]:
    """Flatten get_text('dict') into per-line records for typography reconciliation."""
    lines: list[dict] = []
    try:
        data = page.get_text("dict")
    except Exception as exc:  # pragma: no cover
        LOG.warning("fitz get_text(dict) failed: %s", exc)
        return lines
    for block in data.get("blocks", []) or []:
        if block.get("type", 0) != 0:
            continue  # 0 = text block
        for line in block.get("lines", []) or []:
            spans = line.get("spans", []) or []
            if not spans:
                continue
            dom = max(spans, key=lambda s: (s.get("bbox", [0, 0, 0, 0])[2] - s.get("bbox", [0, 0, 0, 0])[0]))
            lbbox = line.get("bbox") or dom.get("bbox") or [0, 0, 0, 0]
            origin = dom.get("origin") or [lbbox[0], lbbox[3]]
            flags = int(dom.get("flags") or 0)
            # The MEASURED advance width of this line, in the source's own font.
            #
            # It was always computed — `lbbox` is right here — and was used only
            # to infer alignment and leading, then dropped. That made it
            # impossible for the client to tell whether its substituted font
            # rendered the same text wider than the original, which is precisely
            # why imported text overflows a box copied verbatim from the source.
            # A ratio needs both terms; this is the one nobody was sending.
            measured_width = max(0.0, float(lbbox[2]) - float(lbbox[0]))
            # Per-span extents let the client reconcile a mixed-style line
            # instead of collapsing it to its widest span. Bounded so a
            # pathological line cannot inflate the artifact.
            span_extents = []
            for sp in spans[:MAX_SPANS_PER_LINE]:
                sb = sp.get("bbox") or [0, 0, 0, 0]
                try:
                    sw = max(0.0, float(sb[2]) - float(sb[0]))
                except (TypeError, ValueError, IndexError):
                    continue
                text = str(sp.get("text") or "")
                if not text:
                    continue
                span_extents.append({
                    "width": sw,
                    "chars": len(text),
                    "size": float(sp.get("size") or 0.0),
                    "font": str(sp.get("font") or ""),
                })
            lines.append({
                "bbox": [float(lbbox[0]), float(lbbox[1]), float(lbbox[2]), float(lbbox[3])],
                "origin_y": float(origin[1]),
                "size": float(dom.get("size") or 0.0),
                "font": str(dom.get("font") or ""),
                "bold": bool(flags & 16),
                "italic": bool(flags & 2),
                "color": _fitz_span_color_to_hex(dom.get("color")),
                "measured_width": measured_width,
                "char_count": sum(len(str(sp.get("text") or "")) for sp in spans),
                "spans": span_extents,
            })
    return lines


def _extract_fitz_layers(pdf_bytes: bytes) -> dict[int, dict]:
    """Per-(1-based)-page {vectors, text_lines} extracted via PyMuPDF."""
    result: dict[int, dict] = {}
    if not (_FITZ_AVAILABLE and ENABLE_FITZ_LAYERS):
        return result
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:  # pragma: no cover
        LOG.warning("fitz open failed; skipping vector/typography pass: %s", exc)
        return result
    try:
        for idx in range(doc.page_count):
            try:
                page = doc.load_page(idx)
                result[idx + 1] = {"vectors": _page_vectors(page), "text_lines": _page_text_lines(page)}
            except Exception as exc:  # pragma: no cover
                LOG.warning("fitz page %d extraction failed: %s", idx + 1, exc)
    finally:
        doc.close()
    return result


def _bbox_to_tl(bbox: Any, page_height: float) -> Optional[tuple[float, float, float, float]]:
    """Normalise a Docling bbox (dict or [l,t,r,b]) to top-left (x0,y0,x1,y1)."""
    if isinstance(bbox, dict):
        l, t, r, b = bbox.get("l"), bbox.get("t"), bbox.get("r"), bbox.get("b")
        origin = str(bbox.get("coord_origin") or "TOPLEFT").upper()
    elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        l, t, r, b = bbox[0], bbox[1], bbox[2], bbox[3]
        origin = "TOPLEFT"
    else:
        return None
    try:
        l, t, r, b = float(l), float(t), float(r), float(b)
    except Exception:
        return None
    if origin == "BOTTOMLEFT" and page_height:
        y0, y1 = page_height - max(t, b), page_height - min(t, b)
    else:
        y0, y1 = min(t, b), max(t, b)
    return (min(l, r), y0, max(l, r), y1)


# Moved to `text_alignment.py` so `ci.yml` can gate it: the rule shipped wrong
# (every two-line block came back justified) precisely because nothing in this
# file is dependency-free enough to run in that job. Kept as a thin alias so
# call sites and existing diagnostics read the same.
_infer_alignment = infer_alignment


def _enrich_text_typography(doc_dict: dict, fitz_by_page: dict[int, dict]) -> None:
    """Reconcile fitz line geometry into Docling text items (line-height, align, font)."""
    pages = doc_dict.get("pages") or {}

    def page_height(pn: Any) -> float:
        p = pages.get(pn) or pages.get(str(pn)) or {}
        size = p.get("size") or {}
        try:
            return float(size.get("height") or 0.0)
        except Exception:
            return 0.0

    for item in doc_dict.get("texts") or []:
        prov = item.get("prov") or []
        if not prov:
            continue
        pn = prov[0].get("page_no")
        if pn is None:
            continue
        layer = fitz_by_page.get(int(pn))
        if not layer:
            continue
        ibox = _bbox_to_tl(prov[0].get("bbox"), page_height(pn))
        if not ibox:
            continue
        ix0, iy0, ix1, iy1 = ibox
        matched = []
        for ln in layer.get("text_lines", []):
            lx0, ly0, lx1, ly1 = ln["bbox"]
            cy, cx = (ly0 + ly1) / 2, (lx0 + lx1) / 2
            if iy0 - 1 <= cy <= iy1 + 1 and ix0 - 2 <= cx <= ix1 + 2:
                matched.append(ln)
        if not matched:
            continue
        matched.sort(key=lambda l: l["origin_y"])
        font = item.setdefault("font", {})
        sizes = [m["size"] for m in matched if m["size"] > 0]
        if len(matched) >= 2 and sizes:
            deltas = [matched[i + 1]["origin_y"] - matched[i]["origin_y"] for i in range(len(matched) - 1)]
            deltas = [d for d in deltas if d > 0]
            if deltas:
                med = sorted(deltas)[len(deltas) // 2]
                size = sorted(sizes)[len(sizes) // 2]
                if size > 0:
                    lh = med / size
                    if 0.8 <= lh <= 3.0:
                        font.setdefault("line_height", round(lh, 3))
        dom = max(matched, key=lambda l: (l["bbox"][2] - l["bbox"][0]))
        if not font.get("family") and dom["font"]:
            font["family"] = dom["font"]
        if not font.get("size") and dom["size"]:
            font["size"] = round(dom["size"], 2)
        if not font.get("color") and dom["color"]:
            font["color"] = dom["color"]
        if "weight" not in font and dom["bold"]:
            font["weight"] = 700
        if "italic" not in font and dom["italic"]:
            font["italic"] = True
        if "text_align" not in item:
            item["text_align"] = _infer_alignment(matched, ix0, ix1)
        # The measurement the client cannot make for itself: how much space this
        # text occupies IN THE SOURCE'S OWN FONT. The client knows what its
        # substituted font renders; without this it has no second term, so it
        # cannot tell "the box is right and the font is wide" from "the box is
        # wrong", and every remedy would be guesswork.
        item["source_measure"] = {
            "version": SOURCE_MEASURE_VERSION,
            "lineCount": len(matched),
            "measuredWidthPt": round(max((m.get("measured_width") or 0.0) for m in matched), 3),
            "totalCharCount": sum(int(m.get("char_count") or 0) for m in matched),
            "lines": [
                {
                    "widthPt": round(float(m.get("measured_width") or 0.0), 3),
                    "charCount": int(m.get("char_count") or 0),
                    "sizePt": round(float(m.get("size") or 0.0), 2),
                    # WHERE the line sits, not just how wide it is. Two facts the
                    # client cannot recover from the joined string and could only
                    # guess at from the item's box:
                    #
                    #  - Distinct baselines say how many lines were STACKED. A
                    #    "line" here is a line RECORD, and two runs sharing a
                    #    baseline are two of them — this cover's footer sets
                    #    `PRIVATE AND CONFIDENTIAL` and `REF 90E5DF34` at
                    #    opposite ends of one 9pt strip. Counting records reads
                    #    that as a wrapped paragraph; counting baselines does not.
                    #  - The horizontal gap between two such runs is what makes
                    #    them separable at all. Merged into one left-aligned
                    #    overlay, the right-hand field walks to the middle of
                    #    the page.
                    "x0Pt": round(float((m.get("bbox") or [0, 0, 0, 0])[0]), 3),
                    "x1Pt": round(float((m.get("bbox") or [0, 0, 0, 0])[2]), 3),
                    "baselineYPt": round(float(m.get("origin_y") or 0.0), 3),
                    # Per-span extents. Span char-counts recover word boundaries
                    # for tracked text WHEN the PDF drew one span per word —
                    # which is a real pattern but not a rule: this cover draws
                    # each tracked line as a single span, so nothing here helps
                    # it and `charCount` above is what partitions the join.
                    # Already bounded by MAX_SPANS_PER_LINE.
                    "spans": m.get("spans") or [],
                }
                for m in matched[:MAX_MEASURED_LINES]
            ],
        }


def _collect_vectors(fitz_by_page: dict[int, dict]) -> list[dict]:
    vectors: list[dict] = []
    for pn, layer in sorted(fitz_by_page.items()):
        for v in layer.get("vectors", []):
            bbox = dict(v.get("bbox") or {})
            bbox["coord_origin"] = "TOPLEFT"
            vectors.append({
                "prov": [{"page_no": int(pn), "bbox": bbox}],
                "viewBox": v.get("viewBox"),
                "paths": v.get("paths", []),
                "confidence": v.get("confidence", 0.9),
            })
    return vectors


def _font_codepoints(font) -> set[int] | None:
    """Codepoints the program's cmap actually maps, or None if unreadable."""
    try:
        cps = {int(c) for c in font.valid_codepoints() if 0 < int(c) <= 0x10FFFF}
    except Exception:
        return None
    return cps or None


def _cmap_coverage_ranges(font) -> list[str] | None:
    """CSS `unicode-range` segments for the codepoints this font ACTUALLY maps.

    Returns None when the cmap cannot be read. The caller treats None as
    "coverage unknown" and refuses to embed a SUBSET on it: a face declared
    without a range claims every codepoint, and a subset that claims codepoints
    it lacks is precisely the gibberish-glyph / vanished-space failure this
    exists to prevent.
    """
    cps = _font_codepoints(font)
    return None if cps is None else coverage_ranges(cps, MAX_COVERAGE_RANGES)


def _font_tounicode(doc, xref: int) -> dict[int, str]:
    """The producer's own CID → text statement for this font, or {}."""
    try:
        obj = doc.xref_object(xref) or ""
        match = re.search(r"/ToUnicode\s+(\d+)\s+0\s+R", obj)
        if not match:
            return {}
        raw = doc.xref_stream(int(match.group(1)))
        if not raw:
            return {}
        return parse_tounicode_cmap(raw.decode("latin-1", errors="ignore"))
    except Exception:
        return {}


def _cid_to_gid_is_identity(doc, xref: int) -> bool:
    """Is this font's CID numbering the same as its glyph numbering?

    Only then does the ToUnicode CMap invert into a Unicode→glyph mapping. A
    font whose descendant declares a CIDToGIDMap STREAM renumbers the glyphs,
    and reading a CID as a glyph index there would draw an unrelated glyph.
    Absent, the PDF default is Identity — but say so only for a descendant we
    actually found, so an unreadable object is never assumed benign.
    """
    try:
        obj = doc.xref_object(xref) or ""
        match = re.search(r"/DescendantFonts\s*\[\s*(\d+)\s+0\s+R", obj)
        if not match:
            return False
        descendant = doc.xref_object(int(match.group(1))) or ""
        if "/CIDFontType2" not in descendant:
            # Identity CIDToGIDMap is a TrueType-outline concept; CFF-based
            # descendants map through the charset instead.
            return False
        c2g = re.search(r"/CIDToGIDMap\s*(/\w+|\d+\s+0\s+R)", descendant)
        return c2g is None or c2g.group(1) == "/Identity"
    except Exception:
        return False


def _repair_font_cmap(buf: bytes, tounicode: dict[int, str], identity: bool) -> tuple[bytes, set[int], int]:
    """Add the ToUnicode mapping's missing Unicode→glyph entries to the cmap.

    Returns `(bytes, codepoints, added)`. On any failure the ORIGINAL bytes come
    back with an empty codepoint set and zero additions — a font we could not
    safely improve must still embed exactly as well as it did before.

    Only Unicode cmap subtables are touched, and only by adding: see
    `plan_cmap_repair` for every rule that keeps this from making a page worse.
    """
    try:
        from fontTools.ttLib import TTFont  # noqa: PLC0415 — optional at import time

        tt = TTFont(io.BytesIO(buf), fontNumber=0, lazy=False)
        cmap_table = tt.get("cmap")
        glyph_order = tt.getGlyphOrder()
        if cmap_table is None or not glyph_order:
            return buf, set(), 0
        unicode_subtables = [t for t in cmap_table.tables if t.isUnicode()]
        if not unicode_subtables:
            return buf, set(), 0

        existing: set[int] = set()
        for table in unicode_subtables:
            existing |= set(table.cmap.keys())

        # A subsetter strips outlines from glyphs it does not need. Pointing a
        # codepoint at one of those draws nothing at all.
        blank: set[int] = set()
        glyf = tt.get("glyf")
        if glyf is not None:
            for gid, name in enumerate(glyph_order):
                try:
                    if glyf[name].numberOfContours == 0:
                        blank.add(gid)
                except Exception:
                    blank.add(gid)

        planned = plan_cmap_repair(tounicode, existing, len(glyph_order), blank, identity)
        if not planned:
            return buf, existing, 0

        for table in unicode_subtables:
            for codepoint, gid in planned.items():
                if codepoint not in table.cmap:
                    table.cmap[codepoint] = glyph_order[gid]
        out = io.BytesIO()
        tt.save(out)
        return out.getvalue(), existing | set(planned), len(planned)
    except Exception as exc:  # pragma: no cover — never fail a parse over a font
        LOG.warning("cmap repair skipped: %s", exc)
        return buf, set(), 0


def _extract_fitz_fonts(pdf_bytes: bytes) -> list[dict]:
    """Document fonts: names (for web-font matching) + embeddable programs.

    Attaches `base64` for every font program that can render as an @font-face —
    INCLUDING subset fonts, which are the common case. A subset embedded in the
    PDF contains exactly the glyphs the source text drew with it, which is
    exactly what re-rendering that text needs. The frontend already places the
    name-resolved web font AFTER the embedded family in the stack, and both
    browsers and WeasyPrint fall back PER GLYPH within a stack — so a partial
    subset plus fallback strictly dominates fallback alone. The previous gate
    (non-subset only) excluded nearly every real-world font, which is why
    imported text rendered in substitutes rather than in itself.

    PDFs re-embed the same family as a DIFFERENT subset per page, so per family
    the candidate that renders most of the document wins: a full font beats any
    subset, else the larger glyph set. First-seen kept whichever page happened
    to come first, which could not cover later pages' glyphs.
    """
    if not (_FITZ_AVAILABLE and ENABLE_FITZ_LAYERS):
        return []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:  # pragma: no cover
        LOG.warning("fitz open (fonts) failed: %s", exc)
        return []

    def _rank(e: dict) -> tuple:
        return (
            1 if e.get("_buf") is not None else 0,
            0 if e.get("subset") else 1,
            int(e.get("glyphCount") or 0),
        )

    by_name: dict[str, dict] = {}
    order: list[str] = []
    try:
        seen_xref: set[int] = set()
        for pno in range(doc.page_count):
            try:
                fonts = doc.load_page(pno).get_fonts(full=True)
            except Exception as exc:  # pragma: no cover
                LOG.warning("fitz get_fonts page %d failed: %s", pno + 1, exc)
                continue
            for ent in fonts:
                xref = ent[0]
                if xref in seen_xref:
                    continue
                seen_xref.add(xref)
                ext = str(ent[1] or "").lower()
                basename = str(ent[3] or "")
                stripped = re.sub(r"^[A-Z]{6}\+", "", basename)
                key = stripped.lower()
                if key not in by_name and len(by_name) >= MAX_FONTS:
                    continue
                entry: dict[str, Any] = {
                    "basename": stripped,
                    "psName": basename,
                    "ext": ext,
                    "subset": bool(re.match(r"^[A-Z]{6}\+", basename)),
                    "bold": "bold" in key,
                    "italic": ("italic" in key) or ("oblique" in key),
                }
                if ext in ("ttf", "otf"):
                    try:
                        _bn, e2, _st, buf = doc.extract_font(xref)
                        if buf:
                            entry["bytes"] = len(buf)
                            entry["mimetype"] = "font/ttf" if e2 == "ttf" else "font/otf"
                            font = fitz.Font(fontbuffer=buf)
                            entry["glyphCount"] = int(getattr(font, "glyph_count", 0) or 0)
                            # D1 — the font's own hhea ascent/descent, in em.
                            #
                            # CSS puts a line's first baseline at
                            # `(lineHeight - (ascent + descent))/2 + ascent`
                            # below the box, so without these the client cannot
                            # know where its text will actually sit and places
                            # every block by its ink top instead — which lands
                            # ~0.36em low, on every line of every page.
                            _asc = float(getattr(font, "ascender", 0.0) or 0.0)
                            _desc = float(getattr(font, "descender", 0.0) or 0.0)
                            if _asc > 0:
                                entry["ascender"] = round(_asc, 6)
                                # hhea descent is negative; ship the magnitude,
                                # which is what the CSS formula adds.
                                entry["descender"] = round(abs(_desc), 6)
                            hits = sum(1 for c in "AaEeRrTtOoNnIiSs" if font.has_glyph(ord(c)))
                            # Telemetry only. As a GATE this heuristic wrongly
                            # rejected any subset missing the probe letters — an
                            # uppercase-only heading subset misses every
                            # lowercase probe yet renders its own text exactly.
                            entry["hasUnicodeCmap"] = hits >= 6
                            # A functional cmap maps at least one probe; per-glyph
                            # stack fallback covers whatever the subset lacks.
                            if hits >= 1 and len(buf) <= MAX_FONT_BYTES:
                                # R2 — enumerate the cmap's REAL coverage so the
                                # client can scope the @font-face with
                                # unicode-range. The browser then uses this face
                                # only for codepoints it truly has and falls per
                                # glyph to the stack fallback for the rest — no
                                # tofu, no wrong glyphs, no vanishing spaces.
                                #
                                # A SUBSET whose coverage cannot be read does not
                                # embed at all: without a range the browser would
                                # claim every codepoint for a face that has few,
                                # which is exactly the gibberish-glyph failure.
                                # A full font without coverage still embeds
                                # (real cmap; the pre-subset behaviour).
                                #
                                # B5 — before measuring coverage, make the
                                # glyphs the source actually drew REACHABLE.
                                # A PDF subset selects glyphs by CID, so its
                                # cmap need not be complete and Chrome's is not:
                                # this document's SegoeUI-Semibold has 2467
                                # glyphs, a 47-codepoint cmap, and a '7' at CID
                                # 2464 that nothing could address. A web font is
                                # looked up BY Unicode, so that '7' fell to the
                                # stack fallback and the footer read `07 / 07`
                                # in two typefaces. The producer's own ToUnicode
                                # CMap says which glyph is which; with an
                                # Identity CIDToGIDMap it inverts into exactly
                                # the entries the cmap lacks.
                                repaired, _cps, added = _repair_font_cmap(
                                    buf,
                                    _font_tounicode(doc, xref),
                                    _cid_to_gid_is_identity(doc, xref),
                                )
                                # Adopt the repair only if the result is still a
                                # font fitz can read and still within budget.
                                # Coverage is then measured on WHAT IS EMBEDDED,
                                # never on the repair's own bookkeeping: the
                                # range gate is the last thing standing between
                                # a partial subset and a page of tofu, and it
                                # has to be describing the actual bytes.
                                if added and len(repaired) <= MAX_FONT_BYTES:
                                    try:
                                        font = fitz.Font(fontbuffer=repaired)
                                        buf = repaired
                                        entry["bytes"] = len(buf)
                                        entry["cmapRepairedCodepoints"] = added
                                    except Exception as exc:
                                        LOG.warning(
                                            "repaired font unreadable, keeping original: %s", exc,
                                        )
                                ranges = _cmap_coverage_ranges(font)
                                if ranges is not None:
                                    entry["coverage_ranges"] = ranges
                                    entry["_buf"] = buf
                                elif not entry["subset"]:
                                    entry["_buf"] = buf
                    except Exception as exc:  # pragma: no cover
                        LOG.warning("fitz extract_font xref=%s failed: %s", xref, exc)
                prev = by_name.get(key)
                if prev is None:
                    by_name[key] = entry
                    order.append(key)
                elif _rank(entry) > _rank(prev):
                    by_name[key] = entry
    finally:
        doc.close()

    # Emit in first-seen order; the whole-document byte budget applies to the
    # winning candidates only, not to every xref encountered along the way.
    out: list[dict] = []
    embedded_font_bytes = 0
    for key in order:
        entry = by_name[key]
        buf = entry.pop("_buf", None)
        if buf is not None and embedded_font_bytes + len(buf) <= MAX_EMBEDDED_FONT_BYTES:
            entry["base64"] = base64.b64encode(buf).decode("ascii")
            embedded_font_bytes += len(buf)
        out.append(entry)
    return out

# ── J1: explicit runtime selection (legacy | vnext) ─────────────────────────
# `_do_parse` is the ONE conversion boundary shared by every parse path. Under
# DOCLING_RUNTIME_PROFILE=vnext it routes through the vNext runtime adapter so a
# vNext image can never silently run the legacy converter. Absent/legacy leaves
# the production path byte-identical. `_RUNTIME_OVERRIDE` is a test seam (an
# injected fake runtime) used by the invocation-spy / poisoned-legacy tests.
_RUNTIME_INSTANCE: Any = None
_RUNTIME_OVERRIDE: Any = None


def _get_runtime():
    global _RUNTIME_INSTANCE
    if _RUNTIME_OVERRIDE is not None:
        return _RUNTIME_OVERRIDE
    if _RUNTIME_INSTANCE is None:
        from docling_runtime_legacy import select_docling_runtime
        _RUNTIME_INSTANCE = select_docling_runtime()
    return _RUNTIME_INSTANCE


def build_vnext_options_from_env():
    """Build the vNext capability ceiling from env (shared by app.py + app_vnext)."""
    from docling_vnext_profiles import VNextBuildOptions
    return VNextBuildOptions(
        build_profile=os.environ.get("DOCLING_VNEXT_BUILD_PROFILE", "vnext-cpu-standard"),
        device=os.environ.get("DOCLING_VNEXT_DEVICE", "cpu"),
        num_threads=int(os.environ.get("OMP_NUM_THREADS", "4")),
        ocr_engine=os.environ.get("DOCLING_VNEXT_OCR_ENGINE", "easyocr"),
        allow_picture_classification=_env_bool("DOCLING_VNEXT_ALLOW_PICTURE_CLASSIFICATION", True),
        allow_picture_description=_env_bool("DOCLING_VNEXT_ALLOW_PICTURE_DESCRIPTION", False),
        allow_chart_extraction=_env_bool("DOCLING_VNEXT_ALLOW_CHART_EXTRACTION", False),
        allow_chart_to_csv=_env_bool("DOCLING_VNEXT_ALLOW_CHART_TO_CSV", False),
        allow_formula_enrichment=_env_bool("DOCLING_VNEXT_ALLOW_FORMULA", False),
        allow_code_enrichment=_env_bool("DOCLING_VNEXT_ALLOW_CODE", False),
        allow_threaded_pipeline=_env_bool("DOCLING_VNEXT_ALLOW_THREADED", False),
        allow_vlm=_env_bool("DOCLING_VNEXT_ALLOW_VLM", False),
    )


def _do_parse(
    pdf_bytes: bytes,
    *,
    policy: EffectiveLanePolicy,
    redact_pii: bool,
) -> dict:
    """Synchronous Docling parse — shared by ALL parse paths (sync /parse, async
    monolithic /parse, /parse-chunk). Every path resolves an EffectiveLanePolicy
    and passes it here, so lane behaviour is identical across paths (G1)."""
    from docling.datamodel.base_models import DocumentStream

    use_description = policy.use_picture_description
    include_doctags = policy.include_doctags
    include_markdown = policy.include_markdown

    t0 = time.monotonic()
    stream = DocumentStream(name="source.pdf", stream=io.BytesIO(pdf_bytes))

    runtime = _get_runtime()
    vnext_engine_identity: Optional[dict] = None
    if runtime is not None and runtime.profile_name() == "vnext":
        # J1 — vNext path: conversion goes THROUGH the vNext runtime adapter.
        from docling_vnext_profiles import resolve_vnext_converter_profile
        vprofile = resolve_vnext_converter_profile(
            policy.as_dict(), runtime.capabilities(), build_vnext_options_from_env())
        conv_result = runtime.convert(stream, vprofile)
        # Only a complete conversion may enter the normal success pipeline.
        # Partial and timed-out documents retain useful provider artifacts, but
        # must remain contained for retry/manual review rather than being
        # reported to sync or async callers as successfully parsed.
        if conv_result.raw_document is None or not conv_result.ok:
            raise SidecarError(
                500, "docling_vnext_convert_failed",
                f"vNext conversion {conv_result.status}: {'; '.join(conv_result.errors)[:200] or 'no details'}",
                retryable=True,
            )
        doc = conv_result.raw_document
        doc_dict = conv_result.document  # already normalized (annotation back-fill + vnext section)
        vnext_engine_identity = conv_result.engine_identity
        converter_support = {"runtime_profile": "vnext", "applied_fields": (vnext_engine_identity or {}).get("applied_fields", {})}
    else:
        converter, converter_support = _get_converter(policy.converter_profile())
        try:
            result = converter.convert(stream)
        except Exception as exc:
            raise SidecarError(500, "docling_convert_failed", f"Docling conversion failed: {exc}", retryable=True) from exc
        doc = result.document
        doc_dict = None  # exported below for the legacy path

    pages_meta: list[dict] = []
    for page_no, page in (doc.pages or {}).items():
        size = page.size
        pages_meta.append({"page_no": page_no, "width": size.width, "height": size.height})
    pages_meta.sort(key=lambda p: p["page_no"])

    if doc_dict is None:  # legacy path exports here; vNext already normalized it.
        doc_dict = doc.export_to_dict()
    pii_redactions = _redact_docling_pii(doc_dict) if redact_pii else 0

    # Phase 2: augment with PyMuPDF vector graphics + reconciled span typography.
    # Non-fatal — any failure leaves the Docling-only document intact. G1: FITZ
    # layers are now gated by the lane policy (not only the global env flag).
    fitz_vectors = 0
    fitz_fonts = 0
    if _FITZ_AVAILABLE and policy.use_fitz_layers:
        try:
            fitz_layers = _extract_fitz_layers(pdf_bytes)
            if fitz_layers:
                _enrich_text_typography(doc_dict, fitz_layers)
                vectors = _collect_vectors(fitz_layers)
                doc_dict["vectors"] = vectors
                fitz_vectors = len(vectors)
        except Exception as exc:  # pragma: no cover
            LOG.warning("fitz layer enrichment failed (non-fatal): %s", exc)
        # Phase 3: document fonts (names + embeddable programs).
        try:
            fonts = _extract_fitz_fonts(pdf_bytes)
            if fonts:
                doc_dict["fonts"] = fonts
                fitz_fonts = len(fonts)
        except Exception as exc:  # pragma: no cover
            LOG.warning("fitz font extraction failed (non-fatal): %s", exc)

    extras: dict[str, Any] = {}
    if include_doctags:
        try:
            extras["doctags"] = _redact_text(doc.export_to_doctags()) if redact_pii else doc.export_to_doctags()
        except Exception as exc:  # pragma: no cover
            LOG.warning("doctags export failed: %s", exc)
    if include_markdown:
        try:
            extras["markdown"] = _redact_text(doc.export_to_markdown()) if redact_pii else doc.export_to_markdown()
        except Exception as exc:  # pragma: no cover
            LOG.warning("markdown export failed: %s", exc)

    outline = _extract_outline(doc)
    page_languages = _extract_languages(doc_dict)
    for pm in pages_meta:
        lang = page_languages.get(pm["page_no"])
        if lang:
            pm["language"] = lang

    summary = _summarise_doc(doc_dict)
    summary["vector_count"] = fitz_vectors
    summary["font_count"] = fitz_fonts
    if redact_pii:
        summary["pii_redaction"] = {"enabled": True, "redaction_count": pii_redactions}
    parsed_ms = int((time.monotonic() - t0) * 1000)
    LOG.info(
        "Parsed %d-page PDF (%d bytes) in %d ms — %d texts / %d tables / %d pictures / %d vectors / %d OCR pages",
        len(pages_meta), len(pdf_bytes), parsed_ms,
        summary["text_block_count"], summary["table_count"],
        summary["picture_count"], fitz_vectors, len(summary["ocr_pages"]),
    )

    # J1 — engine identity: under vNext, report the actual vNext engine that ran,
    # never the legacy production string. Additive; legacy behaviour unchanged.
    engine_version = ENGINE_VERSION
    if vnext_engine_identity is not None:
        dv = vnext_engine_identity.get("docling_version")
        engine_version = f"docling-{dv}+{vnext_engine_identity.get('adapter_version')}" if dv else engine_version

    return {
        "engine_version": engine_version,
        "engine_identity": vnext_engine_identity,
        "parsed_ms": parsed_ms,
        "page_count": len(pages_meta),
        "pages": pages_meta,
        "outline": outline,
        "page_languages": page_languages,
        "summary": summary,
        "docling_capability_activation_version": DOCLING_CAPABILITY_ACTIVATION_VERSION,
        "parse_options": {
            "lane": policy.lane,
            "effective_mode": policy.effective_mode,
            "do_ocr": bool(policy.do_ocr),
            "force_full_page_ocr": bool(policy.force_full_page_ocr),
            "do_table_structure": bool(policy.do_table_structure),
            "table_mode": policy.table_mode,
            "picture_description": bool(policy.use_picture_description),
            "picture_classification": bool(policy.do_picture_classification),
            "formula_enrichment": bool(policy.formula_enrichment),
            "code_enrichment": bool(policy.code_enrichment),
            "generate_picture_images": bool(policy.generate_picture_images),
            "ocr_langs": OCR_LANGS,
            "bitmap_area_threshold": BITMAP_AREA_THRESHOLD,
            "images_scale": policy.images_scale,
            "fitz_layers": bool(_FITZ_AVAILABLE and policy.use_fitz_layers),
            "converter_support": converter_support,
            "vector_count": fitz_vectors,
            "font_count": fitz_fonts,
        },
        "docling_document": doc_dict,
        **extras,
    }



PER_PAGE_DOCLING_ARTIFACT_VERSION = "per-page-docling-v1"


def _prov_page_numbers(node: Any) -> set[int]:
    pages: set[int] = set()
    if not isinstance(node, dict):
        return pages
    prov = node.get("prov")
    if isinstance(prov, list):
        for p in prov:
            if isinstance(p, dict):
                page_no = p.get("page_no")
                try:
                    if page_no is not None:
                        pages.add(int(page_no))
                except Exception:
                    continue
    return pages


def _item_belongs_to_page(item: Any, page_no: int) -> bool:
    if not isinstance(item, dict):
        return False
    pages = _prov_page_numbers(item)
    if pages:
        return page_no in pages
    # Conservative fallback: keep unproven items out of page-local artifacts.
    return False


def _normalize_bbox(item: dict) -> Any:
    for key in ("bbox", "bounds", "bounding_box"):
        value = item.get(key)
        if value is not None:
            return value
    prov = item.get("prov")
    if isinstance(prov, list) and prov:
        first = prov[0]
        if isinstance(first, dict):
            return first.get("bbox") or first.get("bounds") or first.get("bounding_box")
    return None


def _page_blocks_for_docling_page(page_no: int, texts: list[dict], tables: list[dict], pictures: list[dict], vectors: Optional[list[dict]] = None) -> list[dict]:
    blocks: list[dict] = []

    for idx, item in enumerate(texts, start=1):
        blocks.append({
            "id": f"p{page_no:03d}-text-{idx}",
            "type": "text",
            "label": item.get("label") or item.get("type") or "text",
            "text": item.get("text") or item.get("orig") or "",
            "bbox": _normalize_bbox(item),
            "confidence": item.get("confidence"),
            "source": "docling",
            "page_no": page_no,
        })

    for idx, item in enumerate(tables, start=1):
        blocks.append({
            "id": f"p{page_no:03d}-table-{idx}",
            "type": "table",
            "label": item.get("label") or "table",
            "text": item.get("text") or "",
            "bbox": _normalize_bbox(item),
            "confidence": item.get("confidence"),
            "source": "docling",
            "page_no": page_no,
        })

    for idx, item in enumerate(pictures, start=1):
        blocks.append({
            "id": f"p{page_no:03d}-picture-{idx}",
            "type": "picture",
            "label": item.get("label") or "picture",
            "text": item.get("caption") or "",
            "bbox": _normalize_bbox(item),
            "confidence": item.get("confidence"),
            "source": "docling",
            "page_no": page_no,
        })

    for idx, item in enumerate(vectors or [], start=1):
        blocks.append({
            "id": f"p{page_no:03d}-vector-{idx}",
            "type": "vector",
            "label": "vector",
            "text": "",
            "bbox": _normalize_bbox(item),
            "confidence": item.get("confidence"),
            "source": "fitz",
            "page_no": page_no,
        })

    return blocks


def _summarise_page_artifact(page_no: int, texts: list[dict], tables: list[dict], pictures: list[dict], raster_path: Optional[str] = None, vectors: Optional[list[dict]] = None) -> dict:
    text_chars = sum(len(str(t.get("text") or t.get("orig") or "")) for t in texts)
    ocr_chars = 0
    confidence_values: list[float] = []

    for t in texts:
        origin = str(t.get("origin") or t.get("source") or "").lower()
        text_value = str(t.get("text") or t.get("orig") or "")
        if "ocr" in origin:
            ocr_chars += len(text_value)
        conf = t.get("confidence")
        if isinstance(conf, (int, float)) and 0 <= float(conf) <= 1:
            confidence_values.append(float(conf))

    avg_conf = round(sum(confidence_values) / len(confidence_values), 4) if confidence_values else None

    table_cell_count = 0
    for tbl in tables:
        data = tbl.get("data") if isinstance(tbl, dict) else None
        cells = []
        if isinstance(data, dict):
            raw = data.get("table_cells") or data.get("cells") or []
            if isinstance(raw, list):
                cells = raw
        table_cell_count += len(cells)

    return {
        "version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
        "page_no": page_no,
        "text_block_count": len(texts),
        "table_count": len(tables),
        "table_cell_count": table_cell_count,
        "picture_count": len(pictures),
        "vector_count": len(vectors or []),
        "text_chars": text_chars,
        "ocr_chars": ocr_chars,
        "avg_text_confidence": avg_conf,
        "has_raster": bool(raster_path),
        "has_tables": len(tables) > 0,
        "has_pictures": len(pictures) > 0,
        "has_vectors": bool(vectors),
    }


def _build_per_page_docling_artifacts(
    docling_doc: dict,
    *,
    job_id: str,
    global_page_offset: int = 0,
    raster_manifest: Optional[dict] = None,
) -> dict:
    """Build per-page Docling artifacts in memory.

    For chunked parsing, `global_page_offset` rebases chunk-local page numbers
    into parent-global page numbers using: global = local + offset.
    """
    if not isinstance(docling_doc, dict):
        return {
            "version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
            "page_count": 0,
            "pages": [],
            "artifacts_by_page": {},
            "validation": {"ok": False, "problems": ["docling_doc_not_object"]},
        }

    raw_pages = docling_doc.get("pages") or {}
    artifact_page_numbers = []
    for key in raw_pages:
        try:
            artifact_page_numbers.append(global_page_offset + int(key))
        except (TypeError, ValueError):
            continue
    _enforce_per_page_artifact_quota(artifact_page_numbers)

    texts_all = docling_doc.get("texts") if isinstance(docling_doc.get("texts"), list) else []
    tables_all = docling_doc.get("tables") if isinstance(docling_doc.get("tables"), list) else []
    pictures_all = docling_doc.get("pictures") if isinstance(docling_doc.get("pictures"), list) else []
    vectors_all = docling_doc.get("vectors") if isinstance(docling_doc.get("vectors"), list) else []

    raster_by_global_page: dict[int, str] = {}
    if isinstance(raster_manifest, dict):
        for page in raster_manifest.get("pages") or []:
            if not isinstance(page, dict):
                continue
            try:
                global_no = int(page.get("global_page_no") or page.get("page_no") or 0)
            except Exception:
                continue
            path = page.get("path")
            if global_no > 0 and isinstance(path, str):
                raster_by_global_page[global_no] = path

    manifest_pages: list[dict] = []
    artifacts_by_page: dict[int, dict] = {}
    problems: list[str] = []

    for key, raw_page in sorted((raw_pages or {}).items(), key=lambda kv: int(kv[0]) if str(kv[0]).isdigit() else 0):
        try:
            local_page_no = int(key)
        except Exception:
            problems.append(f"invalid_page_key:{key}")
            continue

        global_page_no = global_page_offset + local_page_no
        if global_page_no <= 0:
            problems.append(f"invalid_global_page_no:{global_page_no}")
            continue

        page_obj = raw_page if isinstance(raw_page, dict) else {}
        page_copy = dict(page_obj)
        page_copy["page_no"] = global_page_no

        page_texts = [dict(t) for t in texts_all if _item_belongs_to_page(t, local_page_no)]
        page_tables = [dict(t) for t in tables_all if _item_belongs_to_page(t, local_page_no)]
        page_pictures = [dict(pic) for pic in pictures_all if _item_belongs_to_page(pic, local_page_no)]
        page_vectors = [dict(v) for v in vectors_all if _item_belongs_to_page(v, local_page_no)]

        def rebase_item(item: dict) -> dict:
            prov = item.get("prov")
            if isinstance(prov, list):
                for p in prov:
                    if isinstance(p, dict) and p.get("page_no") is not None:
                        try:
                            p["page_no"] = global_page_offset + int(p["page_no"])
                        except Exception:
                            pass
            return item

        page_texts = [rebase_item(t) for t in page_texts]
        page_tables = [rebase_item(t) for t in page_tables]
        page_pictures = [rebase_item(pic) for pic in page_pictures]
        page_vectors = [rebase_item(v) for v in page_vectors]

        page_ocr_texts = [
            t for t in page_texts
            if "ocr" in str(t.get("origin") or t.get("source") or "").lower()
        ]

        raster_path = raster_by_global_page.get(global_page_no)
        summary = _summarise_page_artifact(global_page_no, page_texts, page_tables, page_pictures, raster_path, page_vectors)
        blocks = _page_blocks_for_docling_page(global_page_no, page_texts, page_tables, page_pictures, page_vectors)

        page_docling = {
            "version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
            "job_id": job_id,
            "page_no": global_page_no,
            "schema_name": "DoclingDocumentPage",
            "pages": {
                str(global_page_no): page_copy,
            },
            "texts": page_texts,
            "tables": page_tables,
            "pictures": page_pictures,
            "vectors": page_vectors,
            "summary": summary,
        }

        artifacts = {
            "docling": page_docling,
            "blocks": {
                "version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
                "page_no": global_page_no,
                "blocks": blocks,
            },
            "tables": {
                "version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
                "page_no": global_page_no,
                "tables": page_tables,
            },
            # Per-page OCR text so the page-scoped repair loop can inspect OCR
            # output for a single page without loading the whole document.
            "ocr": {
                "version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
                "page_no": global_page_no,
                "texts": page_ocr_texts,
                "ocr_text_count": len(page_ocr_texts),
                "has_ocr": len(page_ocr_texts) > 0,
            },
            "pictures": {
                "version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
                "page_no": global_page_no,
                "pictures": page_pictures,
            },
            "vectors": {
                "version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
                "page_no": global_page_no,
                "vectors": page_vectors,
            },
            "summary": summary,
        }

        artifacts_by_page[global_page_no] = artifacts
        manifest_pages.append({
            "page_no": global_page_no,
            "width": page_copy.get("width") or page_copy.get("size", {}).get("width") if isinstance(page_copy.get("size"), dict) else page_copy.get("width"),
            "height": page_copy.get("height") or page_copy.get("size", {}).get("height") if isinstance(page_copy.get("size"), dict) else page_copy.get("height"),
            "raster_path": raster_path,
            "source_chunk_page_no": local_page_no,
        })

    manifest_pages.sort(key=lambda page: page["page_no"])
    page_numbers = [int(page["page_no"]) for page in manifest_pages]
    expected = list(range(min(page_numbers), max(page_numbers) + 1)) if page_numbers else []
    if page_numbers and page_numbers != expected:
        problems.append("page_numbers_not_continuous")
    if len(set(page_numbers)) != len(page_numbers):
        problems.append("duplicate_page_numbers")

    return {
        "version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
        "job_id": job_id,
        "page_count": len(manifest_pages),
        "pages": manifest_pages,
        "artifacts_by_page": artifacts_by_page,
        "validation": {
            "ok": len(problems) == 0,
            "problems": problems,
        },
    }


def _do_raster(pdf_bytes: bytes, *, dpi: int, fmt: str, pages: Optional[list[int]] = None) -> dict:
    t0 = time.monotonic()
    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
    except Exception as exc:
        raise SidecarError(400, "raster_pdf_open_failed", f"Could not open PDF for rastering: {exc}") from exc
    total = len(pdf)
    page_indices = [p - 1 for p in pages if 1 <= p <= total] if pages else list(range(total))
    scale = dpi / 72.0
    images: list[dict] = []
    for idx in page_indices:
        page = pdf[idx]
        try:
            bitmap = page.render(scale=scale)
            pil_img = bitmap.to_pil()
        except Exception as exc:
            raise SidecarError(500, "raster_page_failed", f"Could not raster page {idx + 1}: {exc}", retryable=True) from exc
        buf = io.BytesIO()
        if fmt == "jpeg":
            pil_img.convert("RGB").save(buf, format="JPEG", quality=88, optimize=True)
            mime = "image/jpeg"
        else:
            pil_img.save(buf, format="PNG", optimize=True)
            mime = "image/png"
        images.append({
            "page_no": idx + 1,
            "mime": mime,
            "width_px": pil_img.width,
            "height_px": pil_img.height,
            "base64": base64.b64encode(buf.getvalue()).decode("ascii"),
        })
    raster_ms = int((time.monotonic() - t0) * 1000)
    LOG.info("Rasterised %d pages @ %d DPI in %d ms", len(images), dpi, raster_ms)
    return {"engine_version": ENGINE_VERSION, "raster_ms": raster_ms, "dpi": dpi, "format": fmt, "pages": images}


# ---------------------------------------------------------------------------
# Wave F-Option-3 storage upload helpers
# ---------------------------------------------------------------------------
def _ocr_ratio(summary: dict, page_count: int) -> float:
    if not page_count:
        return 0.0
    return len(summary.get("ocr_pages") or []) / float(page_count)


# G1 — LANE_ENFORCEMENT_VERSION, LANE_PROFILES and the lane resolver now live in
# the pure, unit-tested `lane_policy` module (imported at the top). `_do_parse`
# and every parse path resolve an EffectiveLanePolicy via `_resolve_policy`.


async def _storage_upload(client: httpx.AsyncClient, object_path: str, body: bytes, content_type: str) -> Optional[str]:
    """Upload a single artifact to the Supabase Storage REST API. Returns the object path on success."""
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        LOG.error("Storage upload skipped — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing")
        return None
    url = f"{SUPABASE_URL}/storage/v1/object/{DIAGNOSTICS_BUCKET}/{object_path}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": content_type,
        "x-upsert": "true",
        "cache-control": "3600",
    }
    try:
        resp = await client.post(url, content=body, headers=headers)
        if resp.status_code >= 300:
            LOG.error("storage upload failed %s: %s", resp.status_code, resp.text[:300])
            return None
        return object_path
    except Exception as exc:
        LOG.error("storage upload exception: %s", exc)
        return None



def _normalize_raster_ext(mime: str) -> str:
    mime = (mime or "image/png").lower()
    if "jpeg" in mime or "jpg" in mime:
        return "jpg"
    return "png"


def _decode_raster_page_bytes(page: dict) -> tuple[bytes, str]:
    raw_b64 = page.get("base64") or page.get("image_base64")
    if not raw_b64:
        raise ValueError("raster page missing base64")
    mime = page.get("mime") or "image/png"
    return base64.b64decode(raw_b64), mime


async def _upload_raster_manifest_artifacts(
    client: httpx.AsyncClient,
    prefix: str,
    raster_result: dict,
    *,
    global_page_offset: int = 0,
) -> dict:
    page_raster_paths: list[str] = []
    manifest_pages: list[dict] = []
    total_bytes = 0

    pages = raster_result.get("pages") or []
    dpi = raster_result.get("dpi")
    fmt = (raster_result.get("format") or RASTER_FORMAT or "png").lower()

    for page in pages:
        try:
            page_no = int(page.get("page_no") or 0)
            if page_no <= 0:
                continue

            data, mime = _decode_raster_page_bytes(page)
            ext = _normalize_raster_ext(mime)
            object_path = f"{prefix}/pages/page-{page_no:03d}.{ext}"

            uploaded_path = await _storage_upload(client, object_path, data, mime)
            if not uploaded_path:
                LOG.error("Page raster upload failed page=%s path=%s", page_no, object_path)
                continue

            byte_count = len(data)
            total_bytes += byte_count
            page_raster_paths.append(uploaded_path)

            manifest_pages.append({
                "page_no": page_no,
                "global_page_no": global_page_offset + page_no,
                "width": page.get("width_px") or page.get("width"),
                "height": page.get("height_px") or page.get("height"),
                "path": uploaded_path,
                "mime": mime,
                "bytes": byte_count,
            })

            LOG.info("Uploaded page raster page=%s path=%s bytes=%s", page_no, uploaded_path, byte_count)
        except Exception as exc:
            LOG.error("Failed to upload raster page: %s", exc)

    manifest = {
        "version": "phase3-raster-manifest-v1",
        "format": fmt,
        "dpi": dpi,
        "page_count": len(manifest_pages),
        "pages": manifest_pages,
    }

    manifest_body = json.dumps(manifest).encode("utf-8")
    manifest_path = await _storage_upload(
        client,
        f"{prefix}/rasters-manifest.json",
        manifest_body,
        "application/json",
    )
    total_bytes += len(manifest_body)

    LOG.info("Uploaded raster manifest path=%s pages=%s", manifest_path, len(page_raster_paths))

    return {
        "rasters_manifest_path": manifest_path,
        "page_raster_paths": page_raster_paths,
        "manifest": manifest,
        "bytes_out": total_bytes,
    }


async def _upload_per_page_docling_artifacts(
    client: httpx.AsyncClient,
    prefix: str,
    per_page_payload: dict,
    *,
    source: str = "cloud-run-sidecar",
    source_scene: Optional[dict] = None,
) -> dict:
    """Upload per-page Docling artifacts and a pages-manifest.json file.

    When `source_scene` (E1) is present and not skipped, the manifest is enriched
    ADDITIVELY to `pdf-page-artifact-contract-v3`: per-page regions/spans/foreground
    paths + region-crop map + counts, and top-level scene-graph version + totals.
    Without it the manifest stays byte-compatible with V2 consumers.
    """
    manifest_pages: list[dict] = []
    bytes_out = 0
    scene_pages_by_no: dict[int, dict] = {}
    scene_active = bool(source_scene) and not source_scene.get("skipped")
    if scene_active:
        for sp in source_scene.get("pages") or []:
            try:
                scene_pages_by_no[int(sp.get("page_no") or 0)] = sp
            except Exception:
                continue

    artifacts_by_page = per_page_payload.get("artifacts_by_page") or {}
    pages = per_page_payload.get("pages") or []
    validation = per_page_payload.get("validation") or {"ok": False, "problems": ["missing_validation"]}

    artifact_page_numbers = []
    for page in pages:
        try:
            artifact_page_numbers.append(int(page.get("page_no") or 0))
        except (AttributeError, TypeError, ValueError):
            continue
    _enforce_per_page_artifact_quota(artifact_page_numbers)

    for page in pages:
        try:
            page_no = int(page.get("page_no") or 0)
            if page_no <= 0:
                continue

            page_key = page_no
            artifacts = artifacts_by_page.get(page_key) or artifacts_by_page.get(str(page_key)) or {}
            if not artifacts:
                LOG.error("Missing per-page artifacts for page=%s prefix=%s", page_no, prefix)
                continue

            page_prefix = f"{prefix}/pages/page-{page_no:03d}"

            docling_body = json.dumps(artifacts.get("docling") or {}).encode("utf-8")
            blocks_body = json.dumps(artifacts.get("blocks") or {}).encode("utf-8")
            tables_body = json.dumps(artifacts.get("tables") or {}).encode("utf-8")
            ocr_body = json.dumps(artifacts.get("ocr") or {}).encode("utf-8")
            pictures_body = json.dumps(artifacts.get("pictures") or {}).encode("utf-8")
            vectors_body = json.dumps(artifacts.get("vectors") or {}).encode("utf-8")
            summary_body = json.dumps(artifacts.get("summary") or {}).encode("utf-8")

            docling_path = await _storage_upload(client, f"{page_prefix}/docling.json", docling_body, "application/json")
            blocks_path = await _storage_upload(client, f"{page_prefix}/blocks.json", blocks_body, "application/json")
            tables_path = await _storage_upload(client, f"{page_prefix}/tables.json", tables_body, "application/json")
            ocr_path = await _storage_upload(client, f"{page_prefix}/ocr.json", ocr_body, "application/json")
            pictures_path = await _storage_upload(client, f"{page_prefix}/pictures.json", pictures_body, "application/json")
            vectors_path = await _storage_upload(client, f"{page_prefix}/vectors.json", vectors_body, "application/json")
            summary_path = await _storage_upload(client, f"{page_prefix}/summary.json", summary_body, "application/json")

            bytes_out += (
                len(docling_body)
                + len(blocks_body)
                + len(tables_body)
                + len(ocr_body)
                + len(pictures_body)
                + len(vectors_body)
                + len(summary_body)
            )

            entry = {
                "page_no": page_no,
                "width": page.get("width"),
                "height": page.get("height"),
                "docling_path": docling_path,
                "blocks_path": blocks_path,
                "tables_path": tables_path,
                "ocr_path": ocr_path,
                "pictures_path": pictures_path,
                "vectors_path": vectors_path,
                "summary_path": summary_path,
                "raster_path": page.get("raster_path"),
                "source_chunk_index": page.get("source_chunk_index"),
                "source_chunk_page_no": page.get("source_chunk_page_no"),
            }
            sp = scene_pages_by_no.get(page_no)
            if sp:
                # E1 — additive V3 fields for this page.
                entry.update({
                    "source_path": sp.get("source_path") or page.get("raster_path"),
                    "source_sha256": sp.get("source_sha256"),
                    "regions_path": sp.get("regions_path"),
                    "source_spans_path": sp.get("source_spans_path"),
                    "foreground_path": sp.get("foreground_path"),
                    "region_crop_paths": sp.get("region_crop_paths") or {},
                    "region_count": sp.get("region_count") or 0,
                    "critical_region_count": sp.get("critical_region_count") or 0,
                    "chart_region_count": sp.get("chart_region_count") or 0,
                    "table_region_count": sp.get("table_region_count") or 0,
                    "table_candidates_path": sp.get("table_candidates_path"),
                    "table_arbitration_path": sp.get("table_arbitration_path"),
                    "typography_run_count": sp.get("typography_run_count") or 0,
                    "unmapped_glyph_count": sp.get("unmapped_glyph_count") or 0,
                    "typography_path": sp.get("typography_path"),
                    "scene_graph_version": sp.get("scene_graph_version"),
                    "complete": bool(sp.get("complete")),
                    "problems": sp.get("problems") or [],
                })
            manifest_pages.append(entry)
        except Exception as exc:
            LOG.error("Failed to upload per-page Docling artifacts prefix=%s page=%s error=%s", prefix, page, exc)

    manifest_pages.sort(key=lambda page: int(page.get("page_no") or 0))

    manifest = {
        "version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
        "job_id": per_page_payload.get("job_id"),
        "source": source,
        "page_count": len(manifest_pages),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pages": manifest_pages,
        "validation": validation,
    }
    if scene_active:
        manifest.update({
            "artifact_contract_version": ssg.PAGE_ARTIFACT_CONTRACT_VERSION,
            "scene_graph_version": source_scene.get("source_scene_graph_version"),
            "chart_preservation_version": source_scene.get("chart_preservation_version"),
            "table_candidate_contract_version": source_scene.get("table_candidate_contract_version"),
            "table_arbitration_version": source_scene.get("table_arbitration_version"),
            "table_preservation_version": source_scene.get("table_preservation_version"),
            "source_scene_path": source_scene.get("source_scene_path"),
            "total_region_count": source_scene.get("total_region_count") or 0,
            "total_critical_region_count": source_scene.get("total_critical_region_count") or 0,
            "total_crop_count": source_scene.get("total_crop_count") or 0,
            "total_chart_region_count": source_scene.get("total_chart_region_count") or 0,
            "total_chart_crop_rendered_count": source_scene.get("total_chart_crop_rendered_count") or 0,
            "total_table_region_count": source_scene.get("total_table_region_count") or 0,
            "total_native_verified_table_count": source_scene.get("total_native_verified_table_count") or 0,
            "total_source_crop_table_count": source_scene.get("total_source_crop_table_count") or 0,
            "total_blocked_table_count": source_scene.get("total_blocked_table_count") or 0,
            "source_typography_evidence_version": source_scene.get("source_typography_evidence_version"),
            "font_asset_manifest_version": source_scene.get("font_asset_manifest_version"),
            "total_typography_run_count": source_scene.get("total_typography_run_count") or 0,
            "total_unmapped_glyph_count": source_scene.get("total_unmapped_glyph_count") or 0,
            "source_scene_complete": bool(source_scene.get("complete")),
            "source_scene_problems": source_scene.get("problems") or [],
        })

    manifest_body = json.dumps(manifest).encode("utf-8")
    manifest_path = await _storage_upload(
        client,
        f"{prefix}/pages-manifest.json",
        manifest_body,
        "application/json",
    )
    bytes_out += len(manifest_body)

    required_missing = []
    for page in manifest_pages:
        page_no = page.get("page_no")
        for key in ("docling_path", "blocks_path", "summary_path"):
            if not page.get(key):
                required_missing.append(f"page_{page_no}_{key}")

    validation_out = {
        "version": "per-page-docling-validation-v1",
        "ok": bool(validation.get("ok")) and not required_missing and len(manifest_pages) == int(per_page_payload.get("page_count") or len(manifest_pages)),
        "problems": list(validation.get("problems") or []) + required_missing,
    }

    LOG.info(
        "Uploaded per-page Docling artifacts prefix=%s manifest=%s pages=%s ok=%s",
        prefix,
        manifest_path,
        len(manifest_pages),
        validation_out["ok"],
    )

    return {
        "per_page_docling_artifact_version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
        "per_page_docling_manifest_path": manifest_path,
        "per_page_docling_page_count": len(manifest_pages),
        "per_page_docling_validation": validation_out,
        "per_page_docling_manifest": manifest,
        "bytes_out": bytes_out,
    }


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _render_page_bitmap(pdf: "pdfium.PdfDocument", local_index: int, dpi: int):
    """Render one (0-based local) PDF page to a PIL RGB image at `dpi`. Returns None
    on failure so a single bad page never aborts the source-scene pass."""
    try:
        page = pdf[local_index]
        bitmap = page.render(scale=dpi / 72.0)
        return bitmap.to_pil().convert("RGB")
    except Exception as exc:  # pragma: no cover — defensive
        LOG.warning("source-scene page render failed local_index=%s: %s", local_index, exc)
        return None


def _png_bytes(pil_img) -> bytes:
    buf = io.BytesIO()
    # optimize=False keeps the encoder deterministic (stable crop SHA-256).
    pil_img.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


async def _build_table_arbitration(
    client: httpx.AsyncClient,
    page_prefix: str,
    global_page_no: int,
    regions: list[dict],
    spans: list[dict],
    vectors: list[dict],
    source_raster: dict,
) -> tuple[dict, Optional[str], Optional[str]]:
    """E4 — build source table evidence + the primary candidate + integrity +
    arbitration + preservation plan for every table region on a page, and upload
    the private `table-candidates.json` / `table-arbitration.json` artifacts.

    Never raises: a failure here degrades to an empty (E0-protected) plan so a
    bad table can never abort the source-scene pass. No alternate conversions run
    in the primary parse (bounded-candidate policy); alternate vNext/PyMuPDF
    candidates are a later, budgeted step. Source truth is never rewritten."""
    empty = {"version": tinteg.TABLE_PRESERVATION_VERSION, "tables": [], "metrics": {}, "problems": [], "complete": True}
    try:
        table_regions = [r for r in regions if r.get("type") == "table"]
        if not table_regions:
            return empty, None, None
        arbitrations: dict[str, dict] = {}
        candidates_out: list[dict] = []
        arb_out: list[dict] = []
        raster_available = bool(source_raster.get("path"))
        for treg in table_regions:
            evidence = tcand.build_source_table_evidence(
                region=treg, page_spans=spans, page_vectors=vectors,
                adjacent_source_table_region_ids=[o["id"] for o in table_regions if o["id"] != treg["id"]],
            )
            financial = tinteg.is_financial_table(evidence)
            profile = {"runtimeProfile": os.environ.get("DOCLING_RUNTIME_PROFILE", "legacy"),
                       "tableMode": None, "cellMatching": None}
            primary = tcand.candidate_from_source_topology(region=treg, provider="docling-primary", profile=profile)
            cands = [c for c in [primary] if c is not None and tcand.candidate_json_within_budget(c)]
            # Budget: never exceed the per-table candidate cap.
            if len(cands) > tcand.MAX_TABLE_CANDIDATES_PER_TABLE:
                cands = cands[:tcand.MAX_TABLE_CANDIDATES_PER_TABLE]
            reports: list[dict] = []
            for c in cands:
                rep = tinteg.evaluate_table_integrity(c, evidence, financial=financial)
                merge_defect = tinteg.detect_adjacent_merge(c, table_regions)
                if merge_defect:
                    rep["hardDefects"].append(merge_defect)
                    rep["state"] = "rejected"
                    rep["score"] = None
                reports.append(rep)
            arb = tinteg.arbitrate_table_candidates(
                source_region_id=treg["id"], candidates=cands, reports=reports,
                source_crop_available=bool((treg.get("sourceCrop") or {}).get("path")),
                page_raster_available=raster_available, financial=financial,
            )
            arbitrations[treg["id"]] = arb
            candidates_out.append({"sourceRegionId": treg["id"], "financial": financial, "candidates": cands})
            arb_out.append(arb)

        plan = tinteg.build_table_preservation_plan(regions=regions, arbitrations=arbitrations)

        candidates_path = None
        arb_path = None
        if candidates_out:
            body = json.dumps({"version": tcand.TABLE_CANDIDATE_CONTRACT_VERSION,
                               "page_no": global_page_no, "tables": candidates_out}).encode("utf-8")
            candidates_path = await _storage_upload(client, f"{page_prefix}/table-candidates.json", body, "application/json")
        if arb_out:
            body = json.dumps({"version": tinteg.TABLE_ARBITRATION_VERSION,
                               "page_no": global_page_no, "arbitrations": arb_out}).encode("utf-8")
            arb_path = await _storage_upload(client, f"{page_prefix}/table-arbitration.json", body, "application/json")
        return plan, candidates_path, arb_path
    except Exception as exc:  # pragma: no cover — defensive; E0 protects the page
        LOG.warning("E4 table arbitration failed page=%s: %s", global_page_no, exc)
        return {**empty, "problems": ["table_arbitration_failed"]}, None, None


async def _build_and_upload_source_scene_artifacts(
    client: httpx.AsyncClient,
    prefix: str,
    pdf_bytes: bytes,
    per_page_payload: dict,
    raster_manifest: Optional[dict],
    *,
    source_sha256: Optional[str],
    lane_policy_version: Optional[str],
    source_chunk: Optional[dict] = None,
    crop_dpi: int = SOURCE_SCENE_CROP_DPI,
) -> dict:
    """E1 — assemble + upload Source Scene Graph V2 artifacts (additive over V2).

    Per page: build regions + spans from the per-page Docling evidence, render an
    exact source crop for every critical visual region from the ORIGINAL PDF (not
    the reconstruction), compute a bounded foreground summary, and upload
    `regions.json`, `source-spans.json`, `foreground.json` and `regions/<id>.png`.
    Then assemble + upload a compact document `source-scene.json`. Never raises —
    a failure marks the scene incomplete so E0 page-level fallback still applies.
    """
    if not ENABLE_SOURCE_SCENE_GRAPH:
        return {"skipped": True, "reason": "disabled"}

    artifacts_by_page = per_page_payload.get("artifacts_by_page") or {}
    pages = per_page_payload.get("pages") or []
    raster_by_global: dict[int, dict] = {}
    manifest_dpi = None
    if isinstance(raster_manifest, dict):
        manifest_dpi = raster_manifest.get("dpi")
        for rp in raster_manifest.get("pages") or []:
            if not isinstance(rp, dict):
                continue
            try:
                gno = int(rp.get("global_page_no") or rp.get("page_no") or 0)
            except Exception:
                continue
            if gno > 0:
                raster_by_global[gno] = rp

    bytes_out = 0
    v3_pages: list[dict] = []
    page_scenes: list[dict] = []
    total_regions = 0
    total_critical = 0
    total_crops = 0
    total_chart_regions = 0
    total_chart_crop_rendered = 0
    total_table_regions = 0
    total_native_verified_tables = 0
    total_source_crop_tables = 0
    total_blocked_tables = 0
    total_typography_runs = 0
    total_unmapped_glyphs = 0
    problems: list[str] = []

    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
    except Exception as exc:
        LOG.warning("source-scene: could not open PDF: %s", exc)
        return {"skipped": True, "reason": "pdf_open_failed", "problems": [str(exc)[:120]]}

    try:
        for page in pages:
            try:
                global_page_no = int(page.get("page_no") or 0)
            except Exception:
                continue
            if global_page_no <= 0:
                continue
            local_page_no = int(page.get("source_chunk_page_no") or global_page_no)
            page_id = f"docling-page-{global_page_no}"
            artifacts = artifacts_by_page.get(global_page_no) or artifacts_by_page.get(str(global_page_no)) or {}
            docling = artifacts.get("docling") or {}
            texts = docling.get("texts") or []
            tables = docling.get("tables") or []
            pictures = docling.get("pictures") or []
            vectors = docling.get("vectors") or []

            width_pt = float(page.get("width") or 0.0) or _mediabox_pt(pdf, local_page_no - 1, 0)
            height_pt = float(page.get("height") or 0.0) or _mediabox_pt(pdf, local_page_no - 1, 1)

            regions, page_problems = ssg.build_page_regions(
                global_page=global_page_no, page_id=page_id,
                page_width=width_pt, page_height=height_pt,
                texts=texts, tables=tables, pictures=pictures, vectors=vectors,
            )
            spans, span_problems = ssg.build_source_spans(
                texts, global_page=global_page_no, page_width=width_pt, page_height=height_pt,
            )

            page_prefix = f"{prefix}/pages/page-{global_page_no:03d}"
            region_crop_paths: dict[str, str] = {}
            page_bitmap = None  # rendered lazily only when a crop is needed
            crop_count = 0

            # E3 — charts are SOURCE TRUTH: render this page at a >=300 DPI floor
            # when it carries any chart region so the preserved chart crop stays
            # sharp even if the page crop DPI was lowered. Deterministic; when the
            # configured crop_dpi is already >=300 (default) this is a no-op.
            has_chart_region = any(r["type"] == "chart" for r in regions)
            effective_crop_dpi = max(crop_dpi, ssg.CHART_CROP_MIN_DPI) if has_chart_region else crop_dpi

            for region in regions:
                if region["type"] not in ssg.CROP_REQUIRED_TYPES:
                    continue
                if crop_count >= ssg.MAX_CROPS_PER_PAGE:
                    page_problems.append("region_crops_truncated")
                    break
                if page_bitmap is None:
                    page_bitmap = _render_page_bitmap(pdf, local_page_no - 1, effective_crop_dpi)
                    if page_bitmap is None:
                        page_problems.append("page_render_failed")
                        break
                px = ssg.crop_bbox_pixels(region["bbox"], height_pt, effective_crop_dpi, ssg.CROP_PADDING_PT, width_pt)
                if not px:
                    region["problems"].append("crop_geometry_invalid")
                    continue
                try:
                    crop_img = page_bitmap.crop((px["left"], px["top"], px["left"] + px["width"], px["top"] + px["height"]))
                    crop_bytes = _png_bytes(crop_img)
                except Exception as exc:  # pragma: no cover — defensive
                    region["problems"].append("crop_render_failed")
                    LOG.warning("crop render failed region=%s: %s", region["id"], exc)
                    continue
                crop_path = f"{page_prefix}/regions/{region['id']}.png"
                uploaded = await _storage_upload(client, crop_path, crop_bytes, "image/png")
                if not uploaded:
                    region["problems"].append("crop_upload_failed")
                    continue
                foreground = ssg.build_foreground_summary(crop_bytes)
                ssg.attach_crop(
                    region, path=crop_path, sha256=_sha256_hex(crop_bytes), mime="image/png",
                    width_px=crop_img.width, height_px=crop_img.height, source_dpi=effective_crop_dpi,
                    padding_pt=ssg.CROP_PADDING_PT, foreground=foreground,
                )
                if region["sourceCrop"].get("path"):
                    region_crop_paths[region["id"]] = crop_path
                    crop_count += 1
                    bytes_out += len(crop_bytes)

            # Bounded page foreground summary from the page raster / rendered bitmap.
            page_foreground = None
            if page_bitmap is not None:
                page_foreground = ssg.build_foreground_summary(_png_bytes(page_bitmap))

            regions_body = json.dumps({
                "version": ssg.SOURCE_REGION_VERSION,
                "page_no": global_page_no,
                "regions": regions,
            }).encode("utf-8")
            regions_path = await _storage_upload(client, f"{page_prefix}/regions.json", regions_body, "application/json")
            bytes_out += len(regions_body)

            spans_body = json.dumps({
                "version": "source-spans-v1", "page_no": global_page_no, "spans": spans,
            }).encode("utf-8")
            spans_path = await _storage_upload(client, f"{page_prefix}/source-spans.json", spans_body, "application/json")
            bytes_out += len(spans_body)

            # ── E5 — source typography evidence (additive; never fatal). Builds
            # immutable typography runs from the source spans (raw Unicode +
            # exact punctuation/numeric tokens + source font identity + glyph
            # evidence). The typography fidelity + preservation decision is made
            # by the consumer (typographyFidelity.pure.ts) against these runs;
            # source truth is never rewritten here. ──
            typography_path = None
            typography_run_count = 0
            typography_unmapped_glyphs = 0
            try:
                text_regions = [r for r in regions if r.get("type") == "text"]
                typo_runs, typo_problems = stypo.build_page_typography(
                    global_page=global_page_no, page_id=page_id, spans=spans, text_regions=text_regions,
                )
                typography_run_count = len(typo_runs)
                typography_unmapped_glyphs = sum(int(r.get("unmappedGlyphCount") or 0) for r in typo_runs)
                typo_body = json.dumps({
                    "version": stypo.SOURCE_TYPOGRAPHY_EVIDENCE_VERSION,
                    "page_no": global_page_no, "runs": typo_runs, "problems": typo_problems,
                }).encode("utf-8")
                typography_path = await _storage_upload(
                    client, f"{page_prefix}/source-typography.json", typo_body, "application/json")
                bytes_out += len(typo_body)
            except Exception as exc:  # pragma: no cover — defensive; E0 protects the page
                LOG.warning("E5 typography evidence failed page=%s: %s", global_page_no, exc)

            foreground_path = None
            if page_foreground is not None:
                fg_body = json.dumps(page_foreground).encode("utf-8")
                foreground_path = await _storage_upload(client, f"{page_prefix}/foreground.json", fg_body, "application/json")
                bytes_out += len(fg_body)

            raster_info = raster_by_global.get(global_page_no) or {}
            source_raster = {
                "path": raster_info.get("path") or page.get("raster_path"),
                "sha256": None,
                "widthPx": raster_info.get("width"),
                "heightPx": raster_info.get("height"),
                "dpi": manifest_dpi,
                "mime": raster_info.get("mime") or ("image/png" if (raster_info.get("path") or page.get("raster_path")) else None),
            }

            chunk_meta = None
            if source_chunk is not None:
                chunk_meta = {**source_chunk, "localPageNumber": local_page_no, "parentPageNumber": global_page_no}

            # ── E4 — table candidate arbitration + preservation (additive; never
            # fatal). Builds source evidence + the primary candidate from the E1
            # topology, evaluates integrity, arbitrates the strongest SAFE
            # candidate (else source crop / E0 fallback) and produces a table
            # preservation plan. Alternate vNext/PyMuPDF candidates are gated
            # behind budgets/runtime and are NOT generated here (no extra
            # conversions in the primary parse). Source truth is never rewritten. ──
            table_plan, table_candidates_path, table_arb_path = await _build_table_arbitration(
                client, page_prefix, global_page_no, regions, spans, vectors, source_raster,
            )
            page_table_metrics = table_plan.get("metrics") or {}

            page_scene = ssg.assemble_page_scene(
                global_page=global_page_no, page_id=page_id,
                width_pt=width_pt, height_pt=height_pt, rotation=0,
                regions=regions, source_raster=source_raster, foreground=page_foreground,
                regions_path=regions_path or f"{page_prefix}/regions.json",
                source_spans_path=spans_path, source_chunk=chunk_meta,
                problems=page_problems + span_problems,
            )
            # Attach the E4 table preservation plan additively (never changes E0/E3
            # page completeness — E0 still owns the page-level fallback decision).
            page_scene["tablePreservation"] = table_plan
            page_scene["tableRegionCount"] = int(page_table_metrics.get("tableRegionCount") or 0)
            # E5 — additive typography counts on the page scene.
            page_scene["typographyRunCount"] = typography_run_count
            page_scene["unmappedGlyphCount"] = typography_unmapped_glyphs
            page_scenes.append(page_scene)

            critical = [r for r in regions if r["type"] in ssg.CROP_REQUIRED_TYPES]
            # E3 — chart preservation plan (built by assemble_page_scene from the
            # crop-attached regions); surface its counts additively per page.
            chart_plan = page_scene.get("chartPreservation") or {}
            chart_metrics = chart_plan.get("metrics") or {}
            chart_region_count = int(chart_metrics.get("chartRegionCount") or 0)
            total_regions += len(regions)
            total_critical += len(critical)
            total_crops += len(region_crop_paths)
            total_chart_regions += chart_region_count
            total_chart_crop_rendered += int((chart_metrics.get("chartRenderModeCounts") or {}).get("chart-crop") or 0)
            # E4 — additive table preservation counts.
            table_region_count = int(page_table_metrics.get("tableRegionCount") or 0)
            total_table_regions += table_region_count
            total_native_verified_tables += int(page_table_metrics.get("nativeVerifiedTableCount") or 0)
            total_source_crop_tables += int(page_table_metrics.get("sourceCropTableCount") or 0)
            total_blocked_tables += int(page_table_metrics.get("blockedTableCount") or 0)
            total_typography_runs += typography_run_count
            total_unmapped_glyphs += typography_unmapped_glyphs
            v3_pages.append({
                "page_no": global_page_no,
                "page_id": page_id,
                "width": width_pt,
                "height": height_pt,
                "source_path": source_raster["path"],
                "source_sha256": source_raster["sha256"],
                "regions_path": regions_path,
                "source_spans_path": spans_path,
                "foreground_path": foreground_path,
                "region_crop_paths": region_crop_paths,
                "region_count": len(regions),
                "critical_region_count": len(critical),
                "chart_region_count": chart_region_count,
                "chart_preservation": chart_plan,
                "table_region_count": table_region_count,
                "table_preservation": table_plan,
                "table_candidates_path": table_candidates_path,
                "table_arbitration_path": table_arb_path,
                "table_candidate_contract_version": tcand.TABLE_CANDIDATE_CONTRACT_VERSION,
                "table_arbitration_version": tinteg.TABLE_ARBITRATION_VERSION,
                "table_preservation_version": tinteg.TABLE_PRESERVATION_VERSION,
                "typography_run_count": typography_run_count,
                "unmapped_glyph_count": typography_unmapped_glyphs,
                "typography_path": typography_path,
                "source_typography_evidence_version": stypo.SOURCE_TYPOGRAPHY_EVIDENCE_VERSION,
                "scene_graph_version": ssg.SOURCE_SCENE_GRAPH_VERSION,
                "source_chunk_index": (source_chunk or {}).get("chunkIndex"),
                "source_chunk_page_no": local_page_no,
                "complete": bool(page_scene.get("complete")),
                "problems": page_scene.get("problems") or [],
            })
    finally:
        try:
            pdf.close()
        except Exception:
            pass

    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    scene_graph = ssg.assemble_scene_graph(
        source_sha256=source_sha256,
        page_count=int(per_page_payload.get("page_count") or len(page_scenes)),
        page_scenes=page_scenes,
        engine="docling", engine_version=ENGINE_VERSION,
        lane_policy_version=lane_policy_version, generated_at=generated_at,
    )
    scene_body = json.dumps(scene_graph).encode("utf-8")
    scene_path = await _storage_upload(client, f"{prefix}/source-scene.json", scene_body, "application/json")
    bytes_out += len(scene_body)
    problems.extend(scene_graph.get("problems") or [])

    return {
        "source_scene_graph_version": ssg.SOURCE_SCENE_GRAPH_VERSION,
        "artifact_contract_version": ssg.PAGE_ARTIFACT_CONTRACT_VERSION,
        "chart_preservation_version": ssg.CHART_PRESERVATION_VERSION,
        "table_candidate_contract_version": tcand.TABLE_CANDIDATE_CONTRACT_VERSION,
        "table_arbitration_version": tinteg.TABLE_ARBITRATION_VERSION,
        "table_preservation_version": tinteg.TABLE_PRESERVATION_VERSION,
        "source_typography_evidence_version": stypo.SOURCE_TYPOGRAPHY_EVIDENCE_VERSION,
        "font_asset_manifest_version": fassets.FONT_ASSET_MANIFEST_VERSION,
        "source_scene_path": scene_path,
        "pages": v3_pages,
        "total_region_count": total_regions,
        "total_critical_region_count": total_critical,
        "total_crop_count": total_crops,
        "total_chart_region_count": total_chart_regions,
        "total_chart_crop_rendered_count": total_chart_crop_rendered,
        "total_table_region_count": total_table_regions,
        "total_native_verified_table_count": total_native_verified_tables,
        "total_source_crop_table_count": total_source_crop_tables,
        "total_blocked_table_count": total_blocked_tables,
        "total_typography_run_count": total_typography_runs,
        "total_unmapped_glyph_count": total_unmapped_glyphs,
        "complete": bool(scene_graph.get("complete")),
        "problems": problems,
        "bytes_out": bytes_out,
    }


def _mediabox_pt(pdf: "pdfium.PdfDocument", local_index: int, axis: int) -> float:
    """Fallback page dimension (0=width, 1=height) in PDF points from pdfium."""
    try:
        size = pdf[local_index].get_size()
        return float(size[axis])
    except Exception:
        return 0.0


def _parse_data_uri(uri: str) -> Optional[tuple[str, bytes, str]]:
    m = re.match(r"^data:([^;,]+);base64,(.+)$", uri or "")
    if not m:
        return None
    mime = m.group(1)
    try:
        data = base64.b64decode(m.group(2))
    except Exception:
        return None
    ext = "jpg" if "jpeg" in mime else ("png" if "png" in mime else "")
    if not ext:
        return None
    return mime, data, ext


async def _upload_picture_assets(client: httpx.AsyncClient, job_id: str, doclingDoc: dict) -> int:
    pictures = doclingDoc.get("pictures") if isinstance(doclingDoc, dict) else None
    if not isinstance(pictures, list):
        return 0
    total = 0
    for i, pic in enumerate(pictures):
        image = pic.get("image") if isinstance(pic, dict) else None
        uri = image.get("uri") if isinstance(image, dict) else None
        parsed = _parse_data_uri(uri) if isinstance(uri, str) else None
        if not parsed:
            continue
        mime, data, ext = parsed
        path = f"{job_id}/images/picture-{i+1}.{ext}"
        ok = await _storage_upload(client, path, data, mime)
        if ok:
            image["diagnostics_path"] = path
            total += len(data)
    return total


async def _post_callback(client: httpx.AsyncClient, callback_url: str, callback_token: str, job_id: str, payload: dict) -> tuple[int, Optional[int]]:
    """POST the callback. Returns (attempt_count, completed_attempt_ms) so the
    caller can log the ACTUAL callback-attempt duration AFTER delivery — the
    payload itself never claims to contain the duration of its own delivery (G2)."""
    headers = {
        "Authorization": f"Bearer {callback_token}",
        "Content-Type": "application/json",
        "X-Request-Id": job_id,
    }
    started = time.monotonic()
    try:
        resp = await client.post(callback_url, json=payload, headers=headers, timeout=30)
        if resp.status_code >= 300:
            LOG.error("callback POST failed %s: %s", resp.status_code, resp.text[:500])
    except Exception as exc:
        LOG.error("callback POST exception: %s", exc)
    return 1, int((time.monotonic() - started) * 1000)


async def _run_async_job(req: ParseRequest) -> None:
    """Background task: parse + optional raster, upload artifacts, POST callback."""
    job_id = req.job_id or "unknown"
    callback_url = req.callback_url or ""
    callback_token = req.callback_token or ""
    started = time.monotonic()
    bytes_in = 0
    bytes_out = 0
    cloud_run_ms = 0
    # G2 — operational metrics accumulator, initialized before source resolution
    # so a failure at any phase still produces truthful partial metrics.
    metrics = OperationalMetricsAccumulator(
        "monolithic",
        clock=time.monotonic,
        engine_version=ENGINE_VERSION,
        lane_enforcement_version=LANE_ENFORCEMENT_VERSION,
        job_id=job_id,
        source_input_kind=("base64" if req.pdf_base64 else "url"),
    )
    try:
        pdf_bytes = await _resolve_source_timed(metrics, req.url, req.pdf_base64)
        bytes_in = len(pdf_bytes)

        policy = _resolve_policy(
            req.extractor_lane, req.mode,
            enable_picture_description=req.enable_picture_description,
            include_doctags=req.include_doctags,
            include_markdown=req.include_markdown,
        )
        lane_policy = policy.as_dict()
        metrics.extractor_lane = policy.lane
        metrics.requested_mode = policy.requested_mode
        metrics.effective_mode = policy.effective_mode
        metrics.memory_profile = policy.memory_profile

        parse_start = metrics.now()
        parse_result = _do_parse(pdf_bytes, policy=policy, redact_pii=req.redact_pii)
        metrics.record_since("parse_ms", parse_start)
        cloud_run_ms += int(parse_result.get("parsed_ms") or 0)

        page_count = int(parse_result.get("page_count") or 0)
        summary = parse_result.get("summary") or {}
        requested_mode = policy.requested_mode
        effective_mode = policy.effective_mode
        # Auto-promote hybrid → pixel_perfect when OCR ratio > 0.3.
        if (
            effective_mode == "hybrid"
            and req.allow_mode_override
            and _ocr_ratio(summary, page_count) > 0.3
        ):
            effective_mode = "pixel_perfect"

        async with httpx.AsyncClient(timeout=120) as client:
            # G2: measure total artifact-upload wall time; subtract the raster
            # compute below so artifact_upload_ms reflects upload, not rasterize.
            upload_start = metrics.now()
            raster_wall_ms = 0.0
            doclingDoc = parse_result.get("docling_document") or {}
            if isinstance(doclingDoc, dict) and summary:
                doclingDoc["summary"] = summary
            picture_bytes = await _upload_picture_assets(client, job_id, doclingDoc)
            bytes_out += picture_bytes

            docling_body = json.dumps(doclingDoc).encode("utf-8")
            docling_path = await _storage_upload(client, f"{job_id}/docling.json", docling_body, "application/json")
            bytes_out += len(docling_body)

            doctags_path = None
            markdown_path = None
            outline_path = None
            if parse_result.get("doctags"):
                body = str(parse_result["doctags"]).encode("utf-8")
                doctags_path = await _storage_upload(client, f"{job_id}/doctags.md", body, "text/markdown")
                bytes_out += len(body)
            if parse_result.get("markdown"):
                body = str(parse_result["markdown"]).encode("utf-8")
                markdown_path = await _storage_upload(client, f"{job_id}/document.md", body, "text/markdown")
                bytes_out += len(body)
            outline = parse_result.get("outline") or []
            if outline:
                body = json.dumps({"outline": outline, "page_languages": parse_result.get("page_languages") or {}}).encode("utf-8")
                outline_path = await _storage_upload(client, f"{job_id}/outline.json", body, "application/json")
                bytes_out += len(body)

            # Raster pass (hybrid / pixel_perfect)
            rasters_path = None
            rasters_manifest_path = None
            page_raster_paths = []
            legacy_rasters_path = None
            raster_manifest_payload = None
            per_page_docling_manifest_path = None
            per_page_docling_page_count = 0
            per_page_docling_validation = {"ok": False, "problems": ["not_generated"]}
            if effective_mode in {"hybrid", "pixel_perfect", "pixel-perfect"} and page_count > 0:
                dpi = policy.resolve_raster_dpi(req.raster_dpi, RASTER_DPI)
                raster_fmt = (req.raster_format or RASTER_FORMAT or "png").lower()
                raster_start = metrics.now()
                raster_result = _do_raster(pdf_bytes, dpi=dpi, fmt=raster_fmt)
                raster_wall_ms = (metrics.now() - raster_start) * 1000
                metrics.record("raster_ms", raster_wall_ms)
                cloud_run_ms += int(raster_result.get("raster_ms") or 0)

                normalized = {
                    "format": raster_result.get("format"),
                    "dpi": raster_result.get("dpi"),
                    "engine_version": raster_result.get("engine_version"),
                    "pages": [
                        {
                            "page_no": page.get("page_no"),
                            "width": page.get("width_px"),
                            "height": page.get("height_px"),
                            "image_base64": page.get("base64"),
                        }
                        for page in raster_result.get("pages") or []
                    ],
                }

                if RASTER_ARTIFACT_MODE == "manifest":
                    raster_artifacts = await _upload_raster_manifest_artifacts(
                        client,
                        job_id,
                        raster_result,
                        global_page_offset=0,
                    )
                    rasters_manifest_path = raster_artifacts.get("rasters_manifest_path")
                    page_raster_paths = raster_artifacts.get("page_raster_paths") or []
                    raster_manifest_payload = raster_artifacts.get("manifest")
                    bytes_out += int(raster_artifacts.get("bytes_out") or 0)

                    if WRITE_LEGACY_RASTERS_JSON:
                        body = json.dumps(normalized).encode("utf-8")
                        legacy_rasters_path = await _storage_upload(client, f"{job_id}/rasters.json", body, "application/json")
                        rasters_path = legacy_rasters_path
                        bytes_out += len(body)
                    else:
                        LOG.info("Legacy rasters.json skipped")
                else:
                    body = json.dumps(normalized).encode("utf-8")
                    rasters_path = await _storage_upload(client, f"{job_id}/rasters.json", body, "application/json")
                    bytes_out += len(body)
            else:
                # No raster pass for this mode/page-count — truthfully not_applicable,
                # never a fabricated 0 (G2).
                metrics.mark("raster_ms", METRICS_NOT_APPLICABLE)

            per_page_start = metrics.now()
            per_page_payload = _build_per_page_docling_artifacts(
                doclingDoc,
                job_id=job_id,
                global_page_offset=0,
                raster_manifest=raster_manifest_payload,
            )
            # E1 — assemble + upload Source Scene Graph V2 (additive; never raises).
            source_scene = await _build_and_upload_source_scene_artifacts(
                client, job_id, pdf_bytes, per_page_payload, raster_manifest_payload,
                source_sha256=_sha256_hex(pdf_bytes),
                lane_policy_version=LANE_ENFORCEMENT_VERSION,
            )
            bytes_out += int(source_scene.get("bytes_out") or 0)
            per_page_artifacts = await _upload_per_page_docling_artifacts(
                client,
                job_id,
                per_page_payload,
                source="monolithic-parse",
                source_scene=source_scene,
            )
            metrics.record_since("per_page_artifact_ms", per_page_start)
            per_page_docling_manifest_path = per_page_artifacts.get("per_page_docling_manifest_path")
            per_page_docling_page_count = int(per_page_artifacts.get("per_page_docling_page_count") or 0)
            per_page_docling_validation = per_page_artifacts.get("per_page_docling_validation") or {"ok": False, "problems": ["missing_validation"]}
            bytes_out += int(per_page_artifacts.get("bytes_out") or 0)

            # G2: total upload-block wall time minus the raster compute = artifact
            # upload time; then finalize counts/bytes and build one canonical metrics
            # object referenced identically at the top level and in result_payload.
            upload_wall_ms = (metrics.now() - upload_start) * 1000
            metrics.record("artifact_upload_ms", max(0.0, upload_wall_ms - raster_wall_ms))
            metrics.set_counts_from_summary(summary, page_count)
            metrics.set_bytes_out(bytes_out)
            metrics_dict = metrics.build("succeeded")

            duration_ms = int((time.monotonic() - started) * 1000)
            attempts, attempt_ms = await _post_callback(client, callback_url, callback_token, job_id, {
                "job_id": job_id,
                "status": "succeeded",
                "engine_version": parse_result.get("engine_version"),
                "page_count": page_count,
                "bytes_in": bytes_in,
                "bytes_out": bytes_out,
                "cloud_run_ms": cloud_run_ms,
                "duration_ms": duration_ms,
                "requested_mode": requested_mode,
                "effective_mode": effective_mode,
                "auto_mode_selected": effective_mode != requested_mode,
                "ocr_page_ratio": _ocr_ratio(summary, page_count),
                "extractor_lane": lane_policy["lane"],
                "lane_enforcement_version": LANE_ENFORCEMENT_VERSION,
                "lane_policy": lane_policy,
                "metrics": metrics_dict,
                "result_payload": {
                    "docling_path": docling_path,
                    "rasters_path": rasters_path,
                    "rasters_manifest_path": rasters_manifest_path,
                    "page_raster_paths": page_raster_paths,
                    "legacy_rasters_path": legacy_rasters_path,
                    "per_page_docling_artifact_version": PER_PAGE_DOCLING_ARTIFACT_VERSION,
                    "per_page_docling_manifest_path": per_page_docling_manifest_path,
                    "per_page_docling_page_count": per_page_docling_page_count,
                    "per_page_docling_validation": per_page_docling_validation,
                    # E1 — Source Scene Graph V2 (additive; absent/skipped for legacy).
                    "source_scene_graph_version": source_scene.get("source_scene_graph_version"),
                    "page_artifact_contract_version": source_scene.get("artifact_contract_version"),
                    "source_scene_path": source_scene.get("source_scene_path"),
                    "source_scene_region_count": source_scene.get("total_region_count"),
                    "source_scene_critical_region_count": source_scene.get("total_critical_region_count"),
                    "source_scene_crop_count": source_scene.get("total_crop_count"),
                    "source_scene_complete": source_scene.get("complete"),
                    "doctags_path": doctags_path,
                    "markdown_path": markdown_path,
                    "outline_path": outline_path,
                    "page_count": page_count,
                    "page_languages": parse_result.get("page_languages") or {},
                    "outline_node_count": len(outline),
                    "summary": summary,
                    "mode": effective_mode,
                    "requested_mode": requested_mode,
                    "auto_mode_selected": effective_mode != requested_mode,
                    "cache_hit": False,
                    "extractor_lane": lane_policy["lane"],
                    "lane_enforcement_version": LANE_ENFORCEMENT_VERSION,
                    "lane_policy": lane_policy,
                    # Same canonical object as the top-level `metrics` field (G2).
                    "metrics": metrics_dict,
                },
            })
            # Log the ACTUAL completed callback-attempt duration after delivery —
            # a value the payload itself can never truthfully contain.
            metrics.set_callback_attempt_count(attempts)
            _log_operational_metrics(metrics_dict, callback_attempt_count=attempts, callback_attempt_ms=attempt_ms)
    except SidecarError as exc:
        LOG.warning("async job failed (sidecar error): %s", exc.message)
        metrics.set_bytes_out(bytes_out)
        failed_metrics = metrics.build("failed")
        async with httpx.AsyncClient(timeout=30) as client:
            attempts, attempt_ms = await _post_callback(client, callback_url, callback_token, job_id, {
                "job_id": job_id,
                "status": "failed",
                "error_code": exc.error_code,
                "message": exc.message,
                "retryable": exc.retryable,
                "metrics": failed_metrics,
            })
        _log_operational_metrics(failed_metrics, callback_attempt_count=attempts, callback_attempt_ms=attempt_ms, error_code=exc.error_code)
    except Exception as exc:
        LOG.exception("async job unhandled failure")
        metrics.set_bytes_out(bytes_out)
        failed_metrics = metrics.build("failed")
        async with httpx.AsyncClient(timeout=30) as client:
            attempts, attempt_ms = await _post_callback(client, callback_url, callback_token, job_id, {
                "job_id": job_id,
                "status": "failed",
                "error_code": "sidecar_async_unhandled",
                "message": str(exc)[:500],
                "retryable": True,
                "metrics": failed_metrics,
            })
        _log_operational_metrics(failed_metrics, callback_attempt_count=attempts, callback_attempt_ms=attempt_ms, error_code="sidecar_async_unhandled")


def _pkg_version(name: str) -> Optional[str]:
    try:
        return importlib_metadata.version(name)
    except Exception:
        return None


def _docling_capabilities() -> dict[str, Any]:
    # G1: expose the full ConverterProfile of each currently-built variant, plus
    # whether each best-effort Docling option actually took effect (support).
    converter_variants = []
    for profile, (_converter, support) in _CONVERTER_VARIANTS.items():
        entry = profile.as_dict()
        entry["support"] = support
        converter_variants.append(entry)

    # Global capability ceilings vs each lane's effective (post-ceiling) policy —
    # the /capabilities consumer must not read an unavailable feature as active.
    global_capabilities = {
        "ocr": GLOBAL_CAPABILITIES.ocr,
        "picture_description": GLOBAL_CAPABILITIES.picture_description,
        "picture_classification": GLOBAL_CAPABILITIES.picture_classification,
        "formula": GLOBAL_CAPABILITIES.formula,
        "code": GLOBAL_CAPABILITIES.code,
        "fitz_layers": GLOBAL_CAPABILITIES.fitz,
    }

    return {
        "version": DOCLING_CAPABILITY_ACTIVATION_VERSION,
        "engine_version": ENGINE_VERSION,
        "lane_policy_version": LANE_ENFORCEMENT_VERSION,
        "packages": {
            "docling": _pkg_version("docling"),
            "docling_core": _pkg_version("docling-core") or _pkg_version("docling_core"),
            "docling_ibm_models": _pkg_version("docling-ibm-models") or _pkg_version("docling_ibm_models"),
            "docling_parse": _pkg_version("docling-parse") or _pkg_version("docling_parse"),
            "pypdfium2": _pkg_version("pypdfium2"),
            "easyocr": _pkg_version("easyocr"),
            "torch": _pkg_version("torch"),
        },
        "runtime": {
            "accelerator_device": ACCEL_DEVICE,
            "accelerator_threads": ACCEL_THREADS,
            "prewarm_on_startup": PREWARM_ON_STARTUP,
            "prewarm_profile": DEFAULT_POLICY.lane,
        },
        "global_capabilities": global_capabilities,
        "ocr": {
            "global_ocr_enabled": GLOBAL_CAPABILITIES.ocr,
            "global_force_full_page_ocr_default": FORCE_FULL_PAGE_OCR,
            "global_ocr_fallback": ENABLE_OCR_FALLBACK,
            "lane_aware_ocr": True,
            "ocr_langs": OCR_LANGS,
            # Language resolution is reported in full: an operator who configures
            # a code EasyOCR cannot build needs to see that it was dropped here,
            # rather than discover it as a failed conversion.
            "ocr_language_resolution": _OCR_LANG_RESOLUTION.as_dict(),
            "ocr_language_contract_version": OCR_LANGUAGE_CONTRACT_VERSION,
            "bitmap_area_threshold": BITMAP_AREA_THRESHOLD,
        },
        "tables": {
            "default_table_mode": TABLE_MODE,
            "cell_matching": True,
            "lane_aware_table_mode": True,
        },
        "pictures": {
            "picture_classification_capable": GLOBAL_CAPABILITIES.picture_classification,
            "picture_description_capable": GLOBAL_CAPABILITIES.picture_description,
            "images_scale": IMAGES_SCALE,
        },
        "enrichment": {
            "formula_capable": GLOBAL_CAPABILITIES.formula,
            "code_capable": GLOBAL_CAPABILITIES.code,
            "support_is_best_effort": True,
        },
        "converter_profile_fields": list(ConverterProfile.__annotations__.keys()),
        "converter_variants": converter_variants,
        "lanes_effective": describe_lane_defaults(GLOBAL_CAPABILITIES),
        "lanes_intent": LANE_PROFILES,
        # G2: self-describing operational-metrics contract (fields, states, and
        # the callback-timing limitation) so consumers/C11 can validate offline.
        "operational_metrics": operational_metrics_capabilities(),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/healthz")
def healthz() -> dict:
    return {
        "ok": True,
        "engine_version": ENGINE_VERSION,
        "lane_enforcement_version": LANE_ENFORCEMENT_VERSION,
        "docling_capability_activation_version": DOCLING_CAPABILITY_ACTIVATION_VERSION,
        "callback_upload_configured": bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY),
    }


@app.get("/")
def root() -> dict:
    return {
        "service": "pdf-parse-service",
        "engine_version": ENGINE_VERSION,
        "lane_enforcement_version": LANE_ENFORCEMENT_VERSION,
        "docling_capability_activation_version": DOCLING_CAPABILITY_ACTIVATION_VERSION,
    }


@app.get("/capabilities")
def capabilities() -> dict:
    return _docling_capabilities()


@app.post("/parse")
async def parse(req: ParseRequest, background_tasks: BackgroundTasks):
    # Wave F-Option-3: callback mode — when callback fields are present, run as
    # background task and return 202 immediately so the edge dispatcher never
    # waits on Docling. Requires storage upload env to be configured.
    if req.callback_url and req.callback_token and req.job_id:
        if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
            raise SidecarError(
                503,
                "callback_upload_not_configured",
                "Callback mode requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on the sidecar.",
                retryable=False,
            )
        background_tasks.add_task(_run_async_job, req)
        return JSONResponse(
            {"accepted": True, "job_id": req.job_id, "engine_version": ENGINE_VERSION, "mode": "callback", "extractor_lane": _normalize_extractor_lane(req.extractor_lane), "lane_enforcement_version": LANE_ENFORCEMENT_VERSION},
            status_code=202,
        )

    # Legacy synchronous mode (backwards compatible). G1: this path now resolves
    # the SAME EffectiveLanePolicy the async path uses — it no longer silently
    # drops force_full_page_ocr / table_mode / do_ocr.
    # G2: synchronous scope — no raster, no artifact upload, no callback; the
    # metrics ride back inline on the response.
    metrics = OperationalMetricsAccumulator(
        "synchronous",
        clock=time.monotonic,
        engine_version=ENGINE_VERSION,
        lane_enforcement_version=LANE_ENFORCEMENT_VERSION,
        request_id=REQUEST_ID.get(),
        source_input_kind=("base64" if req.pdf_base64 else "url"),
    )
    pdf_bytes = await _resolve_source_timed(metrics, req.url, req.pdf_base64)
    policy = _resolve_policy(
        req.extractor_lane, req.mode,
        enable_picture_description=req.enable_picture_description,
        include_doctags=req.include_doctags,
        include_markdown=req.include_markdown,
    )
    metrics.extractor_lane = policy.lane
    metrics.requested_mode = policy.requested_mode
    metrics.effective_mode = policy.effective_mode
    metrics.memory_profile = policy.memory_profile

    parse_start = metrics.now()
    result = _do_parse(pdf_bytes, policy=policy, redact_pii=req.redact_pii)
    metrics.record_since("parse_ms", parse_start)
    # Phases that structurally do not occur on the synchronous path.
    for phase in ("raster_ms", "artifact_upload_ms", "per_page_artifact_ms"):
        metrics.mark(phase, METRICS_NOT_APPLICABLE)
    metrics.set_counts_from_summary(result.get("summary") or {}, int(result.get("page_count") or 0))
    metrics_dict = metrics.build("succeeded")
    result["extractor_lane"] = policy.lane
    result["lane_enforcement_version"] = LANE_ENFORCEMENT_VERSION
    result["lane_policy"] = policy.as_dict()
    result["metrics"] = metrics_dict
    _log_operational_metrics(metrics_dict)
    return result


@app.post("/raster")
async def raster(req: RasterRequest) -> dict:
    pdf_bytes = await _resolve_pdf_bytes(req.url, req.pdf_base64)
    return _do_raster(pdf_bytes, dpi=req.dpi, fmt=req.format, pages=req.pages)


# ---------------------------------------------------------------------------
# Chunked pipeline (Wave G) — additive; legacy /parse path untouched.
# ---------------------------------------------------------------------------
# A 100+ page PDF is too heavy to parse in a single Cloud Run invocation
# (memory + 300s timeout). The dispatcher plans page ranges and fans them out
# to /parse-chunk. Each chunk runs Docling on a small temporary PDF carved out
# with pypdfium2, uploads its artifacts to chunks/<chunk_index>/ in the
# diagnostics bucket, and POSTs to a Supabase chunk-callback edge function.

class PlanRequest(BaseModel):
    url: Optional[str] = None
    pdf_base64: Optional[str] = None
    mode: str = Field(default="hybrid")
    max_chunk_pages: Optional[int] = Field(default=None, ge=1, le=50)
    force_chunking: bool = Field(default=False)


class ChunkRequest(BaseModel):
    job_id: str
    chunk_id: str
    chunk_index: int
    page_start: int = Field(ge=1)
    page_end: int = Field(ge=1)
    url: Optional[str] = None
    pdf_base64: Optional[str] = None
    mode: str = Field(default="semantic")
    extractor_lane: Optional[str] = None
    callback_url: str
    callback_token: str
    enable_picture_description: Optional[bool] = None
    include_doctags: bool = True
    include_markdown: bool = True
    redact_pii: bool = False
    raster_dpi: Optional[int] = Field(default=None, ge=72, le=300)
    raster_format: str = Field(default="png", pattern="^(png|jpeg)$")


def _extract_page_range(pdf_bytes: bytes, page_start: int, page_end: int) -> tuple[bytes, int]:
    """Carve [page_start, page_end] (1-based, inclusive) into a new in-memory PDF.

    Returns (bytes, actual_page_count). Raises SidecarError on out-of-range.
    """
    try:
        src = pdfium.PdfDocument(pdf_bytes)
    except Exception as exc:
        raise SidecarError(400, "source_fetch_error", f"Could not open source PDF: {exc}", retryable=False) from exc
    total = len(src)
    start = max(1, page_start)
    end = min(total, page_end)
    if start > end:
        raise SidecarError(400, "chunk_out_of_range", f"page range {page_start}-{page_end} outside 1-{total}", retryable=False)
    try:
        dst = pdfium.PdfDocument.new()
        dst.import_pages(src, pages=list(range(start - 1, end)))
        buf = io.BytesIO()
        dst.save(buf)
        return buf.getvalue(), (end - start + 1)
    except Exception as exc:
        raise SidecarError(500, "chunk_extract_failed", f"Failed to extract chunk: {exc}", retryable=True) from exc


def _quick_ocr_hint(pdf_bytes: bytes, sample_pages: int = 3) -> dict:
    """Cheap heuristic: sample up to N pages and check if pypdfium can pull text.

    A page with very little extractable text → likely scanned/needs OCR. The
    dispatcher uses this to pick smaller chunk sizes (OCR is ~5× slower).
    """
    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
    except Exception as exc:
        raise SidecarError(400, "source_fetch_error", f"Could not open PDF for planning: {exc}", retryable=False) from exc
    n = len(pdf)
    if n == 0:
        return {"page_count": 0, "ocr_hint": False, "scanned_page_ratio": 0.0}
    sample = min(sample_pages, n)
    # Sample evenly across the document.
    indices = sorted({int(round(i * (n - 1) / max(1, sample - 1))) for i in range(sample)})
    low_text = 0
    for idx in indices:
        try:
            tp = pdf[idx].get_textpage()
            text = tp.get_text_range()
            tp.close()
        except Exception:
            text = ""
        if len((text or "").strip()) < 40:
            low_text += 1
    ratio = low_text / float(len(indices))
    return {
        "page_count": n,
        "scanned_page_ratio": round(ratio, 3),
        "ocr_hint": ratio >= 0.5,
    }


async def _post_chunk_callback(
    callback_url: str,
    callback_token: str,
    job_id: str,
    payload: dict,
) -> tuple[int, Optional[int]]:
    """POST the chunk callback with bounded retry. Returns
    (attempt_count, completed_attempt_ms) so the caller can log the ACTUAL
    delivery duration after the fact — a value the payload can never contain (G2).
    completed_attempt_ms is the wall time of the settling attempt (success or
    permanent 4xx); it is None when every attempt was exhausted without settling."""
    headers = {
        "Authorization": f"Bearer {callback_token}",
        "Content-Type": "application/json",
        "X-Request-Id": job_id,
    }
    # Retry callback up to 3× on transient failures so a flaky edge bounce
    # doesn't leave the dispatcher waiting on a chunk that already finished.
    attempts = 0
    for attempt in range(1, 4):
        attempts = attempt
        attempt_start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(callback_url, json=payload, headers=headers)
                attempt_ms = int((time.monotonic() - attempt_start) * 1000)
                if resp.status_code < 300:
                    return attempts, attempt_ms
                LOG.error("chunk callback failed %s (attempt %d): %s", resp.status_code, attempt, resp.text[:300])
                if resp.status_code < 500 and resp.status_code != 429:
                    return attempts, attempt_ms  # 4xx (not 429) is permanent
        except Exception as exc:
            LOG.error("chunk callback exception (attempt %d): %s", attempt, exc)
        await __import__("asyncio").sleep(2 ** attempt)
    return attempts, None


async def _run_chunk_job(req: ChunkRequest) -> None:
    started = time.monotonic()
    artifacts: dict[str, Optional[str]] = {}
    bytes_in = 0
    bytes_out = 0
    # G2 — chunk-scoped operational metrics; page range + chunk identity carried
    # so C11 can aggregate per-chunk timings into the parent job downstream.
    metrics = OperationalMetricsAccumulator(
        "chunk",
        clock=time.monotonic,
        engine_version=ENGINE_VERSION,
        lane_enforcement_version=LANE_ENFORCEMENT_VERSION,
        job_id=req.job_id,
        chunk_id=req.chunk_id,
        chunk_index=req.chunk_index,
        page_start=req.page_start,
        page_end=req.page_end,
        source_input_kind=("base64" if req.pdf_base64 else "url"),
    )
    try:
        pdf_bytes = await _resolve_source_timed(metrics, req.url, req.pdf_base64)
        bytes_in = len(pdf_bytes)
        chunk_pdf, actual_pages = _extract_page_range(pdf_bytes, req.page_start, req.page_end)

        # G1: chunk behaviour is IDENTICAL to monolithic for the same lane/mode
        # (only the page range + chunk metadata differ) — same resolver, same policy.
        policy = _resolve_policy(
            req.extractor_lane, req.mode,
            enable_picture_description=req.enable_picture_description,
            include_doctags=req.include_doctags,
            include_markdown=req.include_markdown,
        )
        lane_policy = policy.as_dict()
        metrics.extractor_lane = policy.lane
        metrics.requested_mode = policy.requested_mode
        metrics.effective_mode = policy.effective_mode
        metrics.memory_profile = policy.memory_profile

        parse_start = metrics.now()
        parse_result = _do_parse(chunk_pdf, policy=policy, redact_pii=req.redact_pii)
        metrics.record_since("parse_ms", parse_start)

        prefix = f"{req.job_id}/chunks/{req.chunk_index:04d}"
        async with httpx.AsyncClient(timeout=120) as client:
            upload_start = metrics.now()
            raster_wall_ms = 0.0
            doclingDoc = parse_result.get("docling_document") or {}
            raster_manifest_payload = None
            picture_bytes = await _upload_picture_assets(client, f"{req.job_id}/chunks/{req.chunk_index:04d}", doclingDoc)
            bytes_out += picture_bytes

            docling_body = json.dumps(doclingDoc).encode("utf-8")
            artifacts["docling_path"] = await _storage_upload(client, f"{prefix}/docling.json", docling_body, "application/json")
            bytes_out += len(docling_body)
            if parse_result.get("doctags"):
                body = str(parse_result["doctags"]).encode("utf-8")
                artifacts["doctags_path"] = await _storage_upload(client, f"{prefix}/doctags.md", body, "text/markdown")
                bytes_out += len(body)
            if parse_result.get("markdown"):
                body = str(parse_result["markdown"]).encode("utf-8")
                artifacts["markdown_path"] = await _storage_upload(client, f"{prefix}/document.md", body, "text/markdown")
                bytes_out += len(body)
            outline = parse_result.get("outline") or []
            outline_body = json.dumps({
                "outline": outline,
                "page_languages": parse_result.get("page_languages") or {},
            }).encode("utf-8")
            artifacts["outline_path"] = await _storage_upload(client, f"{prefix}/outline.json", outline_body, "application/json")
            bytes_out += len(outline_body)

            # Raster the chunk when the mode or lane policy demands page images.
            mode = policy.effective_mode
            if mode in {"hybrid", "pixel_perfect", "pixel-perfect"}:
                # G1: same DPI resolution as the monolithic path — explicit request
                # → lane floor → process default → mode fallback (lane DPI enforced
                # as a minimum so a weaker dispatcher default can't override it).
                dpi = policy.resolve_raster_dpi(req.raster_dpi, RASTER_DPI)
                try:
                    raster_fmt = (req.raster_format or RASTER_FORMAT or "png").lower()
                    raster_start = metrics.now()
                    raster_result = _do_raster(chunk_pdf, dpi=dpi, fmt=raster_fmt)
                    raster_wall_ms = (metrics.now() - raster_start) * 1000
                    metrics.record("raster_ms", raster_wall_ms)
                    normalized = {
                        "format": raster_result.get("format"),
                        "dpi": raster_result.get("dpi"),
                        "engine_version": raster_result.get("engine_version"),
                        # NOTE: chunk-local page_no — finalizer rebases to global page numbers.
                        "pages": [
                            {
                                "page_no": page.get("page_no"),
                                "global_page_no": req.page_start + int(page.get("page_no", 1)) - 1,
                                "width": page.get("width_px"),
                                "height": page.get("height_px"),
                                "image_base64": page.get("base64"),
                            }
                            for page in raster_result.get("pages") or []
                        ],
                    }

                    if RASTER_ARTIFACT_MODE == "manifest":
                        raster_artifacts = await _upload_raster_manifest_artifacts(
                            client,
                            prefix,
                            raster_result,
                            global_page_offset=req.page_start - 1,
                        )
                        artifacts["rasters_manifest_path"] = raster_artifacts.get("rasters_manifest_path")
                        artifacts["page_raster_paths"] = raster_artifacts.get("page_raster_paths") or []
                        raster_manifest_payload = raster_artifacts.get("manifest")
                        bytes_out += int(raster_artifacts.get("bytes_out") or 0)

                        if WRITE_LEGACY_RASTERS_JSON:
                            raster_body = json.dumps(normalized).encode("utf-8")
                            artifacts["legacy_rasters_path"] = await _storage_upload(
                                client,
                                f"{prefix}/rasters.json",
                                raster_body,
                                "application/json",
                            )
                            artifacts["rasters_path"] = artifacts["legacy_rasters_path"]
                            bytes_out += len(raster_body)
                        else:
                            LOG.info("Legacy chunk rasters.json skipped prefix=%s", prefix)
                    else:
                        raster_body = json.dumps(normalized).encode("utf-8")
                        artifacts["rasters_path"] = await _storage_upload(
                            client,
                            f"{prefix}/rasters.json",
                            raster_body,
                            "application/json",
                        )
                        bytes_out += len(raster_body)
                except SidecarError as exc:
                    LOG.warning("chunk raster failed (continuing): %s", exc.message)
                    # Attempted but did not complete — left not_completed, never fake 0.
            else:
                metrics.mark("raster_ms", METRICS_NOT_APPLICABLE)

            per_page_start = metrics.now()
            per_page_payload = _build_per_page_docling_artifacts(
                doclingDoc,
                job_id=req.job_id,
                global_page_offset=req.page_start - 1,
                raster_manifest=raster_manifest_payload,
            )
            # E1 — chunk-local Source Scene Graph V2. Crops render from the chunk
            # PDF (local page index); region IDs are parent-global (rebased), so
            # the parent-global copy in the callback keeps identical IDs.
            source_scene = await _build_and_upload_source_scene_artifacts(
                client, prefix, chunk_pdf, per_page_payload, raster_manifest_payload,
                source_sha256=_sha256_hex(pdf_bytes),
                lane_policy_version=LANE_ENFORCEMENT_VERSION,
                source_chunk={"chunkId": req.chunk_id, "chunkIndex": req.chunk_index},
            )
            bytes_out += int(source_scene.get("bytes_out") or 0)
            per_page_artifacts = await _upload_per_page_docling_artifacts(
                client,
                prefix,
                per_page_payload,
                source="chunk-parse",
                source_scene=source_scene,
            )
            metrics.record_since("per_page_artifact_ms", per_page_start)
            artifacts["per_page_docling_artifact_version"] = per_page_artifacts.get("per_page_docling_artifact_version")
            artifacts["per_page_docling_manifest_path"] = per_page_artifacts.get("per_page_docling_manifest_path")
            artifacts["per_page_docling_page_count"] = per_page_artifacts.get("per_page_docling_page_count")
            artifacts["per_page_docling_validation"] = per_page_artifacts.get("per_page_docling_validation")
            artifacts["source_scene_graph_version"] = source_scene.get("source_scene_graph_version")
            artifacts["source_scene_path"] = source_scene.get("source_scene_path")
            artifacts["source_scene_complete"] = source_scene.get("complete")
            bytes_out += int(per_page_artifacts.get("bytes_out") or 0)

            upload_wall_ms = (metrics.now() - upload_start) * 1000
            metrics.record("artifact_upload_ms", max(0.0, upload_wall_ms - raster_wall_ms))

        metrics.set_counts_from_summary(parse_result.get("summary") or {}, actual_pages)
        metrics.set_bytes_out(bytes_out)
        chunk_metrics = metrics.build("succeeded")

        duration_ms = int((time.monotonic() - started) * 1000)
        attempts, attempt_ms = await _post_chunk_callback(req.callback_url, req.callback_token, req.job_id, {
            "job_id": req.job_id,
            "chunk_id": req.chunk_id,
            "chunk_index": req.chunk_index,
            "status": "succeeded",
            "engine_version": ENGINE_VERSION,
            "extractor_lane": lane_policy["lane"],
            "lane_enforcement_version": LANE_ENFORCEMENT_VERSION,
            "effective_mode": mode,
            "lane_policy": lane_policy,
            "page_start": req.page_start,
            "page_end": req.page_end,
            "actual_pages": actual_pages,
            "artifact_paths": artifacts,
            "summary": parse_result.get("summary") or {},
            "bytes_in": bytes_in,
            "bytes_out": bytes_out,
            "duration_ms": duration_ms,
            "metrics": chunk_metrics,
        })
        _log_operational_metrics(chunk_metrics, callback_attempt_count=attempts, callback_attempt_ms=attempt_ms)
    except SidecarError as exc:
        LOG.warning("chunk job %s/%d failed: %s", req.job_id, req.chunk_index, exc.message)
        metrics.set_bytes_out(bytes_out)
        failed_metrics = metrics.build("failed")
        attempts, attempt_ms = await _post_chunk_callback(req.callback_url, req.callback_token, req.job_id, {
            "job_id": req.job_id,
            "chunk_id": req.chunk_id,
            "chunk_index": req.chunk_index,
            "status": "failed",
            "error_code": exc.error_code,
            "message": exc.message,
            "retryable": exc.retryable,
            "page_start": req.page_start,
            "page_end": req.page_end,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "metrics": failed_metrics,
        })
        _log_operational_metrics(failed_metrics, callback_attempt_count=attempts, callback_attempt_ms=attempt_ms, error_code=exc.error_code)
    except MemoryError as exc:
        LOG.exception("chunk job %s/%d OOM", req.job_id, req.chunk_index)
        metrics.set_bytes_out(bytes_out)
        failed_metrics = metrics.build("failed")
        attempts, attempt_ms = await _post_chunk_callback(req.callback_url, req.callback_token, req.job_id, {
            "job_id": req.job_id,
            "chunk_id": req.chunk_id,
            "chunk_index": req.chunk_index,
            "status": "failed",
            "error_code": "chunk_oom",
            "message": str(exc)[:300],
            "retryable": True,
            "page_start": req.page_start,
            "page_end": req.page_end,
            "metrics": failed_metrics,
        })
        _log_operational_metrics(failed_metrics, callback_attempt_count=attempts, callback_attempt_ms=attempt_ms, error_code="chunk_oom")
    except Exception as exc:
        LOG.exception("chunk job %s/%d unhandled", req.job_id, req.chunk_index)
        metrics.set_bytes_out(bytes_out)
        failed_metrics = metrics.build("failed")
        attempts, attempt_ms = await _post_chunk_callback(req.callback_url, req.callback_token, req.job_id, {
            "job_id": req.job_id,
            "chunk_id": req.chunk_id,
            "chunk_index": req.chunk_index,
            "status": "failed",
            "error_code": "chunk_unhandled",
            "message": str(exc)[:500],
            "retryable": True,
            "page_start": req.page_start,
            "page_end": req.page_end,
            "metrics": failed_metrics,
        })
        _log_operational_metrics(failed_metrics, callback_attempt_count=attempts, callback_attempt_ms=attempt_ms, error_code="chunk_unhandled")


def _safe_pdf_text_for_page(page) -> str:
    try:
        textpage = page.get_textpage()
        try:
            return textpage.get_text_range() or ""
        finally:
            try:
                textpage.close()
            except Exception:
                pass
    except Exception:
        return ""


def _estimate_plan_from_pdf(pdf_bytes: bytes, mode: str, max_chunk_pages: Optional[int], force_chunking: bool) -> dict:
    started = time.monotonic()
    pdf = pdfium.PdfDocument(pdf_bytes)
    page_count = len(pdf)

    sample_indices: list[int] = []
    if page_count:
        sample_indices = sorted(set([
            0,
            min(page_count - 1, page_count // 2),
            page_count - 1,
            *range(0, min(page_count, 5)),
        ]))

    sampled_chars = 0
    pages_with_text = 0
    digit_count = 0
    currency_count = 0
    table_hint_count = 0

    for idx in sample_indices:
        try:
            page = pdf[idx]
            text = _safe_pdf_text_for_page(page)
        except Exception:
            text = ""

        clean = " ".join(text.split())
        char_count = len(clean)
        sampled_chars += char_count

        if char_count >= 40:
            pages_with_text += 1

        digit_count += sum(ch.isdigit() for ch in clean)
        currency_count += sum(1 for ch in clean if ch in "$£€¥%")
        # Heuristic: repeated numeric columns / finance report style.
        table_hint_count += clean.count("%") + clean.count("$") + clean.count("|")

    sample_count = max(1, len(sample_indices))
    selectable_text_ratio = round(pages_with_text / sample_count, 4)
    scanned_page_ratio = round(1.0 - selectable_text_ratio, 4)
    ocr_hint = scanned_page_ratio >= 0.35 or sampled_chars < max(80, sample_count * 40)

    bytes_per_page = len(pdf_bytes) / max(1, page_count)
    image_heavy = bytes_per_page > 900_000 and selectable_text_ratio < 0.75
    design_heavy = image_heavy or (bytes_per_page > 650_000 and table_hint_count < 3)

    table_score = digit_count + (currency_count * 5) + (table_hint_count * 8)
    if table_score > 250:
        table_likelihood = "high"
    elif table_score > 80:
        table_likelihood = "medium"
    else:
        table_likelihood = "low"

    if page_count >= 80 or image_heavy or ocr_hint:
        estimated_complexity = "high"
    elif page_count >= 25 or table_likelihood in {"medium", "high"} or design_heavy:
        estimated_complexity = "medium"
    else:
        estimated_complexity = "low"

    requested_mode = (mode or "hybrid").replace("_", "-").lower()

    if requested_mode in {"pixel-perfect", "pixel"}:
        recommended_mode = "pixel-perfect"
        recommended_lane = "pixel_raster_only"
    elif ocr_hint:
        recommended_mode = "hybrid"
        recommended_lane = "ocr_scanned"
    elif design_heavy:
        recommended_mode = "hybrid"
        recommended_lane = "design_heavy"
    elif table_likelihood == "high":
        recommended_mode = "hybrid"
        recommended_lane = "accurate_table"
    else:
        recommended_mode = "hybrid"
        recommended_lane = "fast_native"

    if max_chunk_pages:
        recommended_chunk_size = min(max_chunk_pages, page_count or max_chunk_pages)
    elif recommended_lane in {"ocr_scanned", "design_heavy", "pixel_raster_only"}:
        recommended_chunk_size = 5
    elif page_count <= 20 and not force_chunking:
        recommended_chunk_size = page_count or 1
    elif page_count <= 60:
        recommended_chunk_size = 10
    else:
        recommended_chunk_size = 5

    recommended_chunk_size = max(1, min(int(recommended_chunk_size), 50))

    requires_raster = recommended_mode in {"hybrid", "pixel-perfect"} or recommended_lane in {"design_heavy", "pixel_raster_only", "ocr_scanned"}
    requires_ocr = recommended_lane == "ocr_scanned"
    requires_picture_description = recommended_lane == "design_heavy" and image_heavy

    plan_ms = int((time.monotonic() - started) * 1000)

    return {
        "engine_version": ENGINE_VERSION,
        "file_type": "pdf",
        "page_count": page_count,
        "byte_size": len(pdf_bytes),
        "has_selectable_text": selectable_text_ratio > 0.0,
        "selectable_text_ratio": selectable_text_ratio,
        "scanned_page_ratio": scanned_page_ratio,
        "ocr_hint": ocr_hint,
        "estimated_complexity": estimated_complexity,
        "table_likelihood": table_likelihood,
        "image_heavy": image_heavy,
        "design_heavy": design_heavy,
        "recommended_mode": recommended_mode,
        "recommended_lane": recommended_lane,
        "recommended_chunk_size": recommended_chunk_size,
        "requires_raster": requires_raster,
        "requires_ocr": requires_ocr,
        "requires_picture_description": requires_picture_description,
        "plan_ms": plan_ms,
        "max_pdf_bytes": MAX_PDF_BYTES,
    }


@app.post("/plan")
async def plan(req: PlanRequest) -> dict:
    """Phase 1 preflight router. Counts pages and recommends extraction lane without running Docling."""
    pdf_bytes = await _resolve_pdf_bytes(req.url, req.pdf_base64)
    try:
        return _estimate_plan_from_pdf(
            pdf_bytes,
            req.mode,
            req.max_chunk_pages,
            req.force_chunking,
        )
    except SidecarError:
        raise
    except Exception as exc:
        raise SidecarError(
            400,
            "plan_failed",
            f"Could not generate PDF preflight plan: {exc}",
            retryable=False,
        ) from exc


@app.post("/parse-chunk")
async def parse_chunk(req: ChunkRequest, background_tasks: BackgroundTasks):
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        raise SidecarError(
            503,
            "callback_upload_not_configured",
            "/parse-chunk requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on the sidecar.",
            retryable=False,
        )
    background_tasks.add_task(_run_chunk_job, req)
    return JSONResponse(
        {
            "accepted": True,
            "job_id": req.job_id,
            "chunk_id": req.chunk_id,
            "chunk_index": req.chunk_index,
            "page_start": req.page_start,
            "page_end": req.page_end,
            "engine_version": ENGINE_VERSION,
            "extractor_lane": req.extractor_lane,
        },
        status_code=202,
    )

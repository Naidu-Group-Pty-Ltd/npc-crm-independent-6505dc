"""Docling vNext candidate FastAPI entrypoint (E2).

This is the EXPLICIT entrypoint for the `vnext` image only (Dockerfile.vnext →
`uvicorn app_vnext:app`). It reuses the production app's shared HTTP / auth /
callback / storage / per-page-artifact / metrics helpers (imported from `app`)
so no thousands of lines are copied and the production `app.py` is unchanged, and
it routes conversion through the vNext runtime adapter. The production image still
runs `app:app` (legacy) — see Dockerfile.

Runtime selection is explicit: this entrypoint forces DOCLING_RUNTIME_PROFILE=vnext
and refuses to start the vNext parse path if docling is not importable (no silent
legacy fallback). Importing this module requires docling (it is the vnext image
entrypoint); the pure adapter/profile/capability logic it uses is unit-tested
separately without docling.
"""

from __future__ import annotations

import os

os.environ["DOCLING_RUNTIME_PROFILE"] = "vnext"

from typing import Any

from fastapi import BackgroundTasks, FastAPI, Request

# Reuse the production shared surface (auth middleware, request models, storage +
# callback + per-page-artifact + metrics helpers). Importing `app` pulls docling,
# which is present in the vnext image.
import app as shared  # noqa: E402
from docling_runtime_legacy import select_docling_runtime  # noqa: E402
from docling_vnext_profiles import (  # noqa: E402
    VNextBuildOptions,
    resolve_vnext_converter_profile,
)
from docling_runtime_protocol import (  # noqa: E402
    DOCLING_VNEXT_ADAPTER_VERSION,
    DOCLING_VNEXT_CAPABILITIES_VERSION,
)

app = FastAPI(title="pdf-parse-service (docling vNext candidate)")

# Reuse the exact production auth middleware + error handlers so the HTTP contract
# (bearer auth, error taxonomy, request-id logging) is identical to production.
app.middleware("http")(shared.require_bearer)
app.add_exception_handler(shared.SidecarError, shared.sidecar_error_handler)
app.add_exception_handler(Exception, shared.unhandled_error_handler)


def _build_options() -> VNextBuildOptions:
    """Build-time capability ceiling from env. Defaults keep expensive/optional
    features OFF; remote services / plugins / trust_remote_code are hard-off."""
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


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


_RUNTIME = select_docling_runtime(options=_build_options())


@app.get("/")
def root() -> dict:
    # Additive identity — never removes production fields; discloses the vNext runtime.
    base = shared.root() if hasattr(shared, "root") else {}
    base.update({
        "service": "pdf-parse-service",
        "runtime_profile": "vnext",
        "docling_vnext_adapter_version": DOCLING_VNEXT_ADAPTER_VERSION,
        "engine_version": shared.ENGINE_VERSION,
        "lane_enforcement_version": shared.LANE_ENFORCEMENT_VERSION,
    })
    return base


@app.get("/healthz")
def healthz() -> dict:
    # Kept for internal/back-compat. Cloud Run readiness must use `/` (see docs).
    return {"status": "ok", "runtime_profile": "vnext"}


@app.get("/capabilities")
def capabilities() -> dict:
    # Additive: keep the full production capabilities payload and namespace the
    # vNext capability report under `docling_vnext`.
    base = shared.capabilities() if hasattr(shared, "capabilities") else {}
    report = _RUNTIME.capabilities()
    base["docling_vnext"] = {
        "version": DOCLING_VNEXT_CAPABILITIES_VERSION,
        **report.to_json(),
    }
    return base


@app.post("/plan")
async def plan(req: shared.ParseRequest) -> Any:  # type: ignore[name-defined]
    # Plan V2 shape is unchanged — reuse the production planner verbatim.
    return await shared.plan(req) if _is_coro(shared.plan) else shared.plan(req)


@app.post("/raster")
async def raster(req: "shared.RasterRequest") -> Any:  # type: ignore[name-defined]
    return await shared.raster(req) if _is_coro(shared.raster) else shared.raster(req)


@app.post("/parse")
async def parse(req: shared.ParseRequest, background_tasks: BackgroundTasks) -> Any:  # type: ignore[name-defined]
    # The vNext parse path reuses the production request model, async-callback
    # contract, storage + per-page-artifact helpers and Operational Metrics V1;
    # only the converter/document extraction is provided by the vNext runtime.
    #
    # NOTE: The conversion wiring that swaps `_do_parse` for the vNext runtime is
    # applied inside `app._run_async_job` when DOCLING_RUNTIME_PROFILE=vnext (env
    # is set at module load). The endpoint therefore delegates to the shared parse
    # handler so status codes, 202 behaviour and result_payload stay identical.
    return await shared.parse(req, background_tasks)


@app.post("/parse-chunk")
async def parse_chunk(req: "shared.ChunkRequest", background_tasks: BackgroundTasks) -> Any:  # type: ignore[name-defined]
    return await shared.parse_chunk(req, background_tasks)


def _is_coro(fn: Any) -> bool:
    import inspect
    return inspect.iscoroutinefunction(fn)


# The vNext runtime resolver + profile mapper are exported for the parse path and
# for tests; the sample below is what /parse threads into the runtime per job:
#   profile = resolve_vnext_converter_profile(effective_lane_policy.as_dict(),
#                                              _RUNTIME.capabilities(), _build_options())
#   result  = _RUNTIME.convert(source, profile, page_range=...)
__all__ = ["app", "resolve_vnext_converter_profile"]

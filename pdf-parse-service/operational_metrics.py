"""Sidecar Operational Metrics V1 (Path-to-100 v2 · G2).

One truthful, versioned metrics contract emitted by every parse path — sync
`/parse`, async monolithic success/failure callbacks, and chunk success/failure
callbacks — plus `/capabilities` and structured logs. C11 later validates and
aggregates these; this module only *produces* them.

Design principles:

* **Wall-clock vs cumulative** are never conflated. `sidecar_elapsed_before_callback_ms`
  is wall-clock; the per-phase `*_ms` fields are that phase's own wall time.
* **No fabricated measurements.** A phase that did not run is reported as
  ``null`` with an explicit ``measurement_state`` — never a fake ``0``. Zero is
  emitted only when the phase actually ran and measured < 1 ms after rounding.
* **Callback honesty.** The duration of the callback attempt delivering a
  payload cannot be inside that payload, so ``callback_attempt_ms`` is always
  ``null`` with state ``not_observable_in_same_delivery``; the completed attempt
  duration is written to structured logs *after* the HTTP response.
* **JSON-native only.** Every present numeric value is a finite, non-negative
  int/float — never NaN, Infinity, negative, or Decimal.

Pure + Docling-free so it can be unit-tested with a fake clock.
"""

from __future__ import annotations

import math
import time
from typing import Any, Callable, Optional

SIDECAR_OPERATIONAL_METRICS_VERSION = "sidecar-operational-metrics-v1"

# Measurement states.
MEASURED = "measured"
NOT_APPLICABLE = "not_applicable"
UNAVAILABLE = "unavailable"
NOT_COMPLETED = "not_completed"
FAILED_BEFORE_PHASE = "failed_before_phase"
NOT_OBSERVABLE = "not_observable_in_same_delivery"

SCOPES = ("synchronous", "monolithic", "chunk")
STATUSES = ("succeeded", "failed", "partial")

# Per-invocation timing phases (each is that phase's own wall time).
TIMING_PHASES = (
    "source_download_ms",
    "source_resolve_ms",
    "parse_ms",
    "raster_ms",
    "artifact_upload_ms",
    "per_page_artifact_ms",
)


def json_int_ms(value: Any) -> Optional[int]:
    """Non-negative integer milliseconds, or None for a non-finite/negative/None."""
    if value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num) or num < 0:
        return None
    return int(round(num))


def json_ratio(value: Any) -> Optional[float]:
    """A finite ratio clamped to [0, 1], or None."""
    if value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num):
        return None
    return max(0.0, min(1.0, num))


def json_count(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num) or num < 0:
        return None
    return int(num)


class OperationalMetricsAccumulator:
    """Records per-phase timings + counts across an invocation and builds the
    canonical, JSON-safe metrics dict. Phases start ``not_completed`` so a
    failure mid-way leaves un-run phases explicitly un-measured (never fake 0)."""

    def __init__(
        self,
        scope: str,
        *,
        clock: Callable[[], float] = time.monotonic,
        engine_version: str = "",
        lane_enforcement_version: str = "",
        request_id: Optional[str] = None,
        job_id: Optional[str] = None,
        chunk_id: Optional[str] = None,
        chunk_index: Optional[int] = None,
        page_start: Optional[int] = None,
        page_end: Optional[int] = None,
        extractor_lane: Optional[str] = None,
        requested_mode: Optional[str] = None,
        effective_mode: Optional[str] = None,
        memory_profile: Optional[str] = None,
        source_input_kind: Optional[str] = None,
    ) -> None:
        self.scope = scope
        self._clock = clock
        self._t0 = clock()
        self.engine_version = engine_version
        self.lane_enforcement_version = lane_enforcement_version
        self.request_id = request_id
        self.job_id = job_id
        self.chunk_id = chunk_id
        self.chunk_index = chunk_index
        self.page_start = page_start
        self.page_end = page_end
        self.extractor_lane = extractor_lane
        self.requested_mode = requested_mode
        self.effective_mode = effective_mode
        self.memory_profile = memory_profile
        self.source_input_kind = source_input_kind

        self._timings: dict[str, Optional[int]] = {p: None for p in TIMING_PHASES}
        self._states: dict[str, str] = {p: NOT_COMPLETED for p in TIMING_PHASES}
        # A source phase that structurally cannot apply is not_applicable up-front.
        if source_input_kind == "base64":
            self._states["source_download_ms"] = NOT_APPLICABLE
        elif source_input_kind == "url":
            self._states["source_resolve_ms"] = NOT_APPLICABLE

        self.bytes_in = 0
        self.bytes_out = 0
        self._counts: dict[str, Any] = {}
        self.callback_attempt_count = 0

    # -- timing --------------------------------------------------------------
    def now(self) -> float:
        return self._clock()

    def elapsed_ms(self) -> int:
        return max(0, int(round((self._clock() - self._t0) * 1000)))

    def record(self, phase: str, ms: Any, state: str = MEASURED) -> None:
        if phase not in self._timings:
            raise KeyError(f"unknown timing phase {phase}")
        self._timings[phase] = json_int_ms(ms)
        self._states[phase] = state

    def record_since(self, phase: str, start: float, state: str = MEASURED) -> None:
        self.record(phase, (self._clock() - start) * 1000, state)

    def mark(self, phase: str, state: str) -> None:
        if phase not in self._states:
            raise KeyError(f"unknown timing phase {phase}")
        self._states[phase] = state
        if state != MEASURED:
            self._timings[phase] = None

    # -- counts / bytes ------------------------------------------------------
    def set_bytes_in(self, value: int) -> None:
        self.bytes_in = max(0, int(value or 0))

    def set_bytes_out(self, value: int) -> None:
        self.bytes_out = max(0, int(value or 0))

    def set_counts_from_summary(self, summary: Optional[dict], page_count: Optional[int]) -> None:
        summary = summary or {}
        self._counts = {
            "page_count": json_count(page_count),
            "table_count": json_count(summary.get("table_count")),
            "picture_count": json_count(summary.get("picture_count")),
            "text_block_count": json_count(summary.get("text_block_count")),
            "vector_count": json_count(summary.get("vector_count")),
            "ocr_page_count": json_count(len(summary.get("ocr_pages") or [])),
        }

    def set_callback_attempt_count(self, count: int) -> None:
        self.callback_attempt_count = max(0, int(count or 0))

    # -- build ---------------------------------------------------------------
    def build(self, status: str) -> dict[str, Any]:
        page_count = self._counts.get("page_count")
        parse_ms = self._timings.get("parse_ms")
        ocr_pages = self._counts.get("ocr_page_count")

        avg_parse = None
        if parse_ms is not None and page_count:
            avg_parse = json_int_ms(parse_ms / max(1, page_count))

        ocr_ratio = None
        if page_count:
            ocr_ratio = json_ratio((ocr_pages or 0) / page_count)
        elif page_count == 0:
            ocr_ratio = 0.0

        chunk_count = 1 if self.scope == "chunk" else 0

        timings = {phase: self._timings[phase] for phase in TIMING_PHASES}
        timings["sidecar_elapsed_before_callback_ms"] = self.elapsed_ms()
        timings["callback_attempt_ms"] = None

        measurement_state = dict(self._states)
        measurement_state["sidecar_elapsed_before_callback_ms"] = MEASURED
        measurement_state["callback_attempt_ms"] = (
            NOT_APPLICABLE if self.scope == "synchronous" else NOT_OBSERVABLE
        )

        return {
            "contract_version": SIDECAR_OPERATIONAL_METRICS_VERSION,
            "engine_version": self.engine_version,
            "lane_enforcement_version": self.lane_enforcement_version,
            "scope": self.scope,
            "status": status,
            "request_id": self.request_id,
            "job_id": self.job_id,
            "chunk_id": self.chunk_id,
            "chunk_index": self.chunk_index,
            "page_start": self.page_start,
            "page_end": self.page_end,
            "extractor_lane": self.extractor_lane,
            "requested_mode": self.requested_mode,
            "effective_mode": self.effective_mode,
            "memory_profile": self.memory_profile,
            "source_input_kind": self.source_input_kind,
            "timings": timings,
            "measurement_state": measurement_state,
            "callback_attempt_count": int(self.callback_attempt_count),
            "counts": {
                "page_count": page_count,
                "chunk_count": chunk_count,
                "avg_parse_ms_per_page": avg_parse,
                "ocr_page_ratio": ocr_ratio,
                "table_count": self._counts.get("table_count"),
                "picture_count": self._counts.get("picture_count"),
                "text_block_count": self._counts.get("text_block_count"),
                "vector_count": self._counts.get("vector_count"),
            },
            "bytes": {"bytes_in": max(0, int(self.bytes_in)), "bytes_out": max(0, int(self.bytes_out))},
        }


def operational_metrics_capabilities() -> dict[str, Any]:
    """The `/capabilities.operational_metrics` documentation block."""
    return {
        "contract_version": SIDECAR_OPERATIONAL_METRICS_VERSION,
        "supported_scopes": list(SCOPES),
        "statuses": list(STATUSES),
        "timing_unit": "milliseconds",
        "elapsed_clock": "monotonic",
        "timing_fields": list(TIMING_PHASES) + [
            "sidecar_elapsed_before_callback_ms",
            "callback_attempt_ms",
        ],
        "count_fields": [
            "page_count", "chunk_count", "avg_parse_ms_per_page", "ocr_page_ratio",
            "table_count", "picture_count", "text_block_count", "vector_count",
        ],
        "byte_fields": ["bytes_in", "bytes_out"],
        "measurement_states": [
            MEASURED, NOT_APPLICABLE, UNAVAILABLE, NOT_COMPLETED, FAILED_BEFORE_PHASE, NOT_OBSERVABLE,
        ],
        "nullability": "A phase that did not run is null with an explicit measurement_state; zero is only emitted for a phase that ran and measured < 1 ms.",
        "callback_timing_limitation": (
            "callback_attempt_ms is always null (not_observable_in_same_delivery) — the "
            "duration of the callback delivering a payload cannot be inside that payload. "
            "Completed attempt durations are written to structured logs after the HTTP "
            "response. C11 measures callback receipt + Edge processing time downstream."
        ),
        "per_page_artifact_ms_is_subset_of": "artifact_upload_ms",
        "measures_rss": False,
        "invocation_local_counts": ["page_count", "chunk_count", "table_count", "picture_count", "text_block_count", "vector_count"],
        "parent_aggregation": "Parent-job aggregation across chunks is performed downstream in C11, not by the sidecar.",
    }

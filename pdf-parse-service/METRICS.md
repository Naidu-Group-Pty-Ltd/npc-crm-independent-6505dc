# Operational Metrics V1 (`sidecar-operational-metrics-v1`) — PDF-import sidecar

G2 gives the sidecar **one truthful, versioned operational-metrics contract**
emitted by every parse path — synchronous `/parse`, async monolithic
success/failure callbacks, and chunk success/failure callbacks — plus a
self-describing block on `/capabilities` and a structured log line after each
delivery.

The metrics are **produced** here; they are **validated and aggregated
downstream in C11**. The sidecar never aggregates across chunks and never
pretends to measure something it cannot.

The contract is a pure, Docling-free module —
[`operational_metrics.py`](./operational_metrics.py) — unit-tested with a fake
clock in [`test_operational_metrics.py`](./test_operational_metrics.py). `app.py`
drives an `OperationalMetricsAccumulator` through each parse path, so two paths
can never describe the same phase differently.

## Design principles

1. **Wall-clock vs cumulative are never conflated.**
   `sidecar_elapsed_before_callback_ms` is this invocation's wall time; each
   per-phase `*_ms` is that phase's own wall time. (The pre-existing
   `cloud_run_ms` on the callback remains *cumulative CPU work* and is untouched
   — the new metrics do not reuse or redefine it.)
2. **No fabricated measurements.** A phase that did not run is `null` with an
   explicit `measurement_state` — never a fake `0`. Zero appears only when a
   phase actually ran and measured `< 1 ms` after rounding.
3. **Callback honesty.** The duration of the callback attempt delivering a
   payload cannot be inside that payload, so `callback_attempt_ms` is always
   `null`. The completed attempt duration is written to structured logs *after*
   the HTTP response returns.
4. **JSON-native only.** Every present numeric value is a finite, non-negative
   `int`/`float` — never NaN, Infinity, negative, or Decimal.
5. **Additive + versioned.** The `metrics` object is a new, namespaced field.
   Existing callback/`/parse` consumers that ignore it are unaffected.

## Where it is emitted

| Path | Scope | Location of the object | Failure carries metrics? |
|---|---|---|---|
| async monolithic `/parse` (callback mode) | `monolithic` | top-level `metrics` **and** identical `result_payload.metrics` on the success callback | yes — `status:"failed"` partial metrics on both failure callbacks |
| `/parse-chunk` | `chunk` | top-level `metrics` on the chunk success callback | yes — on the SidecarError / MemoryError / unhandled failure callbacks |
| synchronous `/parse` (legacy, no callback) | `synchronous` | `metrics` on the JSON response body | n/a (errors raise `SidecarError` → HTTP error, as before) |
| `/capabilities` | — | `operational_metrics` documentation block | — |

On the monolithic success callback the **same Python object** is referenced by
both `metrics` and `result_payload.metrics`, so the two can never disagree.

## Schema

```jsonc
{
  "contract_version": "sidecar-operational-metrics-v1",
  "engine_version": "<docling engine version>",
  "lane_enforcement_version": "extractor-lane-policy-v2",   // mirrors G1 lane identity
  "scope": "synchronous | monolithic | chunk",
  "status": "succeeded | failed | partial",
  "request_id": "<sync only; async uses job_id>",
  "job_id": "<async/chunk>",
  "chunk_id": "<chunk only>",
  "chunk_index": 0,
  "page_start": 1,          // chunk only (else null)
  "page_end": 10,           // chunk only (else null)
  "extractor_lane": "accurate_table",   // resolved G1 lane
  "requested_mode": "hybrid",
  "effective_mode": "hybrid",
  "memory_profile": "standard",          // G1 lane label (not a Cloud Run change)
  "source_input_kind": "url | base64",
  "timings": {
    "source_download_ms": 20,            // url path only
    "source_resolve_ms": null,           // base64 path only
    "parse_ms": 400,
    "raster_ms": 150,                    // null when no raster pass
    "artifact_upload_ms": 90,            // upload wall time (raster compute excluded)
    "per_page_artifact_ms": 40,          // ⊆ artifact_upload_ms
    "sidecar_elapsed_before_callback_ms": 660,   // wall clock this invocation
    "callback_attempt_ms": null          // always null — see "Callback timing"
  },
  "measurement_state": {
    "source_download_ms": "measured",
    "source_resolve_ms": "not_applicable",
    "parse_ms": "measured",
    "raster_ms": "measured",
    "artifact_upload_ms": "measured",
    "per_page_artifact_ms": "measured",
    "sidecar_elapsed_before_callback_ms": "measured",
    "callback_attempt_ms": "not_observable_in_same_delivery"  // "not_applicable" for synchronous
  },
  "callback_attempt_count": 0,           // 0 in-payload; the real count is logged after delivery
  "counts": {
    "page_count": 5,
    "chunk_count": 1,                    // 1 for a chunk invocation, else 0
    "avg_parse_ms_per_page": 80,         // null when page_count is 0
    "ocr_page_ratio": 0.2,               // clamped to [0,1]; 0.0 when page_count is 0
    "table_count": 3,
    "picture_count": 2,
    "text_block_count": 50,
    "vector_count": 10
  },
  "bytes": { "bytes_in": 2048, "bytes_out": 4096 }
}
```

## Timing-field semantics (units: **milliseconds**, clock: **monotonic**)

| Field | Meaning | When `null` |
|---|---|---|
| `source_download_ms` | wall time fetching source bytes over the network (URL input) | base64 input (`not_applicable`); or failed before completing (`not_completed`) |
| `source_resolve_ms` | wall time decoding/validating inline base64 source (no network) | URL input (`not_applicable`); or failed before completing |
| `parse_ms` | wall time of the Docling parse call | parse did not run/complete |
| `raster_ms` | wall time of the raster **compute** (`_do_raster`) | mode needs no raster (`not_applicable`); raster attempted but failed (`not_completed`) |
| `artifact_upload_ms` | wall time of the artifact-upload block **minus** the raster compute | uploads did not run; `not_applicable` on the synchronous path (no upload) |
| `per_page_artifact_ms` | wall time building + uploading the per-page Docling artifacts — a **subset of** `artifact_upload_ms` | per-page upload did not run; `not_applicable` on the synchronous path |
| `sidecar_elapsed_before_callback_ms` | wall clock from accumulator start to the moment metrics are built (immediately before the callback) | never — always `measured` |
| `callback_attempt_ms` | duration of the callback delivery attempt | **always** `null` — the payload cannot time its own delivery |

`sidecar_elapsed_before_callback_ms` is always **≥** the sum of the
non-overlapping phases (subject to millisecond rounding); phases never
double-count (`raster_ms` is excluded from `artifact_upload_ms`;
`per_page_artifact_ms` is a subset reported for visibility, not added again).

## Measurement states / nullability

| State | Meaning |
|---|---|
| `measured` | the phase ran and the value is a real measurement (may be `0` if `< 1 ms`) |
| `not_applicable` | the phase structurally cannot occur for this request (e.g. `source_resolve_ms` on a URL request; raster/upload on synchronous `/parse`) |
| `not_completed` | the phase was expected but did not finish (failure mid-way) |
| `not_observable_in_same_delivery` | `callback_attempt_ms` — cannot be inside its own payload |
| `unavailable` / `failed_before_phase` | reserved for downstream use; not currently emitted by the sidecar |

A present timing is always a non-negative integer; an absent one is `null` with a
non-`measured` state. The two never disagree.

## Callback timing (why `callback_attempt_ms` is always null)

A payload cannot contain the duration of the very HTTP request that delivers it.
So the sidecar:

1. sets `callback_attempt_ms = null` (state `not_observable_in_same_delivery`;
   `not_applicable` on the synchronous path, which has no callback), and
2. has `_post_callback` / `_post_chunk_callback` **return** `(attempt_count,
   completed_attempt_ms)`, which the caller writes to the structured
   `operational_metrics` **log line** *after* the response returns.

`callback_attempt_count` inside the payload is `0` (no delivery has happened when
the object is built). A retry may report prior completed attempts via the log
without ever mislabeling the in-flight attempt. **C11** measures callback receipt
and Edge processing time on the receiving side and stitches the two boundaries
together without pretending they are one measurement.

## Counts

Counts are **invocation-local**: for a chunk they describe that chunk's pages
only (`page_count == actual chunk pages`, `chunk_count == 1`). Parent-job
aggregation across chunks (sum vs max vs parent wall clock vs merge time) is a
**C11** responsibility, not the sidecar's. `avg_parse_ms_per_page` and
`ocr_page_ratio` are guarded against divide-by-zero (`null` / `0.0` when
`page_count == 0`) and the ratio is clamped to `[0, 1]`.

## Failure behavior

On any failure the accumulator builds `status:"failed"` **partial** metrics from
whatever phases completed. Un-run phases stay `null` (never measured `0`). The
metrics object is namespaced and additive — it carries no `error_code` /
`message` / `retryable` key, so it can never mask the sibling error fields the
failure callback already sends.

## `/capabilities` (redacted example)

```jsonc
"operational_metrics": {
  "contract_version": "sidecar-operational-metrics-v1",
  "supported_scopes": ["synchronous", "monolithic", "chunk"],
  "statuses": ["succeeded", "failed", "partial"],
  "timing_unit": "milliseconds",
  "elapsed_clock": "monotonic",
  "timing_fields": ["source_download_ms", "source_resolve_ms", "parse_ms",
                    "raster_ms", "artifact_upload_ms", "per_page_artifact_ms",
                    "sidecar_elapsed_before_callback_ms", "callback_attempt_ms"],
  "measurement_states": ["measured", "not_applicable", "unavailable",
                         "not_completed", "failed_before_phase",
                         "not_observable_in_same_delivery"],
  "per_page_artifact_ms_is_subset_of": "artifact_upload_ms",
  "measures_rss": false,
  "callback_timing_limitation": "callback_attempt_ms is always null ...",
  "parent_aggregation": "... performed downstream in C11, not by the sidecar."
}
```

No environment-variable values, tokens, secrets, signed URLs, or document text
are ever exposed by `/capabilities` or in the metrics/log line.

## Diagnostics interpretation

* `parse_ms` dominating `sidecar_elapsed_before_callback_ms` → parse-bound
  (consider a lighter lane / OCR only where needed).
* `raster_ms` large or `artifact_upload_ms` large → raster/IO-bound.
* `raster_ms == null` with `not_applicable` → a semantic-only lane, as intended
  (not an error).
* `ocr_page_ratio` near `1.0` on a lane that did not force OCR → likely a scanned
  document; the dispatcher may re-plan to `ocr_scanned` on a retry.
* `status:"failed"` with only `source_download_ms` present → failed fetching the
  source before parsing.

## No new configuration

* **No new environment variables.**
* **No Cloud Run CPU/memory/timeout/concurrency change** — `memory_profile` is a
  G1 lane *label* for operators, not a sizing directive.
* **No Dockerfile / requirements change** — the module is pure stdlib.

## Downstream (C11) responsibilities

C11 (after G3) will: validate `contract_version`, record `callback_received_at`
and Edge processing time on the receiving side, merge the two timing boundaries
without conflation, and aggregate chunk-local metrics into parent-job totals
(`chunk_parse_ms_sum` vs `chunk_parse_ms_max` vs `parent_elapsed_ms` vs
`merge_ms`). The sidecar deliberately does none of this.

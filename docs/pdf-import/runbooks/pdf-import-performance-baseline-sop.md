# SOP — PDF-import performance baseline and verification

> **Engineering SOP — not a Phase 11F operator runbook.** Deliberately not in
> `PDF_IMPORT_RUNBOOK_REGISTRY`; it needs GCP console access and service-role SQL.

Use this before and after every change in
[`SIDECAR_PERFORMANCE_PROGRAMME.md`](../SIDECAR_PERFORMANCE_PROGRAMME.md).

Only 3 of the first 76 jobs carried the `sidecar-operational-metrics-v1`
contract, so the baseline is thin. Capture it properly *before* changing
anything, or the improvement cannot be attributed.

---

## 1. Confirm the CPU-throttling hypothesis (do this first)

The claim: `/parse` returns `202` and does its work in a background task, so
Cloud Run throttles the CPU until another request arrives. It is a hypothesis,
not a proven fact — verify before and after.

**Cloud Run console → the service → Metrics.** Compare, over the same window:

- **Billable instance time** vs **request count**. Under throttling, billable
  time is small relative to how long jobs actually take — the work is happening
  while the instance is not being billed at the active rate. After
  `--no-cpu-throttling`, billable time rises and *wall-clock job duration falls
  sharply*. That inversion is the confirmation.
- **Container CPU utilisation** during a known-long job. A near-flat, very low
  line while a job is nominally "parsing" is the throttle.

Cross-check against the ledger — the signature is bimodal duration for similar
page counts:

```sql
SELECT page_count, chunked,
       round((duration_ms)::numeric/1000,1) AS dur_s,
       created_at::date AS d
  FROM pdf_import_jobs
 WHERE status = 'succeeded' AND page_count >= 60
 ORDER BY page_count, dur_s;
```

Two jobs of near-identical page count differing by an order of magnitude is the
tell. If durations are tightly clustered, the hypothesis is wrong — stop and
re-diagnose before deploying anything else.

---

## 2. Baseline queries

Run all four and save the output with a date stamp.

```sql
-- 2.1 Overall shape
SELECT count(*) AS jobs,
       count(*) FILTER (WHERE status='succeeded') AS succeeded,
       count(*) FILTER (WHERE status='failed')    AS failed,
       round(100.0*count(*) FILTER (WHERE status='failed')/nullif(count(*),0),1) AS failure_pct,
       count(*) FILTER (WHERE cache_hit) AS cache_hits,
       round(avg(page_count)::numeric,1) AS avg_pages
  FROM pdf_import_jobs
 WHERE created_at > now() - interval '30 days';

-- 2.2 Duration by path (the F1 signal)
SELECT chunked, status, count(*) AS n,
       round(avg(page_count)::numeric,1) AS avg_pages,
       round((percentile_cont(0.5) within group (order by duration_ms))::numeric/1000,1) AS p50_s,
       round((percentile_cont(0.9) within group (order by duration_ms))::numeric/1000,1) AS p90_s,
       round((max(duration_ms))::numeric/1000,1) AS max_s
  FROM pdf_import_jobs
 WHERE created_at > now() - interval '30 days'
 GROUP BY chunked, status ORDER BY chunked, status;

-- 2.3 Failure mix
SELECT error_code, count(*) AS n, max(left(error_text,120)) AS sample
  FROM pdf_import_jobs
 WHERE status='failed' AND created_at > now() - interval '30 days'
 GROUP BY error_code ORDER BY n DESC;

-- 2.4 Per-phase timings — the only view that separates parse from IO.
--     Coverage grows as the metrics contract reaches more jobs.
SELECT count(*) AS jobs_with_metrics,
       round(avg((result_payload->'metrics'->'timings'->>'parse_ms')::numeric)/1000,1)              AS parse_s,
       round(avg((result_payload->'metrics'->'timings'->>'raster_ms')::numeric)/1000,1)             AS raster_s,
       round(avg((result_payload->'metrics'->'timings'->>'artifact_upload_ms')::numeric)/1000,1)    AS upload_s,
       round(avg((result_payload->'metrics'->'timings'->>'source_download_ms')::numeric)/1000,1)    AS download_s,
       round(avg((result_payload->'metrics'->'timings'->>'sidecar_elapsed_before_callback_ms')::numeric)/1000,1) AS total_s,
       round(avg((result_payload->'metrics'->'counts'->>'ocr_page_ratio')::numeric),3)              AS ocr_ratio
  FROM pdf_import_jobs
 WHERE status='succeeded'
   AND result_payload->'metrics' IS NOT NULL
   AND created_at > now() - interval '30 days';
```

### Reference values (2026-06-12 → 2026-07-19, pre-change)

| Metric | Value |
|---|---|
| Jobs / failure rate | 76 / **43.4%** |
| Monolithic succeeded p50 / p90 | 50.4s / 177.1s |
| Chunked succeeded p50 / p90 | 369.0s / **37,857s** |
| parse / raster / upload (n=3) | 23.6s / 2.5s / **19.0s** |
| `ocr_page_ratio` | **0.000** |
| Cache hits | 3 of 76 |

---

## 3. Per-change acceptance criteria

| Change | Expect | Abort signal |
|---|---|---|
| `--no-cpu-throttling` (P1-1) | Chunked p90 collapses toward p50; billable instance time rises | Durations unchanged → hypothesis wrong |
| Memory 8 GiB (P1-2) | `sidecar_error` 503s stop | No change → look elsewhere |
| Lane-policy v3 image (P2-7/8) | `docling_convert_failed` goes to zero; `unplanned` jobs speed up | Any new `docling_convert_failed` variant |
| Region → `asia-southeast1` (P3-2) | `artifact_upload_ms` falls sharply from 19.0s | Upload unchanged → not IO-bound after all |
| Watchdog tightening (P4-2) | First sweep returns 0 | Non-zero → too tight, revert per its SOP |

Run 2.4 after every deploy. If `upload_s` still dominates `parse_s` after the
region move, the bottleneck is artifact volume, not distance — reconsider raster
DPI and `DOCLING_IMAGES_SCALE` before adding capacity.

---

## 4. Verifying the sidecar's own view

`/capabilities` reports the resolved configuration; the sidecar never exposes
env values, tokens or signed URLs there.

```bash
curl -s "$PDF_PARSE_SERVICE_URL/capabilities" \
  -H "Authorization: Bearer $PDF_PARSE_SERVICE_TOKEN" | jq '{
    lane_policy_version,
    ocr,
    global_capabilities
  }'
```

After the v3 deploy, confirm:

- `ocr.global_force_full_page_ocr_default` → **`false`**
- `ocr.ocr_langs` → **`["en"]`**
- `ocr.ocr_language_resolution.dropped` → **`{}`**
- `global_capabilities.formula` / `.code` → **`false`**
- `lane_policy_version` → **`extractor-lane-policy-v3`**, and identical to
  `LANE_POLICY_VERSION` in `pdf-parse-dispatch`. A mismatch means the two were
  deployed separately and the cache fingerprint is serving stale-semantics
  artifacts.

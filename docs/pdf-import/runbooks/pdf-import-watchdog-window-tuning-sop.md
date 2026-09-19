# SOP — tuning the PDF-import watchdog grace windows

> **Engineering SOP — not a Phase 11F operator runbook.** It is deliberately not
> in `PDF_IMPORT_RUNBOOK_REGISTRY` and does not follow the 12-section operator
> template: the procedure needs `gcloud` and a service-role SQL connection, so it
> is not something to surface in the operator console.

Referenced by migration `20260807120000_docling_watchdog_v6_configurable_windows.sql`.
Background: [`SIDECAR_PERFORMANCE_PROGRAMME.md`](../SIDECAR_PERFORMANCE_PROGRAMME.md) §F1, §F7.

## What v6 changed

v5 hardcoded its grace windows in the function body. v6 moves them into the
single-row table `public.pdf_import_watchdog_config`, **seeded with the exact v5
values**. Applying the migration changes no behaviour. Tuning is an `UPDATE`,
and reverting is the same `UPDATE` backwards — no rollback migration.

| Column | v5 value | Applies to |
|---|---|---|
| `monolithic_dispatched_grace` | 45 min | Monolithic job that got a 202 from `/parse` |
| `monolithic_undispatched_grace` | 12 min | Monolithic job with no successful dispatch |
| `chunk_stall_grace` | 90 min | Chunked job with silent in-flight chunks |
| `chunked_no_inflight_grace` | 45 min | Chunked job, no in-flight chunks, unsettled |
| `recoverable_window` | 7 days | `recoverable_failed` → terminal `failed` |
| `template_import_stale_grace` | 2 hours | `template_imports` stuck in `processing` |

## ⚠️ Do not tighten before the throttling fix is verified

The windows are generous because sidecar jobs currently crawl: Cloud Run runs
without `--no-cpu-throttling` while `/parse` does its work in a background task,
so the container is throttled until another request wakes it. Two 94-page jobs
took 357s and 46,424s.

**Tightening these windows while that is true will mass-fail legitimate in-flight
work.** Order is: fix throttling → verify → tighten.

## Preconditions

1. `--no-cpu-throttling` is live on the Cloud Run service.
2. At least **10 successful imports**, including at least 3 chunked jobs, have
   completed since that revision took traffic.
3. The p95 job duration from those runs is known (see the baseline SOP).

## Choosing values

Set each window to roughly **3× the observed p95** for that job class, floored at
the constraint minimums. Do not set them to p95 — a window is a "definitely
dead" threshold, not a deadline.

Suggested post-fix starting point, assuming p95 lands near the pre-throttling
*healthy* runs (106 pages in 617s, 94 pages in 357s):

```sql
UPDATE public.pdf_import_watchdog_config
   SET chunk_stall_grace             = interval '20 minutes',
       chunked_no_inflight_grace     = interval '15 minutes',
       monolithic_dispatched_grace   = interval '15 minutes',
       monolithic_undispatched_grace = interval '5 minutes',
       template_import_stale_grace   = interval '45 minutes',
       updated_by = 'runbook:post-throttling-verification',
       updated_at = now(),
       note = 'Tightened after --no-cpu-throttling verified on <DATE>. p95 was <X>s.';
```

`recoverable_window` should stay at 7 days: it is keyed to the diagnostics-bucket
GC, and a longer window promises a retry whose source object has been deleted.

The table's CHECK constraints refuse anything below the sane floors (5 min for
most, 1 day for `recoverable_window`), so a fat-fingered `0` cannot disable the
pipeline.

## Verification after tightening

```sql
-- Nothing should be swept immediately. A non-zero count on the first run means
-- the windows are too tight for work that is currently healthy.
SELECT public.pdf_import_watchdog_sweep();

-- Then watch for 48h: a rise in these is the signal to back off.
SELECT error_code, count(*)
  FROM pdf_import_jobs
 WHERE created_at > now() - interval '48 hours'
   AND error_code IN ('chunk_stalled','dispatcher_timeout')
 GROUP BY error_code;
```

## Revert

```sql
UPDATE public.pdf_import_watchdog_config
   SET monolithic_dispatched_grace   = interval '45 minutes',
       monolithic_undispatched_grace = interval '12 minutes',
       chunk_stall_grace             = interval '90 minutes',
       chunked_no_inflight_grace     = interval '45 minutes',
       template_import_stale_grace   = interval '2 hours',
       updated_by = 'runbook:revert', updated_at = now();
```

Jobs already failed by a too-tight window are `recoverable_failed` and can be
retried without re-uploading, provided the retry happens inside
`recoverable_window`.

## Access

The table is RLS-enabled with grants to `service_role` only; `anon` and
`authenticated` have none. Run these statements from the SQL editor or a
service-role connection.

-- C11 — Sidecar Operational Metrics V1 downstream storage.
--
-- Adds one nullable JSONB column to each PDF-import row type to hold the
-- `pdf-operational-metrics-v1` envelope produced by the callbacks:
--   * pdf_import_jobs.operational_metrics   — monolithic invocation metrics +
--     edge observation, the chunked parent aggregation, OR cache-hit metrics.
--   * pdf_import_chunks.operational_metrics — the chunk-local invocation
--     envelope (validated chunk metrics + validation state + edge observation).
--
-- Backward compatibility / safety:
--   * Additive + nullable — no default backfill, no historic rows rewritten.
--   * Existing (and future legacy-sidecar) rows keep NULL, which the diagnostics
--     layer reads as `legacy_missing` — never as a fabricated zero.
--   * Idempotent (ADD COLUMN IF NOT EXISTS).
--   * No index: the column is read per-job on the diagnostics detail path, never
--     filtered/sorted in bulk, so an index would only add write cost.
--
-- Rollback:
--   ALTER TABLE public.pdf_import_jobs   DROP COLUMN IF EXISTS operational_metrics;
--   ALTER TABLE public.pdf_import_chunks DROP COLUMN IF EXISTS operational_metrics;

ALTER TABLE public.pdf_import_jobs
  ADD COLUMN IF NOT EXISTS operational_metrics jsonb;

ALTER TABLE public.pdf_import_chunks
  ADD COLUMN IF NOT EXISTS operational_metrics jsonb;

COMMENT ON COLUMN public.pdf_import_jobs.operational_metrics IS
  'C11 pdf-operational-metrics-v1 envelope: monolithic invocation metrics + edge observation, chunked parent aggregation, or cache-hit metrics. NULL = legacy job with no sidecar metrics.';

COMMENT ON COLUMN public.pdf_import_chunks.operational_metrics IS
  'C11 pdf-operational-metrics-v1 chunk invocation envelope: validated chunk-local metrics + validation state + edge observation. NULL = legacy/pre-C11 chunk.';

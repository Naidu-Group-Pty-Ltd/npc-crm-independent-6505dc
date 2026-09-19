-- Phase 11C — Durable PDF import monitoring + alerting event ledger.
--
-- A durable, rule-based, idempotent, severity-aware, status-aware alert store
-- for the PDF import pipeline. The Phase 9F monitoring layer only computes a
-- transient in-memory summary; this table persists alert instances so they can
-- be displayed, acknowledged, resolved, suppressed, or marked false-positive
-- over time by permitted admins.
--
-- This layer is NON-remediating. It never repairs, retries, reruns, reconciles,
-- mutates templates, or calls AI. It stores METADATA ONLY — never raw PDF text,
-- raw OCR text, screenshots/rasters, signed URLs, or private client content.
-- Alert `context` is restricted to safe scalar metrics, counts, and thresholds.
--
-- Writes are service-role only (the secure `pdf-import-monitoring` edge function
-- performs capability-checked detection + lifecycle transitions). Reads are
-- restricted to admins under this app's custom-auth flow.

CREATE TABLE IF NOT EXISTS public.pdf_import_monitoring_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Deterministic dedupe key: `${rule_id}:${dedupe_scope}` (default scope 'global').
  event_key text NOT NULL,

  rule_id text NOT NULL,
  domain text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  owner text NOT NULL DEFAULT 'unknown',
  release_blocking boolean NOT NULL DEFAULT false,

  title text NOT NULL,
  summary text NOT NULL DEFAULT '',

  -- Safe scalar observation + comparison. Stored as text so both numeric and
  -- boolean signal values round-trip without loss; the app normalizes.
  metric_value text,
  threshold text,

  occurrence_count integer NOT NULL DEFAULT 1,

  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  suppressed_until timestamptz,

  note text,

  runbook_anchor text NOT NULL DEFAULT '',

  -- Safe non-sensitive correlation scalars only. Never raw content.
  context jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pdf_import_monitoring_events_event_key_not_empty
    CHECK (length(btrim(event_key)) > 0),
  CONSTRAINT pdf_import_monitoring_events_rule_id_not_empty
    CHECK (length(btrim(rule_id)) > 0),
  CONSTRAINT pdf_import_monitoring_events_severity_valid
    CHECK (severity IN ('info', 'warning', 'high', 'critical')),
  CONSTRAINT pdf_import_monitoring_events_status_valid
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'suppressed', 'false_positive')),
  CONSTRAINT pdf_import_monitoring_events_occurrence_count_positive
    CHECK (occurrence_count >= 1)
);

COMMENT ON TABLE public.pdf_import_monitoring_events IS
  'Durable PDF import monitoring/alert event ledger (Phase 11C). Metadata only — never raw PDF/OCR text, screenshots, signed URLs, or private content. Non-remediating.';

-- One live (open/acknowledged/suppressed) event per dedupe key. Resolved and
-- false_positive rows are historical and excluded from the uniqueness guard so
-- a recurrence can open a fresh event without colliding with closed history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pdf_import_monitoring_events_active_key
  ON public.pdf_import_monitoring_events (event_key)
  WHERE status IN ('open', 'acknowledged', 'suppressed');

CREATE INDEX IF NOT EXISTS idx_pdf_import_monitoring_events_status
  ON public.pdf_import_monitoring_events (status);
CREATE INDEX IF NOT EXISTS idx_pdf_import_monitoring_events_severity
  ON public.pdf_import_monitoring_events (severity);
CREATE INDEX IF NOT EXISTS idx_pdf_import_monitoring_events_domain
  ON public.pdf_import_monitoring_events (domain);
CREATE INDEX IF NOT EXISTS idx_pdf_import_monitoring_events_rule_id
  ON public.pdf_import_monitoring_events (rule_id);
CREATE INDEX IF NOT EXISTS idx_pdf_import_monitoring_events_last_seen_at
  ON public.pdf_import_monitoring_events (last_seen_at DESC);

-- Keep updated_at fresh via the shared repo trigger helper.
DROP TRIGGER IF EXISTS trg_pdf_import_monitoring_events_updated_at ON public.pdf_import_monitoring_events;
CREATE TRIGGER trg_pdf_import_monitoring_events_updated_at
  BEFORE UPDATE ON public.pdf_import_monitoring_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Row level security: writes are service-role only; reads are admin-only. The
-- browser client is anonymous under this app's custom-auth flow, so all reads
-- go through the secure edge function which re-checks admin/monitoring
-- capability server-side. The direct SELECT policy is a defence-in-depth guard
-- for any authenticated JWT context.
ALTER TABLE public.pdf_import_monitoring_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.pdf_import_monitoring_events TO authenticated;
GRANT ALL ON public.pdf_import_monitoring_events TO service_role;

DROP POLICY IF EXISTS "Service role manages monitoring events" ON public.pdf_import_monitoring_events;
CREATE POLICY "Service role manages monitoring events"
  ON public.pdf_import_monitoring_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view monitoring events" ON public.pdf_import_monitoring_events;
CREATE POLICY "Admins can view monitoring events"
  ON public.pdf_import_monitoring_events
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
  );

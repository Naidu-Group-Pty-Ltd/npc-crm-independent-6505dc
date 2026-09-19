-- =========================================================
-- Phase 0: Freeze & Snapshot for GHL account migration
-- =========================================================

-- 1. Baseline snapshot table (immutable audit log)
CREATE TABLE IF NOT EXISTS public.ghl_migration_baseline (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_label text NOT NULL,
  table_name   text NOT NULL,
  row_count    bigint NOT NULL,
  notes        text,
  captured_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ghl_migration_baseline_label
  ON public.ghl_migration_baseline(snapshot_label);

ALTER TABLE public.ghl_migration_baseline ENABLE ROW LEVEL SECURITY;

-- Superadmin-only access (uses existing has_role pattern)
DROP POLICY IF EXISTS "Superadmins can view baseline" ON public.ghl_migration_baseline;
CREATE POLICY "Superadmins can view baseline"
  ON public.ghl_migration_baseline
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

DROP POLICY IF EXISTS "Superadmins can insert baseline" ON public.ghl_migration_baseline;
CREATE POLICY "Superadmins can insert baseline"
  ON public.ghl_migration_baseline
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

-- 2. Capture initial snapshot
INSERT INTO public.ghl_migration_baseline (snapshot_label, table_name, row_count, notes)
SELECT 'phase-0-pre-migration', t.table_name, t.row_count, 'Captured at start of dual-GHL migration'
FROM (
  SELECT 'clients_with_ghl_contact_id' AS table_name, (SELECT COUNT(*) FROM public.clients WHERE ghl_contact_id IS NOT NULL) AS row_count
  UNION ALL SELECT 'clients_total', (SELECT COUNT(*) FROM public.clients)
  UNION ALL SELECT 'ghl_client_opportunities', (SELECT COUNT(*) FROM public.ghl_client_opportunities)
  UNION ALL SELECT 'ghl_conversations', (SELECT COUNT(*) FROM public.ghl_conversations)
  UNION ALL SELECT 'ghl_conversation_messages', (SELECT COUNT(*) FROM public.ghl_conversation_messages)
  UNION ALL SELECT 'client_notes_total', (SELECT COUNT(*) FROM public.client_notes)
  UNION ALL SELECT 'client_notes_with_ghl_note_id', (SELECT COUNT(*) FROM public.client_notes WHERE ghl_note_id IS NOT NULL)
  UNION ALL SELECT 'ghl_pipelines', (SELECT COUNT(*) FROM public.ghl_pipelines)
  UNION ALL SELECT 'ghl_pipeline_stages', (SELECT COUNT(*) FROM public.ghl_pipeline_stages)
  UNION ALL SELECT 'ghl_workflows', (SELECT COUNT(*) FROM public.ghl_workflows)
  UNION ALL SELECT 'ghl_forms', (SELECT COUNT(*) FROM public.ghl_forms)
  UNION ALL SELECT 'ghl_funnels', (SELECT COUNT(*) FROM public.ghl_funnels)
  UNION ALL SELECT 'ghl_funnel_pages', (SELECT COUNT(*) FROM public.ghl_funnel_pages)
  UNION ALL SELECT 'ghl_id_mapping', (SELECT COUNT(*) FROM public.ghl_id_mapping)
) t;

-- 3. Pause both GHL cron jobs (use cron.alter_job to keep job definitions)
DO $$
DECLARE
  jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname IN ('sync-ghl-conversations-cron', 'sync-ghl-marketing-assets-6h') LOOP
    PERFORM cron.alter_job(job_id := jid, active := false);
  END LOOP;
END $$;

-- 4. Record the pause action in the baseline table for audit trail
INSERT INTO public.ghl_migration_baseline (snapshot_label, table_name, row_count, notes)
VALUES
  ('phase-0-cron-paused', 'sync-ghl-conversations-cron', 0, 'Cron job paused at Phase 0 start'),
  ('phase-0-cron-paused', 'sync-ghl-marketing-assets-6h', 0, 'Cron job paused at Phase 0 start');
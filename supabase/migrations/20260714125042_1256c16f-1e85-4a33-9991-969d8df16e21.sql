-- Dedupe: null out idempotency_key on old rows so the partial unique index can be created
UPDATE public.pdf_import_jobs SET idempotency_key = NULL
WHERE idempotency_key IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (idempotency_key) id
    FROM public.pdf_import_jobs
    WHERE idempotency_key IS NOT NULL
      AND status IN ('queued','uploading','parsing','mapping','finalizing','succeeded')
    ORDER BY idempotency_key, updated_at DESC
  )
  AND status IN ('queued','uploading','parsing','mapping','finalizing','succeeded');

-- Now re-run everything (idempotent — earlier successful pieces are no-ops)

-- 20260611120000_resolve_report_template_rpc.sql
CREATE OR REPLACE FUNCTION public.resolve_report_template(
  p_report_type text, p_variant text DEFAULT NULL, p_agency_id uuid DEFAULT NULL, p_user_id uuid DEFAULT NULL
) RETURNS TABLE (template jsonb, source text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH candidates AS (
    SELECT t.*, CASE
        WHEN t.scope='user' AND p_user_id IS NOT NULL AND t.owner_user_id=p_user_id AND (t.variant IS NULL OR t.variant=p_variant) THEN 1
        WHEN t.scope='agency' AND p_agency_id IS NOT NULL AND t.agency_id=p_agency_id AND (t.variant IS NULL OR t.variant=p_variant) THEN 2
        WHEN COALESCE(t.scope,'global')='global' AND t.variant IS NOT NULL AND t.variant=p_variant THEN 3
        WHEN COALESCE(t.scope,'global')='global' AND t.variant IS NULL THEN 4
        ELSE NULL END AS rank_source
    FROM public.report_templates t WHERE t.report_type=lower(p_report_type) AND t.is_active=true)
  SELECT to_jsonb(c) - 'rank_source' AS template,
    CASE c.rank_source WHEN 1 THEN 'user' WHEN 2 THEN 'agency' WHEN 3 THEN 'global-variant' ELSE 'global-any' END AS source
  FROM candidates c WHERE c.rank_source IS NOT NULL
  ORDER BY c.rank_source ASC, COALESCE(c.priority,0) DESC, c.updated_at DESC NULLS LAST LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_report_template(text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_report_template(text, text, uuid, uuid) TO service_role;

ALTER TABLE public.pdf_import_jobs
  ADD COLUMN IF NOT EXISTS attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS timed_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS callback_received_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_import_jobs_idempotency_active
  ON public.pdf_import_jobs(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status IN ('queued','uploading','parsing','mapping','finalizing','succeeded');
CREATE INDEX IF NOT EXISTS idx_pdf_import_jobs_stale_inflight
  ON public.pdf_import_jobs(status, updated_at)
  WHERE status IN ('queued','uploading','parsing','mapping','finalizing');
CREATE OR REPLACE FUNCTION public.gc_pdf_import_jobs() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, storage AS $$
BEGIN
  UPDATE public.pdf_import_jobs
  SET status='failed', stage='failed', error_code='timeout',
      error_text='PDF import timed out after 15 minutes without completion.',
      timed_out_at=now(), finished_at=COALESCE(finished_at, now()), updated_at=now()
  WHERE status IN ('queued','uploading','parsing','mapping','finalizing')
    AND updated_at < now() - interval '15 minutes';
  DELETE FROM storage.objects WHERE bucket_id='pdf-import-diagnostics' AND created_at < now() - interval '7 days';
END; $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='pdf-import-jobs-gc-nightly') THEN PERFORM cron.unschedule('pdf-import-jobs-gc-nightly'); END IF;
END $$;
SELECT cron.schedule('pdf-import-jobs-gc-nightly', '17 3 * * *', $$SELECT public.gc_pdf_import_jobs();$$);

ALTER TABLE public.pdf_import_jobs
  ADD COLUMN IF NOT EXISTS cloud_run_ms integer,
  ADD COLUMN IF NOT EXISTS bytes_in bigint,
  ADD COLUMN IF NOT EXISTS bytes_out bigint;
CREATE INDEX IF NOT EXISTS idx_pdf_import_jobs_engine_version
  ON public.pdf_import_jobs(engine_version, created_at DESC) WHERE engine_version IS NOT NULL;
CREATE MATERIALIZED VIEW IF NOT EXISTS public.pdf_import_cost_daily AS
SELECT date_trunc('day', created_at)::date AS day, engine, coalesce(engine_version,'') AS engine_version,
  count(*)::integer AS jobs,
  count(*) FILTER (WHERE status='succeeded')::integer AS succeeded,
  count(*) FILTER (WHERE status='failed')::integer AS failed,
  coalesce(sum(cloud_run_ms),0)::bigint AS cloud_run_ms,
  coalesce(sum(bytes_in),0)::bigint AS bytes_in,
  coalesce(sum(bytes_out),0)::bigint AS bytes_out,
  round(avg(duration_ms)::numeric, 2) AS avg_duration_ms,
  round(avg(ssim_score)::numeric, 4) AS avg_ssim_score
FROM public.pdf_import_jobs GROUP BY 1,2,3;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_import_cost_daily_key ON public.pdf_import_cost_daily(day, engine, engine_version);
CREATE OR REPLACE FUNCTION public.refresh_pdf_import_cost_daily() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.pdf_import_cost_daily; $$;

CREATE OR REPLACE FUNCTION public.append_pdf_import_attempt(p_job_id uuid, p_attempt jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE public.pdf_import_jobs
  SET attempts = coalesce(attempts,'[]'::jsonb) || jsonb_build_array(coalesce(p_attempt,'{}'::jsonb) || jsonb_build_object('recorded_at', now())),
      updated_at = now()
  WHERE id = p_job_id;
$$;
CREATE OR REPLACE FUNCTION public.check_pdf_import_success_rate() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE total_count integer; success_count integer; success_rate numeric; alert_id uuid; alert_severity text; superadmin_id uuid;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status='succeeded') INTO total_count, success_count
  FROM public.pdf_import_jobs WHERE created_at >= now() - interval '1 hour' AND status IN ('succeeded','failed');
  IF total_count < 5 THEN RETURN; END IF;
  success_rate := success_count::numeric / total_count::numeric;
  alert_severity := CASE WHEN success_rate < 0.75 THEN 'critical' ELSE 'warning' END;
  IF success_rate < 0.90 THEN
    INSERT INTO public.system_alerts(kind, severity, message, payload)
    SELECT 'pdf_import_success_rate_low', alert_severity,
      'PDF import success rate fell below 90% over the last hour.',
      jsonb_build_object('window','1 hour','success_rate',round(success_rate,4),'total',total_count,'succeeded',success_count,'failed',total_count-success_count,'web_push_audience','superadmin')
    WHERE NOT EXISTS (SELECT 1 FROM public.system_alerts WHERE kind='pdf_import_success_rate_low' AND created_at >= now() - interval '1 hour')
    RETURNING id INTO alert_id;
    IF alert_id IS NULL THEN RETURN; END IF;
    FOR superadmin_id IN SELECT DISTINCT user_id FROM public.user_roles WHERE role='superadmin' LOOP
      INSERT INTO public.notifications (type, title, message, entity_id, target_user_id, metadata)
      VALUES ('info', 'PDF import success rate is low',
        format('PDF imports are succeeding at %s%% over the last hour (%s/%s).', round(success_rate*100,1), success_count, total_count),
        alert_id::text, superadmin_id,
        jsonb_build_object('kind','pdf_import_success_rate_low','severity',alert_severity,'success_rate',round(success_rate,4),'total',total_count,'succeeded',success_count,'failed',total_count-success_count,'url','/admin/pdf-import-diagnostics'));
    END LOOP;
  END IF;
END; $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='pdf-import-cost-daily-refresh-hourly') THEN PERFORM cron.unschedule('pdf-import-cost-daily-refresh-hourly'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='pdf-import-success-rate-alert-hourly') THEN PERFORM cron.unschedule('pdf-import-success-rate-alert-hourly'); END IF;
END $$;
SELECT cron.schedule('pdf-import-cost-daily-refresh-hourly', '9 * * * *', $$SELECT public.refresh_pdf_import_cost_daily();$$);
SELECT cron.schedule('pdf-import-success-rate-alert-hourly', '*/15 * * * *', $$SELECT public.check_pdf_import_success_rate();$$);

CREATE TABLE IF NOT EXISTS public.pdf_import_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.pdf_import_jobs(id) ON DELETE SET NULL,
  actor_id uuid, action text NOT NULL, diagnostics_path text, file_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.pdf_import_audit_log TO authenticated;
GRANT ALL ON public.pdf_import_audit_log TO service_role;
ALTER TABLE public.pdf_import_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "superadmins read pdf import audit" ON public.pdf_import_audit_log;
CREATE POLICY "superadmins read pdf import audit" ON public.pdf_import_audit_log FOR SELECT TO authenticated USING (has_role(auth.uid(),'superadmin'::app_role));
DROP POLICY IF EXISTS "service writes pdf import audit" ON public.pdf_import_audit_log;
CREATE POLICY "service writes pdf import audit" ON public.pdf_import_audit_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_pdf_import_audit_job_created ON public.pdf_import_audit_log(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdf_import_audit_actor_created ON public.pdf_import_audit_log(actor_id, created_at DESC);

DELETE FROM public.feature_flags WHERE key = 'pdf_import.engine';

ALTER TABLE public.checklist_instances
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS recurrence_key TEXT;
UPDATE public.checklist_instances SET due_date = created_at::date WHERE due_date IS NULL;
WITH ranked_instances AS (
  SELECT ci.id,
    COALESCE(ci.template_id::text, ci.id::text) || ':' || ci.due_date::text || ':' || COALESCE(ct.created_by::text, ci.generated_by::text, 'global') AS canonical_key,
    row_number() OVER (PARTITION BY ci.template_id, ci.due_date, COALESCE(ct.created_by::text, ci.generated_by::text, 'global') ORDER BY ci.created_at, ci.id) AS duplicate_rank
  FROM public.checklist_instances ci
  LEFT JOIN public.checklist_templates ct ON ct.id = ci.template_id
  WHERE ci.recurrence_key IS NULL)
UPDATE public.checklist_instances ci
SET recurrence_key = CASE WHEN ranked_instances.duplicate_rank = 1 THEN ranked_instances.canonical_key ELSE ranked_instances.canonical_key || ':' || ci.id::text END
FROM ranked_instances WHERE ci.id = ranked_instances.id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_instances_recurrence_key
  ON public.checklist_instances(recurrence_key) WHERE recurrence_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checklist_instances_due_date ON public.checklist_instances(due_date);
CREATE INDEX IF NOT EXISTS idx_checklist_instances_template_due_date
  ON public.checklist_instances(template_id, due_date) WHERE template_id IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS public.market_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, description text, source_type text NOT NULL, url text NOT NULL, category text NOT NULL, geography text NOT NULL DEFAULT 'Australia', reliability_tier text NOT NULL DEFAULT 'watchlist', enabled boolean NOT NULL DEFAULT true, refresh_frequency_hours integer NOT NULL DEFAULT 24, last_fetched_at timestamptz, last_success_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.market_sources TO authenticated;
GRANT ALL ON public.market_sources TO service_role;
CREATE TABLE IF NOT EXISTS public.market_updates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid REFERENCES public.market_sources(id) ON DELETE SET NULL, source_name text NOT NULL, source_url text NOT NULL, source_published_at timestamptz, ingested_at timestamptz NOT NULL DEFAULT now(), title text NOT NULL, slug text, category text NOT NULL, geography jsonb NOT NULL DEFAULT '[]'::jsonb, impact_level text NOT NULL DEFAULT 'medium', audience_tags jsonb NOT NULL DEFAULT '[]'::jsonb, raw_excerpt text, raw_content_hash text, ai_summary text, key_points jsonb NOT NULL DEFAULT '[]'::jsonb, why_it_matters text, property_implications text, finance_implications text, policy_implications text, risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb, confidence_score numeric, citation_urls jsonb NOT NULL DEFAULT '[]'::jsonb, relevance_score numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'candidate', failure_reason text, dedupe_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.market_updates TO authenticated;
GRANT ALL ON public.market_updates TO service_role;
CREATE TABLE IF NOT EXISTS public.market_digests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), generated_at timestamptz NOT NULL DEFAULT now(), period_start timestamptz NOT NULL, period_end timestamptz NOT NULL, executive_summary text NOT NULL, top_update_ids jsonb NOT NULL DEFAULT '[]'::jsonb, finance_lending_highlights jsonb NOT NULL DEFAULT '[]'::jsonb, property_market_highlights jsonb NOT NULL DEFAULT '[]'::jsonb, construction_supply_highlights jsonb NOT NULL DEFAULT '[]'::jsonb, policy_regulation_highlights jsonb NOT NULL DEFAULT '[]'::jsonb, political_economic_watchpoints jsonb NOT NULL DEFAULT '[]'::jsonb, buyer_implications text, investor_implications text, broker_adviser_implications text, client_advisory_implications jsonb NOT NULL DEFAULT '[]'::jsonb, recommended_watchlist_for_tomorrow jsonb NOT NULL DEFAULT '[]'::jsonb, source_urls jsonb NOT NULL DEFAULT '[]'::jsonb, confidence_score numeric, status text NOT NULL DEFAULT 'published', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.market_digests TO authenticated;
GRANT ALL ON public.market_digests TO service_role;
CREATE TABLE IF NOT EXISTS public.market_update_questions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), question text NOT NULL, answer text NOT NULL, source_update_ids jsonb NOT NULL DEFAULT '[]'::jsonb, citation_urls jsonb NOT NULL DEFAULT '[]'::jsonb, confidence_score numeric, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT ON public.market_update_questions TO authenticated;
GRANT ALL ON public.market_update_questions TO service_role;
CREATE INDEX IF NOT EXISTS idx_market_sources_enabled ON public.market_sources(enabled);
CREATE INDEX IF NOT EXISTS idx_market_sources_category ON public.market_sources(category);
CREATE INDEX IF NOT EXISTS idx_market_updates_status ON public.market_updates(status);
CREATE INDEX IF NOT EXISTS idx_market_updates_category ON public.market_updates(category);
CREATE INDEX IF NOT EXISTS idx_market_updates_impact ON public.market_updates(impact_level);
CREATE INDEX IF NOT EXISTS idx_market_updates_source_published_at ON public.market_updates(source_published_at);
CREATE INDEX IF NOT EXISTS idx_market_updates_ingested_at ON public.market_updates(ingested_at);
CREATE INDEX IF NOT EXISTS idx_market_updates_dedupe_hash ON public.market_updates(dedupe_hash);
CREATE INDEX IF NOT EXISTS idx_market_digests_generated_at ON public.market_digests(generated_at);
ALTER TABLE public.market_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_update_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read market sources" ON public.market_sources;
CREATE POLICY "Authenticated users can read market sources" ON public.market_sources FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can read published market updates" ON public.market_updates;
CREATE POLICY "Authenticated users can read published market updates" ON public.market_updates FOR SELECT TO authenticated USING (status='published');
DROP POLICY IF EXISTS "Authenticated users can read published market digests" ON public.market_digests;
CREATE POLICY "Authenticated users can read published market digests" ON public.market_digests FOR SELECT TO authenticated USING (status='published');
DROP POLICY IF EXISTS "Authenticated users can insert own market questions" ON public.market_update_questions;
CREATE POLICY "Authenticated users can insert own market questions" ON public.market_update_questions FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can read market questions" ON public.market_update_questions;
CREATE POLICY "Authenticated users can read market questions" ON public.market_update_questions FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.pdf_import_monitoring_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL, rule_id text NOT NULL, domain text NOT NULL,
  severity text NOT NULL, status text NOT NULL DEFAULT 'open',
  owner text NOT NULL DEFAULT 'unknown', release_blocking boolean NOT NULL DEFAULT false,
  title text NOT NULL, summary text NOT NULL DEFAULT '',
  metric_value text, threshold text,
  occurrence_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz, acknowledged_by uuid,
  resolved_at timestamptz, resolved_by uuid, suppressed_until timestamptz,
  note text, runbook_anchor text NOT NULL DEFAULT '',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pdf_import_monitoring_events_event_key_not_empty CHECK (length(btrim(event_key)) > 0),
  CONSTRAINT pdf_import_monitoring_events_rule_id_not_empty CHECK (length(btrim(rule_id)) > 0),
  CONSTRAINT pdf_import_monitoring_events_severity_valid CHECK (severity IN ('info','warning','high','critical')),
  CONSTRAINT pdf_import_monitoring_events_status_valid CHECK (status IN ('open','acknowledged','resolved','suppressed','false_positive')),
  CONSTRAINT pdf_import_monitoring_events_occurrence_count_positive CHECK (occurrence_count >= 1)
);
GRANT SELECT ON public.pdf_import_monitoring_events TO authenticated;
GRANT ALL ON public.pdf_import_monitoring_events TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pdf_import_monitoring_events_active_key ON public.pdf_import_monitoring_events (event_key) WHERE status IN ('open','acknowledged','suppressed');
CREATE INDEX IF NOT EXISTS idx_pdf_import_monitoring_events_status ON public.pdf_import_monitoring_events (status);
CREATE INDEX IF NOT EXISTS idx_pdf_import_monitoring_events_severity ON public.pdf_import_monitoring_events (severity);
CREATE INDEX IF NOT EXISTS idx_pdf_import_monitoring_events_domain ON public.pdf_import_monitoring_events (domain);
CREATE INDEX IF NOT EXISTS idx_pdf_import_monitoring_events_rule_id ON public.pdf_import_monitoring_events (rule_id);
CREATE INDEX IF NOT EXISTS idx_pdf_import_monitoring_events_last_seen_at ON public.pdf_import_monitoring_events (last_seen_at DESC);
DROP TRIGGER IF EXISTS trg_pdf_import_monitoring_events_updated_at ON public.pdf_import_monitoring_events;
CREATE TRIGGER trg_pdf_import_monitoring_events_updated_at BEFORE UPDATE ON public.pdf_import_monitoring_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.pdf_import_monitoring_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages monitoring events" ON public.pdf_import_monitoring_events;
CREATE POLICY "Service role manages monitoring events" ON public.pdf_import_monitoring_events FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can view monitoring events" ON public.pdf_import_monitoring_events;
CREATE POLICY "Admins can view monitoring events" ON public.pdf_import_monitoring_events FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'superadmin'::app_role));

CREATE TABLE IF NOT EXISTS public.pdf_import_retention_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retention_rule_id text NOT NULL, domain text NOT NULL,
  decision text NOT NULL, cleanup_action text NOT NULL, safety_level text NOT NULL,
  status text NOT NULL DEFAULT 'candidate',
  title text NOT NULL, message text NOT NULL,
  scope_type text NOT NULL, scope_id text NOT NULL, scope_label text,
  dedupe_key text NOT NULL,
  storage_bucket text, storage_object_path text,
  import_id uuid REFERENCES public.template_imports(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.report_templates(id) ON DELETE SET NULL,
  monitoring_event_id uuid REFERENCES public.pdf_import_monitoring_events(id) ON DELETE SET NULL,
  golden_run_id uuid REFERENCES public.pdf_import_golden_runs(id) ON DELETE SET NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb, recommended_action text NOT NULL,
  estimated_bytes bigint, object_created_at timestamptz, object_updated_at timestamptz,
  source text NOT NULL DEFAULT 'pdf_import_retention', run_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1,
  reviewed_by uuid, reviewed_at timestamptz, review_note text,
  approved_by uuid, approved_at timestamptz, approval_note text,
  rejected_by uuid, rejected_at timestamptz, rejection_note text,
  blocked_by uuid, blocked_at timestamptz, block_note text,
  completed_by uuid, completed_at timestamptz, completion_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pdf_import_retention_events_decision_valid CHECK (decision IN ('retain','review','archive_candidate','delete_candidate','blocked','unknown')),
  CONSTRAINT pdf_import_retention_events_cleanup_action_valid CHECK (cleanup_action IN ('no_action','mark_for_review','archive_later','delete_later','compact_metadata_later','repair_reference','preserve_for_audit','preserve_for_regression','preserve_for_manual_review','blocked_from_cleanup')),
  CONSTRAINT pdf_import_retention_events_safety_level_valid CHECK (safety_level IN ('safe_to_recommend','requires_operator_approval','requires_developer_approval','manual_only','blocked')),
  CONSTRAINT pdf_import_retention_events_status_valid CHECK (status IN ('candidate','reviewed','approved_for_future_cleanup','rejected','blocked','completed','superseded')),
  CONSTRAINT pdf_import_retention_events_occurrence_positive CHECK (occurrence_count >= 1),
  CONSTRAINT pdf_import_retention_events_bytes_nonneg CHECK (estimated_bytes IS NULL OR estimated_bytes >= 0),
  CONSTRAINT pdf_import_retention_events_rule_id_not_empty CHECK (length(btrim(retention_rule_id)) > 0),
  CONSTRAINT pdf_import_retention_events_domain_not_empty CHECK (length(btrim(domain)) > 0),
  CONSTRAINT pdf_import_retention_events_scope_type_not_empty CHECK (length(btrim(scope_type)) > 0),
  CONSTRAINT pdf_import_retention_events_scope_id_not_empty CHECK (length(btrim(scope_id)) > 0),
  CONSTRAINT pdf_import_retention_events_dedupe_key_not_empty CHECK (length(btrim(dedupe_key)) > 0)
);
GRANT SELECT ON public.pdf_import_retention_events TO authenticated;
GRANT ALL ON public.pdf_import_retention_events TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pdf_import_retention_events_active_dedupe
  ON public.pdf_import_retention_events (dedupe_key)
  WHERE status IN ('candidate','reviewed','approved_for_future_cleanup','blocked');
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_status ON public.pdf_import_retention_events (status);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_decision ON public.pdf_import_retention_events (decision);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_cleanup_action ON public.pdf_import_retention_events (cleanup_action);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_safety_level ON public.pdf_import_retention_events (safety_level);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_domain ON public.pdf_import_retention_events (domain);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_rule_id ON public.pdf_import_retention_events (retention_rule_id);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_scope ON public.pdf_import_retention_events (scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_import_id ON public.pdf_import_retention_events (import_id);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_template_id ON public.pdf_import_retention_events (template_id);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_monitoring_event_id ON public.pdf_import_retention_events (monitoring_event_id);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_golden_run_id ON public.pdf_import_retention_events (golden_run_id);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_storage ON public.pdf_import_retention_events (storage_bucket, storage_object_path);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_last_seen_at ON public.pdf_import_retention_events (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdf_import_retention_events_created_at ON public.pdf_import_retention_events (created_at DESC);
DROP TRIGGER IF EXISTS trg_pdf_import_retention_events_updated_at ON public.pdf_import_retention_events;
CREATE TRIGGER trg_pdf_import_retention_events_updated_at BEFORE UPDATE ON public.pdf_import_retention_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.pdf_import_retention_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages retention events" ON public.pdf_import_retention_events;
CREATE POLICY "Service role manages retention events" ON public.pdf_import_retention_events FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can view retention events" ON public.pdf_import_retention_events;
CREATE POLICY "Admins can view retention events" ON public.pdf_import_retention_events FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'superadmin'::app_role));

ALTER TABLE public.token_usage_history ADD COLUMN IF NOT EXISTS billing_user_id text;
ALTER TABLE public.token_audit_log ADD COLUMN IF NOT EXISTS billing_user_id text;
CREATE INDEX IF NOT EXISTS idx_tuh_billing_user_created ON public.token_usage_history (billing_user_id, created_at DESC) WHERE billing_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tal_billing_user_created ON public.token_audit_log (billing_user_id, created_at DESC) WHERE billing_user_id IS NOT NULL;
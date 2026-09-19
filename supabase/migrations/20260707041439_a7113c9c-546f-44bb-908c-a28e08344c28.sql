
-- 1) market_qa_digests
CREATE TABLE IF NOT EXISTS public.market_qa_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  cadence text NOT NULL CHECK (cadence IN ('daily','weekly')),
  digest_group text,
  question_ids uuid[] NOT NULL DEFAULT '{}',
  summary_md text NOT NULL,
  delivery_channels text[] NOT NULL DEFAULT ARRAY['in_app']::text[],
  sent_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_qa_digests TO authenticated;
GRANT ALL ON public.market_qa_digests TO service_role;
ALTER TABLE public.market_qa_digests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "digests_owner_all" ON public.market_qa_digests;
CREATE POLICY "digests_owner_all" ON public.market_qa_digests
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_market_qa_digests_user ON public.market_qa_digests(user_id, sent_at DESC);

ALTER TABLE public.market_qa_subscriptions
  ADD COLUMN IF NOT EXISTS digest_group text;

CREATE TABLE IF NOT EXISTS public.market_qa_quality_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL UNIQUE,
  total_questions int NOT NULL DEFAULT 0,
  p50_latency_ms int,
  p95_latency_ms int,
  avg_citations numeric,
  hybrid_count int NOT NULL DEFAULT 0,
  vector_count int NOT NULL DEFAULT 0,
  lexical_count int NOT NULL DEFAULT 0,
  fallback_count int NOT NULL DEFAULT 0,
  hybrid_win_rate numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_qa_quality_daily TO authenticated;
GRANT ALL ON public.market_qa_quality_daily TO service_role;
ALTER TABLE public.market_qa_quality_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quality_daily_superadmin_read" ON public.market_qa_quality_daily;
CREATE POLICY "quality_daily_superadmin_read" ON public.market_qa_quality_daily
  FOR SELECT USING (public.has_role(auth.uid(), 'superadmin'::app_role));
DROP POLICY IF EXISTS "quality_daily_service_write" ON public.market_qa_quality_daily;
CREATE POLICY "quality_daily_service_write" ON public.market_qa_quality_daily
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.agent_skills
  ADD COLUMN IF NOT EXISTS install_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_success_rate numeric;

CREATE TABLE IF NOT EXISTS public.agent_skill_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  skill_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  installed_at timestamptz NOT NULL DEFAULT now(),
  uninstalled_at timestamptz,
  UNIQUE (user_id, skill_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_skill_installs TO authenticated;
GRANT ALL ON public.agent_skill_installs TO service_role;
ALTER TABLE public.agent_skill_installs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "skill_installs_owner_all" ON public.agent_skill_installs;
CREATE POLICY "skill_installs_owner_all" ON public.agent_skill_installs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_installs_user ON public.agent_skill_installs(user_id);

DO $$
DECLARE
  cname text;
BEGIN
  SELECT c.conname INTO cname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND t.relname = 'notifications' AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      'client_activity','deal_stage','system','portal_message','client_portal_report',
      'finance_message','finance_portal_message','client_task','onboarding','booking',
      'lender_submission','decision','condition','valuation','commission','ai_alert',
      'automation','market_update','market_qa','market_qa_subscription','market_qa_digest',
      'agent_plan_scheduled','agent_insight','agent_eval_regression','general',
      'agreement_generated','report_generated','new_ghl_contact','report_failed',
      'new_marketing_lead','info','call_completed','email_received',
      'report_generation_completed','report_generation_failed','portal_report_requested',
      'missed_call','client_reminder_overdue','client_reminder_due','client_reminder_upcoming',
      'report_request','conversation_shared','game_plan_created','game_plan_updated',
      'game_plan_milestone_completed','conversation_reply','lender_submission_status',
      'lender_rate_alert','client_data_updated','portal_message_received',
      'finance_portal_message_received','document_requirement_requested',
      'document_requirement_uploaded','document_requirement_verified','finance_decision_recorded',
      'condition_added','condition_satisfied','valuation_returned','valuation_short',
      'risk_added','risk_escalated','risk_resolved','purchase_file_missing_docs_reminder',
      'purchase_file_finance_clause_t5','purchase_file_finance_clause_t2',
      'purchase_file_valuation_overdue','purchase_file_settlement_t7',
      'purchase_file_unconditional_approval','purchase_file_linked','purchase_file_unlinked',
      'note_added','message_sent','purchase_file_created'
    )
  );

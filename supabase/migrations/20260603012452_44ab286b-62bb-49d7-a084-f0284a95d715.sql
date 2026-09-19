-- Idempotent re-creation of AI copilot tables
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_pf_summaries','ai_doc_classifications','ai_lender_recommendations',
    'ai_risk_alerts','ai_coach_insights','ai_voice_memos','ai_loan_app_prefills'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "service role manages %s" ON public.%s', t, t);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.ai_pf_summaries (
  purchase_file_id uuid PRIMARY KEY REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_pf_summaries TO authenticated;
GRANT ALL ON public.ai_pf_summaries TO service_role;
ALTER TABLE public.ai_pf_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages ai_pf_summaries"
  ON public.ai_pf_summaries FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ai_doc_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  document_instance_id uuid,
  document_id uuid,
  classified_type text,
  suggested_label text,
  period_label text,
  confidence numeric,
  extracted_fields jsonb DEFAULT '{}'::jsonb,
  is_expired boolean DEFAULT false,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_doc_class_pf ON public.ai_doc_classifications(purchase_file_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_doc_class_inst ON public.ai_doc_classifications(document_instance_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_doc_classifications TO authenticated;
GRANT ALL ON public.ai_doc_classifications TO service_role;
ALTER TABLE public.ai_doc_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages ai_doc_classifications"
  ON public.ai_doc_classifications FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ai_lender_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale text,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_lender_rec_pf ON public.ai_lender_recommendations(purchase_file_id, generated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_lender_recommendations TO authenticated;
GRANT ALL ON public.ai_lender_recommendations TO service_role;
ALTER TABLE public.ai_lender_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages ai_lender_recommendations"
  ON public.ai_lender_recommendations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ai_risk_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_user_id uuid REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  purchase_file_id uuid REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  summary text,
  details jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  model text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ai_risk_user_status ON public.ai_risk_alerts(finance_user_id, status, generated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_risk_alerts TO authenticated;
GRANT ALL ON public.ai_risk_alerts TO service_role;
ALTER TABLE public.ai_risk_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages ai_risk_alerts"
  ON public.ai_risk_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ai_coach_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_user_id uuid NOT NULL REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  action_label text,
  action_path text,
  category text,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ai_coach_user ON public.ai_coach_insights(finance_user_id, generated_at DESC) WHERE dismissed_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_coach_insights TO authenticated;
GRANT ALL ON public.ai_coach_insights TO service_role;
ALTER TABLE public.ai_coach_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages ai_coach_insights"
  ON public.ai_coach_insights FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ai_voice_memos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_user_id uuid NOT NULL REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  purchase_file_id uuid REFERENCES public.purchase_files(id) ON DELETE SET NULL,
  client_id uuid,
  transcript text,
  summary text,
  duration_seconds integer,
  saved_as_note boolean DEFAULT false,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_voice_user ON public.ai_voice_memos(finance_user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_voice_memos TO authenticated;
GRANT ALL ON public.ai_voice_memos TO service_role;
ALTER TABLE public.ai_voice_memos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages ai_voice_memos"
  ON public.ai_voice_memos FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ai_loan_app_prefills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  extracted jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_doc_ids uuid[] DEFAULT ARRAY[]::uuid[],
  model text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid
);
CREATE INDEX IF NOT EXISTS idx_ai_prefill_pf ON public.ai_loan_app_prefills(purchase_file_id, generated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_loan_app_prefills TO authenticated;
GRANT ALL ON public.ai_loan_app_prefills TO service_role;
ALTER TABLE public.ai_loan_app_prefills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages ai_loan_app_prefills"
  ON public.ai_loan_app_prefills FOR ALL TO service_role USING (true) WITH CHECK (true);
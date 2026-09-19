
-- ============================================================
-- Aurixa Agent Phase 5: Insights feed, Skills registry, Evals
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_insights_feed (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL DEFAULT 'digest',
  title TEXT NOT NULL,
  summary TEXT,
  body_markdown TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','critical')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'insights-runner',
  related_conversation_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_dismissed BOOLEAN NOT NULL DEFAULT false,
  acted_on_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_insights_feed_user_created ON public.agent_insights_feed(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_insights_feed_active ON public.agent_insights_feed(user_id) WHERE is_dismissed = false;
GRANT ALL ON public.agent_insights_feed TO service_role;
ALTER TABLE public.agent_insights_feed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages agent_insights_feed" ON public.agent_insights_feed;
CREATE POLICY "service role manages agent_insights_feed" ON public.agent_insights_feed FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_skills (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  system_prompt TEXT NOT NULL,
  allowed_tools TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  default_model TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  is_public BOOLEAN NOT NULL DEFAULT false,
  run_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_agent_skills_slug ON public.agent_skills(slug);
GRANT ALL ON public.agent_skills TO service_role;
ALTER TABLE public.agent_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages agent_skills" ON public.agent_skills;
CREATE POLICY "service role manages agent_skills" ON public.agent_skills FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed baseline public skills (Finance, Market, Portfolio, Compliance)
INSERT INTO public.agent_skills (user_id, slug, name, icon, description, system_prompt, allowed_tools, is_public)
VALUES
  (NULL, 'finance', 'Finance Analyst', '💰',
   'Deep-dive on borrowing capacity, cash flow, and lender strategy.',
   'You are the Finance sub-agent. Prioritise borrowing capacity, servicing, lender fit, cash-flow, and repayment strategy. Cite exact numbers from client_income/expenses/liabilities/properties. When data is missing say so — never invent figures.',
   ARRAY['get_borrowing_capacity','get_borrowing_capacity_history','get_income_sources','get_client_expenses','get_client_liabilities','get_client_assets','get_client_properties','get_employment_details','get_client_details','search_clients'],
   true),
  (NULL, 'market', 'Market Intelligence', '📈',
   'Live market intelligence, suburb comparisons, and macro signals.',
   'You are the Market Intelligence sub-agent. Ground every claim in retrieved market_updates. Prefer Perplexity-style citations. If evidence is thin, refuse rather than speculate.',
   ARRAY['search_clients','get_client_properties'],
   true),
  (NULL, 'portfolio', 'Portfolio Strategist', '🏘️',
   'Portfolio-wide review, diversification, and next-property strategy.',
   'You are the Portfolio Strategist sub-agent. Look across every property the client owns before recommending moves. Balance cash-flow, equity, tax, and risk. Highlight concentration risks first.',
   ARRAY['get_client_properties','get_client_details','get_borrowing_capacity','get_client_liabilities','get_client_assets','search_clients'],
   true),
  (NULL, 'compliance', 'Compliance Watchdog', '🛡️',
   'NCCP, VOI, and audit-trail checks across purchase files and deals.',
   'You are the Compliance sub-agent. Flag NCCP gaps, missing VOI, stale credit checks, and audit-chain breaks. Never say "looks fine" without checking the audit timeline.',
   ARRAY['get_client_deals','get_pipeline_overview','get_stale_deals','get_client_details'],
   true)
ON CONFLICT (user_id, slug) DO NOTHING;

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_evals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID,
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  expected_tools TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  expected_contains TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  expected_not_contains TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  grader_prompt TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT ALL ON public.agent_evals TO service_role;
ALTER TABLE public.agent_evals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages agent_evals" ON public.agent_evals;
CREATE POLICY "service role manages agent_evals" ON public.agent_evals FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.agent_eval_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  eval_id UUID NOT NULL REFERENCES public.agent_evals(id) ON DELETE CASCADE,
  triggered_by UUID,
  model TEXT,
  passed BOOLEAN,
  score NUMERIC,
  grader_reasoning TEXT,
  response_text TEXT,
  tool_calls_used TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  latency_ms INTEGER,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_eval_runs_eval_created ON public.agent_eval_runs(eval_id, created_at DESC);
GRANT ALL ON public.agent_eval_runs TO service_role;
ALTER TABLE public.agent_eval_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages agent_eval_runs" ON public.agent_eval_runs;
CREATE POLICY "service role manages agent_eval_runs" ON public.agent_eval_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- Updated_at trigger for new tables
CREATE OR REPLACE FUNCTION public.agent_phase5_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_agent_skills_touch ON public.agent_skills;
CREATE TRIGGER trg_agent_skills_touch BEFORE UPDATE ON public.agent_skills
  FOR EACH ROW EXECUTE FUNCTION public.agent_phase5_touch_updated_at();

DROP TRIGGER IF EXISTS trg_agent_evals_touch ON public.agent_evals;
CREATE TRIGGER trg_agent_evals_touch BEFORE UPDATE ON public.agent_evals
  FOR EACH ROW EXECUTE FUNCTION public.agent_phase5_touch_updated_at();

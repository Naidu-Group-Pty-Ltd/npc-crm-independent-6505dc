-- Enable pgvector for persistent semantic recall
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================================
-- Track A: Market Updates Q&A Phase 6
-- =====================================================================

-- Persistent embeddings on market_updates
ALTER TABLE public.market_updates
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_generated_at timestamptz;

CREATE INDEX IF NOT EXISTS market_updates_embedding_idx
  ON public.market_updates USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS market_updates_embedding_pending_idx
  ON public.market_updates (created_at)
  WHERE embedding IS NULL;

-- Public share links for Q&A answers
CREATE TABLE IF NOT EXISTS public.market_update_qa_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.market_update_questions(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  expires_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  is_revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.market_update_qa_shares TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_update_qa_shares TO authenticated;
GRANT ALL ON public.market_update_qa_shares TO service_role;
ALTER TABLE public.market_update_qa_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view non-revoked share by slug"
  ON public.market_update_qa_shares FOR SELECT
  USING (is_revoked = false);

CREATE POLICY "Owners can create share links"
  ON public.market_update_qa_shares FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Owners can update own shares"
  ON public.market_update_qa_shares FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Owners can delete own shares"
  ON public.market_update_qa_shares FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

CREATE INDEX IF NOT EXISTS market_update_qa_shares_slug_idx
  ON public.market_update_qa_shares (slug) WHERE is_revoked = false;

-- Nightly quality baseline aggregate for /admin/market-qa-quality trend view
CREATE TABLE IF NOT EXISTS public.market_qa_quality_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL UNIQUE,
  total_questions integer NOT NULL DEFAULT 0,
  refusal_count integer NOT NULL DEFAULT 0,
  refusal_rate numeric NOT NULL DEFAULT 0,
  avg_confidence numeric,
  avg_retrieved_ids numeric,
  avg_used_ids numeric,
  model_mix jsonb NOT NULL DEFAULT '{}'::jsonb,
  low_confidence_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_qa_quality_baselines TO authenticated;
GRANT ALL ON public.market_qa_quality_baselines TO service_role;
ALTER TABLE public.market_qa_quality_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages quality baselines"
  ON public.market_qa_quality_baselines FOR ALL
  USING (false) WITH CHECK (false);

-- =====================================================================
-- Track B: Aurixa Agent Phase 6
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.agent_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  goal text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  skill_slug text,
  requires_approval boolean NOT NULL DEFAULT true,
  planner_model text,
  total_steps integer NOT NULL DEFAULT 0,
  completed_steps integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_plans TO authenticated;
GRANT ALL ON public.agent_plans TO service_role;
ALTER TABLE public.agent_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own plans"
  ON public.agent_plans FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS agent_plans_user_status_idx
  ON public.agent_plans (user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_plan_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  title text NOT NULL,
  description text,
  expected_output text,
  tool_hint text,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, seq)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_plan_steps TO authenticated;
GRANT ALL ON public.agent_plan_steps TO service_role;
ALTER TABLE public.agent_plan_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access steps of own plans"
  ON public.agent_plan_steps FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agent_plans p WHERE p.id = plan_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.agent_plans p WHERE p.id = plan_id AND p.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS agent_plan_steps_plan_seq_idx
  ON public.agent_plan_steps (plan_id, seq);

-- Promoted eval baselines for regression tracking
CREATE TABLE IF NOT EXISTS public.agent_eval_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  notes text,
  promoted_by uuid NOT NULL,
  eval_count integer NOT NULL DEFAULT 0,
  pass_count integer NOT NULL DEFAULT 0,
  pass_rate numeric NOT NULL DEFAULT 0,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_eval_baselines TO authenticated;
GRANT ALL ON public.agent_eval_baselines TO service_role;
ALTER TABLE public.agent_eval_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages eval baselines"
  ON public.agent_eval_baselines FOR ALL
  USING (false) WITH CHECK (false);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_plans_touch ON public.agent_plans;
CREATE TRIGGER agent_plans_touch
  BEFORE UPDATE ON public.agent_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS agent_plan_steps_touch ON public.agent_plan_steps;
CREATE TRIGGER agent_plan_steps_touch
  BEFORE UPDATE ON public.agent_plan_steps
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS market_update_qa_shares_touch ON public.market_update_qa_shares;
CREATE TRIGGER market_update_qa_shares_touch
  BEFORE UPDATE ON public.market_update_qa_shares
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
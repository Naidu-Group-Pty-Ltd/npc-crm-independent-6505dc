-- Phase 7 — Market Q&A + Aurixa Agent
ALTER TABLE public.market_updates
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title,'') || ' ' ||
      coalesce(ai_summary,'') || ' ' ||
      coalesce(why_it_matters,'') || ' ' ||
      coalesce(raw_excerpt,'')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS market_updates_search_tsv_idx
  ON public.market_updates USING gin (search_tsv);

CREATE TABLE IF NOT EXISTS public.market_qa_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  question_template text NOT NULL,
  cadence text NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('daily','weekly')),
  channels text[] NOT NULL DEFAULT ARRAY['in_app']::text[],
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_qa_subscriptions TO authenticated;
GRANT ALL ON public.market_qa_subscriptions TO service_role;
ALTER TABLE public.market_qa_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own qa subscriptions"
  ON public.market_qa_subscriptions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS market_qa_subscriptions_user_idx
  ON public.market_qa_subscriptions (user_id, is_active, next_run_at);

CREATE TABLE IF NOT EXISTS public.market_qa_subscription_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.market_qa_subscriptions(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.market_update_questions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ok',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_qa_subscription_runs TO authenticated;
GRANT ALL ON public.market_qa_subscription_runs TO service_role;
ALTER TABLE public.market_qa_subscription_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own subscription runs"
  ON public.market_qa_subscription_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.market_qa_subscriptions s WHERE s.id = subscription_id AND s.user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS market_qa_subscription_runs_sub_idx
  ON public.market_qa_subscription_runs (subscription_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.tg_qa_subs_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS market_qa_subscriptions_touch ON public.market_qa_subscriptions;
CREATE TRIGGER market_qa_subscriptions_touch
  BEFORE UPDATE ON public.market_qa_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_qa_subs_touch();

-- Agent plan scheduling
ALTER TABLE public.agent_plans
  ADD COLUMN IF NOT EXISTS schedule_cron text,
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_execute boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS agent_plans_next_run_idx
  ON public.agent_plans (next_run_at) WHERE schedule_cron IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_plan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  triggered_by text NOT NULL DEFAULT 'manual',
  steps_executed integer NOT NULL DEFAULT 0,
  steps_failed integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_plan_runs TO authenticated;
GRANT ALL ON public.agent_plan_runs TO service_role;
ALTER TABLE public.agent_plan_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own plan runs"
  ON public.agent_plan_runs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS agent_plan_runs_plan_idx
  ON public.agent_plan_runs (plan_id, started_at DESC);

ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS step_id uuid;
ALTER TABLE public.agent_action_log
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS step_id uuid;
CREATE INDEX IF NOT EXISTS agent_messages_plan_idx
  ON public.agent_messages (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_action_log_plan_idx
  ON public.agent_action_log (plan_id) WHERE plan_id IS NOT NULL;

ALTER TABLE public.market_update_questions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_market_qq_created ON public.market_update_questions(created_at DESC);

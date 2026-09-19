ALTER TABLE public.investment_reports
ADD COLUMN IF NOT EXISTS generation_engine text NOT NULL DEFAULT 'legacy'
CHECK (generation_engine IN ('legacy','compass-40'));
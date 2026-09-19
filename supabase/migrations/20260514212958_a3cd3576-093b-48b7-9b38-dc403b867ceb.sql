-- Per-user report generation preferences (Phase B)
CREATE TABLE IF NOT EXISTS public.report_generation_preferences (
  user_id UUID PRIMARY KEY,
  default_scope TEXT NOT NULL DEFAULT 'address' CHECK (default_scope IN ('address','suburb','zipcode','state')),
  default_tier  TEXT NOT NULL DEFAULT 'compass' CHECK (default_tier  IN ('compass','strategic','briefing','snapshot')),
  last_used_scope TEXT CHECK (last_used_scope IN ('address','suburb','zipcode','state')),
  last_used_tier  TEXT CHECK (last_used_tier  IN ('compass','strategic','briefing','snapshot')),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.report_generation_preferences ENABLE ROW LEVEL SECURITY;

-- Strict service_role-only RLS, consistent with project standard (invokeSecureFunction mediates)
CREATE POLICY "service_role full access" ON public.report_generation_preferences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_report_generation_preferences_updated_at
BEFORE UPDATE ON public.report_generation_preferences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

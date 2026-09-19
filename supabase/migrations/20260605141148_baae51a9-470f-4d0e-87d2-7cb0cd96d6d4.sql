
CREATE TABLE IF NOT EXISTS public.report_engine_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text NOT NULL,
  scope text NOT NULL DEFAULT 'global',
  value jsonb NOT NULL,
  description text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (config_key, scope)
);

GRANT ALL ON public.report_engine_config TO service_role;

ALTER TABLE public.report_engine_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON public.report_engine_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_report_engine_config()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_report_engine_config ON public.report_engine_config;
CREATE TRIGGER trg_touch_report_engine_config
  BEFORE UPDATE ON public.report_engine_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_report_engine_config();

CREATE INDEX IF NOT EXISTS idx_report_engine_config_key_scope
  ON public.report_engine_config (config_key, scope);

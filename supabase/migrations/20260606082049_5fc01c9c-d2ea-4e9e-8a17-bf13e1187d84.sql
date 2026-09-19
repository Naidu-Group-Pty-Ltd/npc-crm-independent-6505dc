
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS custom_css TEXT;

CREATE TABLE IF NOT EXISTS public.template_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_components TO authenticated;
GRANT ALL ON public.template_components TO service_role;

ALTER TABLE public.template_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view components"
  ON public.template_components FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert components"
  ON public.template_components FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Creators can update their components"
  ON public.template_components FOR UPDATE
  TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

CREATE POLICY "Creators can delete their components"
  ON public.template_components FOR DELETE
  TO authenticated USING (created_by = auth.uid());

CREATE INDEX IF NOT EXISTS idx_template_components_created_at
  ON public.template_components (created_at DESC);

CREATE OR REPLACE FUNCTION public.tpl_components_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_tpl_components_touch ON public.template_components;
CREATE TRIGGER trg_tpl_components_touch
  BEFORE UPDATE ON public.template_components
  FOR EACH ROW EXECUTE FUNCTION public.tpl_components_touch();

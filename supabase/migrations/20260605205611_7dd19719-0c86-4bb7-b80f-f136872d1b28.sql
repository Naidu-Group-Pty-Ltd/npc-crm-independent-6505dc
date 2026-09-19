
-- 1. brand_kits
CREATE TABLE public.brand_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  logo_primary_url TEXT,
  logo_secondary_url TEXT,
  logo_mark_url TEXT,
  palette JSONB NOT NULL DEFAULT '{}'::jsonb,
  font_pairing JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_footer TEXT,
  default_disclaimer TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_kits TO authenticated;
GRANT ALL ON public.brand_kits TO service_role;

ALTER TABLE public.brand_kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read brand kits"
  ON public.brand_kits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage brand kits"
  ON public.brand_kits FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. design_tokens
CREATE TABLE public.design_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('brand_kit','template','global')),
  brand_kit_id UUID REFERENCES public.brand_kits(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.report_templates(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark','print','custom')),
  colors JSONB NOT NULL DEFAULT '{}'::jsonb,
  fonts JSONB NOT NULL DEFAULT '{}'::jsonb,
  type_scale JSONB NOT NULL DEFAULT '{}'::jsonb,
  spacing_scale JSONB NOT NULL DEFAULT '{}'::jsonb,
  radii JSONB NOT NULL DEFAULT '{}'::jsonb,
  shadows JSONB NOT NULL DEFAULT '{}'::jsonb,
  gradients JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_design_tokens_brand_kit ON public.design_tokens(brand_kit_id);
CREATE INDEX idx_design_tokens_template ON public.design_tokens(template_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.design_tokens TO authenticated;
GRANT ALL ON public.design_tokens TO service_role;

ALTER TABLE public.design_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read design tokens"
  ON public.design_tokens FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage design tokens"
  ON public.design_tokens FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. report_templates extensions
ALTER TABLE public.report_templates
  ADD COLUMN IF NOT EXISTS brand_kit_id UUID REFERENCES public.brand_kits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_theme TEXT NOT NULL DEFAULT 'light' CHECK (active_theme IN ('light','dark','print','custom'));

-- 4. updated_at triggers
CREATE OR REPLACE FUNCTION public.tpl_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_brand_kits_touch BEFORE UPDATE ON public.brand_kits
  FOR EACH ROW EXECUTE FUNCTION public.tpl_touch_updated_at();
CREATE TRIGGER trg_design_tokens_touch BEFORE UPDATE ON public.design_tokens
  FOR EACH ROW EXECUTE FUNCTION public.tpl_touch_updated_at();

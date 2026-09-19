
CREATE TABLE public.gamma_agreement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  gamma_template_id text NOT NULL,
  description text,
  placeholder_mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.gamma_agreement_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read templates"
ON public.gamma_agreement_templates FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can manage templates"
ON public.gamma_agreement_templates FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_gamma_templates_updated_at
  BEFORE UPDATE ON public.gamma_agreement_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.agency_agreements 
ADD COLUMN template_id uuid REFERENCES public.gamma_agreement_templates(id);

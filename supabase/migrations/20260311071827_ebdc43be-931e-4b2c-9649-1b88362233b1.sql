-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Authenticated users can read templates" ON public.gamma_agreement_templates;
DROP POLICY IF EXISTS "Authenticated users can manage templates" ON public.gamma_agreement_templates;

-- Create permissive policies that include anon role (auth is handled at application layer)
CREATE POLICY "Allow read gamma templates" ON public.gamma_agreement_templates
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Allow manage gamma templates" ON public.gamma_agreement_templates
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
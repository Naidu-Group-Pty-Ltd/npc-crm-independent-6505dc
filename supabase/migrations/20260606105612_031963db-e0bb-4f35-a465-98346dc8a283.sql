
CREATE TABLE IF NOT EXISTS public.template_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  status text NOT NULL DEFAULT 'pending',
  fidelity_mode text NOT NULL DEFAULT 'semantic',
  source_filename text,
  source_size_bytes bigint,
  page_count integer,
  created_template_id uuid,
  error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_imports TO authenticated;
GRANT ALL ON public.template_imports TO service_role;

ALTER TABLE public.template_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages template_imports"
  ON public.template_imports
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "users read their imports or admins read all"
  ON public.template_imports
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "users insert their own imports"
  ON public.template_imports
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "users update their own imports"
  ON public.template_imports
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER tg_template_imports_updated_at
  BEFORE UPDATE ON public.template_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

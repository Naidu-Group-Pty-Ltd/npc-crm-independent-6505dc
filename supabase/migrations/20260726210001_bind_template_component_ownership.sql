-- Component ownership drives the UPDATE and DELETE policies, so authenticated
-- callers must not be able to choose (or omit) the owner when inserting rows.
ALTER TABLE public.template_components
  ALTER COLUMN created_by SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "Authenticated can insert components"
  ON public.template_components;

CREATE POLICY "Authenticated can insert components"
  ON public.template_components FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

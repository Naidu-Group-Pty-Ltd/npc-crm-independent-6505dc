-- Scoped report templates must not be exposed through direct PostgREST reads.
-- Agency membership is not modelled authoritatively yet, so agency templates
-- remain service-role-only. Authenticated users can read global templates and
-- user-scoped templates they own; the manage-templates broker separately
-- preserves the superadmin control-plane bypass.
DROP POLICY IF EXISTS "Users can view all report templates"
  ON public.report_templates;

CREATE POLICY "Users can view accessible report templates"
  ON public.report_templates
  FOR SELECT
  TO authenticated
  USING (
    scope = 'global'
    OR (
      scope = 'user'
      AND owner_user_id = auth.uid()
    )
  );

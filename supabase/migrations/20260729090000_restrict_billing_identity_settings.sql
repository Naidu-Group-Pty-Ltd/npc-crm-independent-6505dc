-- global_report_settings.contact_details now feeds the external billing/tax
-- identity. Keep reads available to signed-in staff, but restrict all direct
-- updates to the established administrative roles. service_role continues to
-- bypass RLS for trusted server-side workflows.
DROP POLICY IF EXISTS "global_report_settings_update_authenticated"
  ON public.global_report_settings;

CREATE POLICY "global_report_settings_update_admin"
  ON public.global_report_settings
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
  );

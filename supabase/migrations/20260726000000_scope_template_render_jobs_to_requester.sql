-- Render jobs can contain signed URLs for PDFs built from client and financial
-- data. Keep those artifacts visible only to the authenticated requester.
DROP POLICY IF EXISTS "render_jobs_select_auth" ON public.template_render_jobs;

CREATE POLICY "render_jobs_select_self"
ON public.template_render_jobs FOR SELECT
TO authenticated
USING (requested_by = (SELECT auth.uid()));

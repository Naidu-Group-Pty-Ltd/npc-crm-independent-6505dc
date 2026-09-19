-- Restrict template collaboration data to the owner of the referenced template.
-- Public previews continue to resolve opaque tokens through the template-share
-- service-role function, but authenticated clients can no longer enumerate them.

DROP POLICY IF EXISTS "tpl_comments_select_auth" ON public.template_comments;
DROP POLICY IF EXISTS "tpl_comments_insert_auth" ON public.template_comments;
DROP POLICY IF EXISTS "tpl_comments_update_own_or_resolve" ON public.template_comments;
DROP POLICY IF EXISTS "tpl_comments_delete_own" ON public.template_comments;

CREATE POLICY "tpl_comments_select_template_owner"
  ON public.template_comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.report_templates AS template
      WHERE template.id = template_comments.template_id
        AND template.created_by = auth.uid()
    )
  );

CREATE POLICY "tpl_comments_insert_template_owner"
  ON public.template_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.report_templates AS template
      WHERE template.id = template_comments.template_id
        AND template.created_by = auth.uid()
    )
  );

CREATE POLICY "tpl_comments_update_template_owner"
  ON public.template_comments FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.report_templates AS template
      WHERE template.id = template_comments.template_id
        AND template.created_by = auth.uid()
    )
  )
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.report_templates AS template
      WHERE template.id = template_comments.template_id
        AND template.created_by = auth.uid()
    )
  );

CREATE POLICY "tpl_comments_delete_template_owner"
  ON public.template_comments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.report_templates AS template
      WHERE template.id = template_comments.template_id
        AND template.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tpl_share_select_auth" ON public.template_share_links;
DROP POLICY IF EXISTS "tpl_share_insert_self" ON public.template_share_links;
DROP POLICY IF EXISTS "tpl_share_update_self" ON public.template_share_links;
DROP POLICY IF EXISTS "tpl_share_delete_self" ON public.template_share_links;

CREATE POLICY "tpl_share_select_template_owner"
  ON public.template_share_links FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.report_templates AS template
      WHERE template.id = template_share_links.template_id
        AND template.created_by = auth.uid()
    )
  );

CREATE POLICY "tpl_share_insert_template_owner"
  ON public.template_share_links FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.report_templates AS template
      WHERE template.id = template_share_links.template_id
        AND template.created_by = auth.uid()
    )
  );

CREATE POLICY "tpl_share_update_template_owner"
  ON public.template_share_links FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.report_templates AS template
      WHERE template.id = template_share_links.template_id
        AND template.created_by = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.report_templates AS template
      WHERE template.id = template_share_links.template_id
        AND template.created_by = auth.uid()
    )
  );

CREATE POLICY "tpl_share_delete_template_owner"
  ON public.template_share_links FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.report_templates AS template
      WHERE template.id = template_share_links.template_id
        AND template.created_by = auth.uid()
    )
  );

-- Require the Email Copilot module capability in addition to mailbox row scope.
-- The existing row predicates intentionally allow staff access to shared/admin
-- mailboxes. Without this predicate, however, any authenticated viewer could
-- mutate those rows directly through PostgREST.
CREATE OR REPLACE FUNCTION public.has_email_copilot_permission(required_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'superadmin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.dashboard_modules dm ON dm.id = up.module_id
    WHERE up.user_id = auth.uid()
      AND dm.module_key = 'email_copilot'
      AND dm.is_active = true
      AND (
        (required_permission = 'can_edit' AND up.can_edit)
        OR (required_permission = 'can_delete' AND up.can_delete)
      )
  );
$$;

-- RLS predicates execute as the requesting role, so the authenticated role
-- needs EXECUTE. This helper exposes only the caller's own authorization bit.
REVOKE ALL ON FUNCTION public.has_email_copilot_permission(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_email_copilot_permission(text) TO authenticated, service_role;

DROP POLICY IF EXISTS email_copilot_emails_update_scoped ON public.email_copilot_emails;
CREATE POLICY email_copilot_emails_update_scoped
  ON public.email_copilot_emails FOR UPDATE TO authenticated
  USING (
    public.has_email_copilot_permission('can_edit')
    AND (
      (client_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.id = email_copilot_emails.client_id
          AND (c.created_by)::text = (auth.uid())::text
      ))
      OR created_by = auth.uid()
      OR owner_user_id = auth.uid()
      OR (
        client_id IS NULL
        AND (
          mailbox_source IS DISTINCT FROM 'personal'
          OR (owner_user_id IS NULL AND created_by IS NULL)
        )
      )
    )
  )
  WITH CHECK (
    public.has_email_copilot_permission('can_edit')
    AND (owner_user_id IS NULL OR owner_user_id = auth.uid())
  );

DROP POLICY IF EXISTS email_copilot_emails_delete_scoped ON public.email_copilot_emails;
CREATE POLICY email_copilot_emails_delete_scoped
  ON public.email_copilot_emails FOR DELETE TO authenticated
  USING (
    public.has_email_copilot_permission('can_delete')
    AND (
      (client_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.id = email_copilot_emails.client_id
          AND (c.created_by)::text = (auth.uid())::text
      ))
      OR created_by = auth.uid()
      OR owner_user_id = auth.uid()
      OR (
        client_id IS NULL
        AND (
          mailbox_source IS DISTINCT FROM 'personal'
          OR (owner_user_id IS NULL AND created_by IS NULL)
        )
      )
    )
  );

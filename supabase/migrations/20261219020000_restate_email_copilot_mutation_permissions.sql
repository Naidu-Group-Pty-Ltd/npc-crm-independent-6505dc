-- @effect: select 1 from pg_policy where polrelid = 'public.email_copilot_emails'::regclass and polname = 'email_copilot_emails_update_scoped' and pg_get_expr(polqual, polrelid) like '%has_email_copilot_permission%'
--
-- Restates `20260724140000_security_email_copilot_mutation_permissions`:
-- changing or deleting an Email Copilot row needs the module's `can_edit` or
-- `can_delete` permission as well as row scope.
--
-- On the prime, `email_copilot_emails_update_scoped` and `…_delete_scoped`
-- both call `has_email_copilot_permission(…)`. On all four clones that
-- function does not exist (measured 23 Sep 2026), so the two policies there
-- are the scope-only ones from `20260721000001`. Any authenticated user whose
-- row scope reaches a shared or admin mailbox row can change or delete it,
-- which is the exposure the original file closed on the prime.
--
-- Two different faults left it there:
--
--   * The three mirror clones carry a Mission Control stamp for
--     `20260724140000`. Mission Control never re-sends a stamped file, as
--     `20261219000000` explains.
--   * The CRM clone was sent the version, not the file. Two files share
--     `20260724140000`, and Mission Control keys its corpus by version, so the
--     CRM ran `20260724140000_security_sent_reply_rls_scope` and recorded this
--     file's name. The sibling's policies are on the CRM; this file's are not.
--
-- The function, grants and policies are exactly those of the original.
-- `DROP POLICY IF EXISTS` then `CREATE POLICY` replaces the scope-only
-- policies wherever they stand and re-creates the prime's own. Idempotent.
-- The probe checks the predicate rather than the policy name, because a policy
-- that exists under the old definition is exactly the state being corrected.
--
-- `has_email_copilot_permission` keeps EXECUTE for `authenticated` on
-- purpose: an RLS predicate is evaluated as the querying role, and the helper
-- exposes only the caller's own permission bit.
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

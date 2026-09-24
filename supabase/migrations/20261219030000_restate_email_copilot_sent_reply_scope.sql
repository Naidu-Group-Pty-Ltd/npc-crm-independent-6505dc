-- @effect: select 1 from pg_policy where polrelid = 'public.email_copilot_sent_replies'::regclass and polname = 'email_copilot_sent_replies_select_scoped' and pg_get_expr(polqual, polrelid) like '%original_email_id%'
--
-- Restates `20260724140000_security_sent_reply_rls_scope`: a sent reply is
-- visible only to whoever can see the email it answers.
--
-- The scope-only policies from `20260721000001` treat every non-personal
-- reply as shared, so a reply to a client-owned email is readable, changeable
-- and deletable by any authenticated user. The original file closed that by
-- joining each reply to its source email through `original_email_id`.
--
-- Why this is restated: the original shares version `20260724140000` with
-- `…_security_email_copilot_mutation_permissions`. The ledger's primary key is
-- the version, so only one of the two can ever be recorded, and a recorded
-- version says nothing about the other file. The prime's ledger names the
-- mutation-permissions file, which `apply-migration.yml` applied on 21 Sep
-- 2026; no apply run in the record names this one. The CRM clone did run
-- this file, because Mission Control keyed the version to it. Whether the
-- prime and the three mirror clones carry these policies is not something
-- the ledgers can answer, and it has not been measured.
--
-- So this file is to be measured before it is applied. `migration-drift`
-- runs the probe above against the prime while the file is unrecorded:
-- `effect present` means the prime already runs this policy and applying the
-- file changes nothing there; `NOT APPLIED` means the prime still exposes
-- replies across clients, and applying the file closes that on the prime and,
-- through Mission Control, on every clone.
--
-- The policies are exactly those of the original. Idempotent.
DROP POLICY IF EXISTS email_copilot_sent_replies_select_scoped
  ON public.email_copilot_sent_replies;
DROP POLICY IF EXISTS email_copilot_sent_replies_update_scoped
  ON public.email_copilot_sent_replies;
DROP POLICY IF EXISTS email_copilot_sent_replies_delete_scoped
  ON public.email_copilot_sent_replies;

CREATE POLICY email_copilot_sent_replies_select_scoped
  ON public.email_copilot_sent_replies FOR SELECT TO authenticated
  USING (
    created_by = (auth.uid())::text
    OR owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.email_copilot_emails AS email
      WHERE email.id = email_copilot_sent_replies.original_email_id
        AND (
          (email.client_id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM public.clients AS client
            WHERE client.id = email.client_id
              AND (client.created_by)::text = (auth.uid())::text
          ))
          OR email.created_by = auth.uid()
          OR email.owner_user_id = auth.uid()
          OR (
            email.client_id IS NULL
            AND (
              email.mailbox_source IS DISTINCT FROM 'personal'
              OR (email.owner_user_id IS NULL AND email.created_by IS NULL)
            )
          )
        )
    )
  );

CREATE POLICY email_copilot_sent_replies_update_scoped
  ON public.email_copilot_sent_replies FOR UPDATE TO authenticated
  USING (
    created_by = (auth.uid())::text
    OR owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.email_copilot_emails AS email
      WHERE email.id = email_copilot_sent_replies.original_email_id
        AND (
          (email.client_id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM public.clients AS client
            WHERE client.id = email.client_id
              AND (client.created_by)::text = (auth.uid())::text
          ))
          OR email.created_by = auth.uid()
          OR email.owner_user_id = auth.uid()
          OR (
            email.client_id IS NULL
            AND (
              email.mailbox_source IS DISTINCT FROM 'personal'
              OR (email.owner_user_id IS NULL AND email.created_by IS NULL)
            )
          )
        )
    )
  )
  WITH CHECK (owner_user_id IS NULL OR owner_user_id = auth.uid());

CREATE POLICY email_copilot_sent_replies_delete_scoped
  ON public.email_copilot_sent_replies FOR DELETE TO authenticated
  USING (
    created_by = (auth.uid())::text
    OR owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.email_copilot_emails AS email
      WHERE email.id = email_copilot_sent_replies.original_email_id
        AND (
          (email.client_id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM public.clients AS client
            WHERE client.id = email.client_id
              AND (client.created_by)::text = (auth.uid())::text
          ))
          OR email.created_by = auth.uid()
          OR email.owner_user_id = auth.uid()
          OR (
            email.client_id IS NULL
            AND (
              email.mailbox_source IS DISTINCT FROM 'personal'
              OR (email.owner_user_id IS NULL AND email.created_by IS NULL)
            )
          )
        )
    )
  );

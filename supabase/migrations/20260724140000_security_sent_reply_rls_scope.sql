-- Security remediation: sent replies must inherit access from their source
-- email. The previous policy treated every non-personal reply as shared,
-- exposing replies linked to client-owned emails across tenants.

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

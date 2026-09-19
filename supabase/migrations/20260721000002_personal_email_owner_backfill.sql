-- Applied to production 2026-07-21 via MCP (security_phase1_personal_email_owner_backfill).
-- Attribute legacy personal-mailbox emails to their owner where the mailbox
-- address matches exactly one staff user (MAIL-003 backfill). Ambiguous or
-- unmatched rows stay unattributed (existing shared visibility preserved).
WITH mailbox_owners AS (
  SELECT id, lower(personal_mailbox) AS mb FROM public.custom_users WHERE personal_mailbox IS NOT NULL AND personal_mailbox <> ''
  UNION
  SELECT id, lower(microsoft_email) FROM public.custom_users WHERE microsoft_email IS NOT NULL AND microsoft_email <> ''
),
resolved AS (
  SELECT e.id AS email_id, min(mo.id::text)::uuid AS owner_id
  FROM public.email_copilot_emails e
  JOIN mailbox_owners mo
    ON (e.folder = 'sent' AND lower(e.sender) = mo.mb)
    OR (e.folder <> 'sent' AND EXISTS (SELECT 1 FROM unnest(e.to_recipients) r WHERE lower(r) = mo.mb))
  WHERE e.mailbox_source = 'personal'
    AND e.owner_user_id IS NULL
  GROUP BY e.id
  HAVING count(DISTINCT mo.id) = 1
)
UPDATE public.email_copilot_emails e
   SET owner_user_id = resolved.owner_id
  FROM resolved
 WHERE e.id = resolved.email_id;

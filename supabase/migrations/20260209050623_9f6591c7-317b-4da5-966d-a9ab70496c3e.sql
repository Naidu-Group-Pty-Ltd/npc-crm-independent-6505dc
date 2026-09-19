
-- Backfill: link existing unlinked emails to clients by matching sender email
UPDATE public.email_copilot_emails e
SET client_id = matched.client_id
FROM (
  SELECT DISTINCT ON (e2.id) e2.id as email_id, c.id as client_id
  FROM public.email_copilot_emails e2
  CROSS JOIN LATERAL (
    SELECT id FROM public.clients
    WHERE lower(primary_email) = public.extract_email_address(e2.sender)
       OR lower(secondary_email) = public.extract_email_address(e2.sender)
    LIMIT 1
  ) c
  WHERE e2.client_id IS NULL
    AND e2.sender IS NOT NULL
) matched
WHERE e.id = matched.email_id;

-- Also try to_recipients, cc_recipients, bcc_recipients for remaining unlinked emails
UPDATE public.email_copilot_emails e
SET client_id = matched.client_id
FROM (
  SELECT DISTINCT ON (e2.id) e2.id as email_id, c.id as client_id
  FROM public.email_copilot_emails e2
  CROSS JOIN LATERAL unnest(
    COALESCE(e2.to_recipients, ARRAY[]::text[]) ||
    COALESCE(e2.cc_recipients, ARRAY[]::text[]) ||
    COALESCE(e2.bcc_recipients, ARRAY[]::text[])
  ) addr
  CROSS JOIN LATERAL (
    SELECT id FROM public.clients
    WHERE lower(primary_email) = public.extract_email_address(addr)
       OR lower(secondary_email) = public.extract_email_address(addr)
    LIMIT 1
  ) c
  WHERE e2.client_id IS NULL
) matched
WHERE e.id = matched.email_id;

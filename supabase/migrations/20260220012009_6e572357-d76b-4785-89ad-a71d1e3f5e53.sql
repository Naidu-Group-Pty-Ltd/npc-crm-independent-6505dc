
-- 1. Disable trigger to prevent re-linking during cleanup
ALTER TABLE email_copilot_emails DISABLE TRIGGER trg_auto_link_email_to_client;

-- 2. Unlink ALL emails from staff client records
UPDATE email_copilot_emails SET client_id = NULL
WHERE client_id = '38e3dab8-b6fe-4365-a111-e110017a50d6';

UPDATE email_copilot_emails SET client_id = NULL
WHERE client_id = '81ef1c55-6070-4cf0-9f8b-e3261020130c';

-- 3. Re-run corrected backfill (staff addresses already excluded in function)
-- Pass 1: Direct address matching
UPDATE email_copilot_emails e
SET client_id = matched.client_id
FROM (
  SELECT DISTINCT ON (e2.id) e2.id as email_id, c.id as client_id
  FROM email_copilot_emails e2
  CROSS JOIN LATERAL (
    SELECT lower(public.extract_email_address(addr)) as extracted
    FROM unnest(
      ARRAY[e2.sender] || COALESCE(e2.to_recipients, '{}') || COALESCE(e2.cc_recipients, '{}') || COALESCE(e2.bcc_recipients, '{}')
    ) AS addr
    WHERE addr IS NOT NULL AND addr != ''
  ) addrs
  JOIN clients c ON lower(c.primary_email) = addrs.extracted OR lower(c.secondary_email) = addrs.extracted
  WHERE e2.client_id IS NULL
    AND addrs.extracted NOT IN (SELECT address FROM email_linking_excluded_addresses)
  ORDER BY e2.id
) matched
WHERE e.id = matched.email_id;

-- Pass 2: Conversation thread propagation
UPDATE email_copilot_emails e
SET client_id = conv.linked_client_id
FROM (
  SELECT DISTINCT ON (e2.id) e2.id as email_id, linked.client_id as linked_client_id
  FROM email_copilot_emails e2
  JOIN email_copilot_emails linked 
    ON linked.conversation_id = e2.conversation_id
    AND linked.client_id IS NOT NULL
  WHERE e2.client_id IS NULL
    AND e2.conversation_id IS NOT NULL
    AND e2.conversation_id != ''
  ORDER BY e2.id, linked.received_at DESC
) conv
WHERE e.id = conv.email_id;

-- 4. Re-enable trigger
ALTER TABLE email_copilot_emails ENABLE TRIGGER trg_auto_link_email_to_client;

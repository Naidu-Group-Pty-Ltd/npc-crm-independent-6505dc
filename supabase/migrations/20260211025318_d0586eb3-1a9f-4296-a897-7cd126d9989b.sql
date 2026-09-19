
-- Backfill: propagate client_id to unlinked emails that share a conversation_id with linked emails
UPDATE email_copilot_emails e
SET client_id = linked.client_id
FROM (
  SELECT DISTINCT ON (conversation_id) conversation_id, client_id
  FROM email_copilot_emails
  WHERE client_id IS NOT NULL
    AND conversation_id IS NOT NULL
  ORDER BY conversation_id, received_at DESC
) linked
WHERE e.conversation_id = linked.conversation_id
  AND e.client_id IS NULL
  AND e.conversation_id IS NOT NULL;

-- Restore Report Q&A conversation history visibility.
--
-- Conversations created before ownership stamping (WP-07) have
-- created_by IS NULL, which makes them invisible to the ownership-scoped
-- `get-conversations` listing in the report-qa edge function.
--
-- Backfill: attribute each orphaned conversation to the user who sent its
-- earliest attributable message (report_qa_messages.sent_by). Rows with no
-- attributable message remain NULL and are surfaced to superadmins as
-- "legacy" conversations by the edge function instead.
UPDATE public.report_qa_conversations c
SET created_by = a.sent_by
FROM (
  SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.sent_by
  FROM public.report_qa_messages m
  WHERE m.sent_by IS NOT NULL
  ORDER BY m.conversation_id, m.created_at ASC
) a
WHERE c.id = a.conversation_id
  AND c.created_by IS NULL
  AND EXISTS (SELECT 1 FROM public.custom_users u WHERE u.id = a.sent_by);

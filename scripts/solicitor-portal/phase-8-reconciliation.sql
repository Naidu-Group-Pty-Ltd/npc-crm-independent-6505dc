-- Read-only canonical communications reconciliation report.
SELECT 'canonical_conversations' metric,count(*) value FROM public.conversations
UNION ALL SELECT 'canonical_messages',count(*) FROM public.messages
UNION ALL SELECT 'matched_mirrors',count(*) FROM public.messages WHERE migration_status='matched_mirror'
UNION ALL SELECT 'open_migration_issues',count(*) FROM public.conversation_migration_issues WHERE status='open'
UNION ALL SELECT 'conversations_without_participants',count(*) FROM public.conversations c WHERE NOT EXISTS(SELECT 1 FROM public.conversation_participants p WHERE p.conversation_id=c.id AND p.left_at IS NULL)
UNION ALL SELECT 'messages_without_receipts',count(*) FROM public.messages m WHERE NOT EXISTS(SELECT 1 FROM public.message_receipts r WHERE r.message_id=m.id)
UNION ALL SELECT 'failed_deliveries',count(*) FROM public.notification_deliveries WHERE status IN ('failed','dead_lettered');

SELECT source_table,issue_type,count(*) issue_count,min(detected_at) first_detected,max(detected_at) last_detected
FROM public.conversation_migration_issues WHERE status='open' GROUP BY source_table,issue_type ORDER BY source_table,issue_type;

SELECT d.id,d.channel,d.status,d.attempts,d.available_at,d.last_error,m.conversation_id,m.id message_id
FROM public.notification_deliveries d LEFT JOIN public.messages m ON m.id=d.message_id
WHERE d.status IN ('failed','dead_lettered') ORDER BY d.updated_at DESC;

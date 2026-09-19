-- Keep outbound conversation sends idempotent and retain a safe failure state
-- for the CRM retry action. Provider IDs remain the primary deduplication key.
ALTER TABLE public.ghl_conversation_messages
  ADD COLUMN IF NOT EXISTS client_request_id text,
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE public.ghl_conversations
  ADD COLUMN IF NOT EXISTS available_channels text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE UNIQUE INDEX IF NOT EXISTS idx_ghl_conversation_messages_client_request_id
  ON public.ghl_conversation_messages (client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Historical data can contain provider aliases. Normalise it once so inbox
-- summaries and channel filters agree with message history.
UPDATE public.ghl_conversation_messages
SET channel_type = CASE lower(channel_type)
  WHEN 'type_email' THEN 'email'
  WHEN 'mail' THEN 'email'
  WHEN 'type_whatsapp' THEN 'whatsapp'
  WHEN 'whats_app' THEN 'whatsapp'
  WHEN 'type_sms' THEN 'sms'
  WHEN 'type_sms_reaction' THEN 'sms'
  WHEN 'type_phone' THEN 'sms'
  WHEN 'phone' THEN 'sms'
  ELSE lower(channel_type)
END
WHERE lower(channel_type) IN (
  'type_email', 'mail', 'type_whatsapp', 'whats_app',
  'type_sms', 'type_sms_reaction', 'type_phone', 'phone'
);

UPDATE public.ghl_conversations c
SET available_channels = channels.values
FROM (
  SELECT conversation_id, array_agg(DISTINCT channel_type ORDER BY channel_type) AS values
  FROM public.ghl_conversation_messages
  WHERE channel_type IN ('sms', 'email', 'whatsapp')
  GROUP BY conversation_id
) channels
WHERE c.id = channels.conversation_id;

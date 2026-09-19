
WITH normalized AS (
  SELECT
    m.conversation_id,
    CASE
      WHEN m.channel_type IN ('email','type_email') THEN 'email'
      WHEN m.channel_type IN ('whatsapp','type_whatsapp') THEN 'whatsapp'
      WHEN m.channel_type IN ('facebook','type_facebook') THEN 'facebook'
      WHEN m.channel_type IN ('instagram','type_instagram') THEN 'instagram'
      WHEN m.channel_type IN ('sms','type_sms','type_sms_reaction','phone','type_phone','type_call') THEN 'sms'
      ELSE NULL
    END AS ch,
    m.ghl_date_added
  FROM ghl_conversation_messages m
),
ranked AS (
  SELECT conversation_id, ch,
    ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY ghl_date_added DESC NULLS LAST) rn
  FROM normalized
  WHERE ch IS NOT NULL
)
UPDATE ghl_conversations c
SET channel_type = r.ch
FROM ranked r
WHERE r.conversation_id = c.id AND r.rn = 1 AND r.ch IS DISTINCT FROM c.channel_type;

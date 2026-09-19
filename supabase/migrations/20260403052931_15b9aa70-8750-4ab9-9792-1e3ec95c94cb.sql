UPDATE ghl_conversations SET channel_type = 'sms' WHERE channel_type = 'type_phone';
UPDATE ghl_conversation_messages SET channel_type = 'sms' WHERE channel_type = 'type_phone';
-- Add artifact_messages column to store the full VAPI artifact.messages array
-- This enables tool call tracking and chat-style transcript rendering
ALTER TABLE vapi_call_logs ADD COLUMN artifact_messages JSONB DEFAULT NULL;

-- Add a comment for documentation
COMMENT ON COLUMN vapi_call_logs.artifact_messages IS 'Raw VAPI artifact.messages array containing structured message data including tool calls, timestamps, and role information';
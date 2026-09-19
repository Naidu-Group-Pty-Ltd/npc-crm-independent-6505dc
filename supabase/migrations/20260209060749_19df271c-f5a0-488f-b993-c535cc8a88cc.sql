
-- Add conversation_id column for Outlook thread grouping
ALTER TABLE email_copilot_emails 
ADD COLUMN conversation_id text;

-- Index for fast thread lookups
CREATE INDEX idx_email_copilot_conversation_id ON email_copilot_emails (conversation_id);

-- Backfill: generate synthetic conversation IDs from subject lines for existing emails
-- Strip Re:, Fwd:, FW:, RE: prefixes and group by normalized subject + mailbox
UPDATE email_copilot_emails
SET conversation_id = 'subj_' || md5(
  LOWER(
    regexp_replace(
      regexp_replace(subject, '^(Re:\s*|Fwd?:\s*|FW:\s*|RE:\s*)+', '', 'gi'),
      '\s+', ' ', 'g'
    )
  )
)
WHERE conversation_id IS NULL;

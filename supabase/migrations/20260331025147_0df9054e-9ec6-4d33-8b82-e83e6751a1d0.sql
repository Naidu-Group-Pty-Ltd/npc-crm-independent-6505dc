-- Composite index for the main email list query pattern
CREATE INDEX IF NOT EXISTS idx_email_copilot_mailbox_received 
ON public.email_copilot_emails (mailbox_source, received_at DESC);
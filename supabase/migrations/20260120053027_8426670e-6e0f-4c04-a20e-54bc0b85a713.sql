-- Add folder column to distinguish inbox vs sent emails
ALTER TABLE public.email_copilot_emails
ADD COLUMN folder text DEFAULT 'inbox' NOT NULL;

-- Create index for faster folder-based queries
CREATE INDEX idx_email_copilot_folder ON public.email_copilot_emails(folder);

-- Step 1: Delete all duplicate rows, keeping only the oldest (first inserted) copy of each email
DELETE FROM email_copilot_emails
WHERE id NOT IN (
  SELECT DISTINCT ON (sender, subject, received_at, folder, COALESCE(mailbox_source, 'admin'))
    id
  FROM email_copilot_emails
  ORDER BY sender, subject, received_at, folder, COALESCE(mailbox_source, 'admin'), created_at ASC
);

-- Step 2: Add a unique constraint to prevent future duplicates
CREATE UNIQUE INDEX idx_email_copilot_no_duplicates 
ON email_copilot_emails (sender, subject, received_at, folder, COALESCE(mailbox_source, 'admin'));

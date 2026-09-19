-- Add personal_mailbox column to custom_users table
ALTER TABLE public.custom_users 
ADD COLUMN IF NOT EXISTS personal_mailbox text;

-- Add comment for clarity
COMMENT ON COLUMN public.custom_users.personal_mailbox IS 'Personal email mailbox for the user';
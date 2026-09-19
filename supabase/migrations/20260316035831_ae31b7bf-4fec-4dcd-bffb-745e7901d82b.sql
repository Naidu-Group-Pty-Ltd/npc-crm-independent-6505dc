
-- Add microsoft_email column to custom_users for Outlook calendar integration
ALTER TABLE public.custom_users 
ADD COLUMN IF NOT EXISTS microsoft_email text;

-- Add a comment for documentation
COMMENT ON COLUMN public.custom_users.microsoft_email IS 'Microsoft 365 email address for Outlook calendar integration';

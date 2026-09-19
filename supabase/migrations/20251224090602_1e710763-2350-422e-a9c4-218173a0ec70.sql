-- Add email signature fields to whitelabel_settings table
ALTER TABLE public.whitelabel_settings
ADD COLUMN IF NOT EXISTS email_signature_banner TEXT,
ADD COLUMN IF NOT EXISTS email_signature_name TEXT DEFAULT 'NPC Property Services',
ADD COLUMN IF NOT EXISTS email_signature_title TEXT DEFAULT 'Property Investment Specialist',
ADD COLUMN IF NOT EXISTS email_signature_phone TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS email_signature_email TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS email_signature_website TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS email_signature_address TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS email_signature_disclaimer TEXT DEFAULT 'This email and any attachments are confidential and may be privileged. If you are not the intended recipient, please notify the sender immediately and delete this message.';

COMMENT ON COLUMN public.whitelabel_settings.email_signature_banner IS 'URL to the banner image for email signatures';
COMMENT ON COLUMN public.whitelabel_settings.email_signature_name IS 'Name to display in email signature';
COMMENT ON COLUMN public.whitelabel_settings.email_signature_title IS 'Job title to display in email signature';
COMMENT ON COLUMN public.whitelabel_settings.email_signature_phone IS 'Phone number for email signature';
COMMENT ON COLUMN public.whitelabel_settings.email_signature_email IS 'Email address for email signature';
COMMENT ON COLUMN public.whitelabel_settings.email_signature_website IS 'Website URL for email signature';
COMMENT ON COLUMN public.whitelabel_settings.email_signature_address IS 'Business address for email signature';
COMMENT ON COLUMN public.whitelabel_settings.email_signature_disclaimer IS 'Legal disclaimer text for email signature';
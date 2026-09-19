-- Add email_signature column to custom_users table
ALTER TABLE public.custom_users 
ADD COLUMN IF NOT EXISTS email_signature TEXT;
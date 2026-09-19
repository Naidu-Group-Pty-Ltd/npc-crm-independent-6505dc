-- Update admin user password to properly handle NPC123
-- Since we're using simple password comparison in the edge function, 
-- we'll keep the password as plain text for this demo setup
UPDATE public.custom_users 
SET password_hash = 'NPC123'
WHERE username = 'admin';
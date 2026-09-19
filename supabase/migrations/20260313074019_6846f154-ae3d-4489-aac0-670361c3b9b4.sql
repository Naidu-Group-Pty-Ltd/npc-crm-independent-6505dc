ALTER TABLE public.client_portal_users 
ADD COLUMN IF NOT EXISTS has_accepted_terms boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
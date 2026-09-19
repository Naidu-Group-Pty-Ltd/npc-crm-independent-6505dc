ALTER TABLE public.custom_users
  ADD COLUMN IF NOT EXISTS outlook_auto_prep_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS outlook_prep_minutes integer DEFAULT 15,
  ADD COLUMN IF NOT EXISTS outlook_follow_up_blocking boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS outlook_follow_up_default_duration integer DEFAULT 30;
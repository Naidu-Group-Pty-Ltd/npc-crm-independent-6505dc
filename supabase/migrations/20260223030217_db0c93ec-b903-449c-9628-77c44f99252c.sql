-- Add timezone preference to custom_users
-- Default is Australia/Sydney since all bookings are made in Sydney time
ALTER TABLE public.custom_users 
ADD COLUMN timezone text NOT NULL DEFAULT 'Australia/Sydney';

-- Add a comment for documentation
COMMENT ON COLUMN public.custom_users.timezone IS 'IANA timezone identifier for display purposes. All bookings are made in Australia/Sydney time. This is used to show local time reference alongside Sydney time.';
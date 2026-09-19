ALTER TABLE public.portal_configuration 
ADD COLUMN IF NOT EXISTS booking_calendars jsonb DEFAULT '[]'::jsonb;
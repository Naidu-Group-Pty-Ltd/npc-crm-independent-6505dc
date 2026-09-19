
-- Portal configuration table for managing client portal settings
CREATE TABLE public.portal_configuration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Module toggles
  module_dashboard boolean DEFAULT true,
  module_profile boolean DEFAULT true,
  module_deal_progress boolean DEFAULT true,
  module_properties boolean DEFAULT true,
  module_property_insights boolean DEFAULT true,
  module_employment boolean DEFAULT true,
  module_documents boolean DEFAULT true,
  module_emails boolean DEFAULT true,
  module_messages boolean DEFAULT true,
  module_notifications boolean DEFAULT true,
  module_booking boolean DEFAULT false,
  
  -- Welcome message
  welcome_title text DEFAULT 'Welcome to your Client Portal',
  welcome_message text DEFAULT 'Access your property investment details, track your deals, and stay connected with your advisor.',
  welcome_banner_url text,
  
  -- Access level defaults for new portal users
  default_access_level text DEFAULT 'full_edit',
  
  -- Calendar/Booking configuration
  booking_calendar_id text,
  booking_calendar_name text,
  booking_slot_duration integer DEFAULT 30,
  booking_working_hours_start integer DEFAULT 9,
  booking_working_hours_end integer DEFAULT 17,
  booking_lead_time_hours integer DEFAULT 24,
  booking_max_advance_days integer DEFAULT 30,
  booking_confirmation_email boolean DEFAULT true,
  booking_team_notification_email text,
  booking_intro_text text DEFAULT 'Schedule a consultation with our team. Select a date and available time slot below.',
  
  -- Branding overrides specific to portal (beyond whitelabel)
  portal_accent_color text,
  portal_footer_text text DEFAULT 'Secured Portal • End-to-end encrypted',
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.portal_configuration ENABLE ROW LEVEL SECURITY;

-- Insert default configuration row
INSERT INTO public.portal_configuration (id) VALUES (gen_random_uuid());

-- Create trigger for updated_at
CREATE TRIGGER update_portal_configuration_updated_at
  BEFORE UPDATE ON public.portal_configuration
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

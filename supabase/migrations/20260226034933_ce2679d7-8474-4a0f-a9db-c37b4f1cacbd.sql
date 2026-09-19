
-- Table to track secondary (finance contact) recipients for calendar appointments
CREATE TABLE public.appointment_secondary_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_ghl_id TEXT NOT NULL,
  finance_contact_id UUID NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  notification_sent BOOLEAN NOT NULL DEFAULT false,
  notification_sent_at TIMESTAMPTZ,
  notification_error TEXT,
  appointment_title TEXT,
  appointment_start TIMESTAMPTZ,
  appointment_end TIMESTAMPTZ,
  appointment_type TEXT,
  appointment_notes TEXT,
  calendar_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for lookups by appointment
CREATE INDEX idx_appt_secondary_ghl_id ON public.appointment_secondary_recipients(appointment_ghl_id);

-- Index for lookups by finance contact
CREATE INDEX idx_appt_secondary_contact ON public.appointment_secondary_recipients(finance_contact_id);

-- Updated at trigger
CREATE TRIGGER update_appointment_secondary_recipients_updated_at
  BEFORE UPDATE ON public.appointment_secondary_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS (service-role only pattern)
ALTER TABLE public.appointment_secondary_recipients ENABLE ROW LEVEL SECURITY;

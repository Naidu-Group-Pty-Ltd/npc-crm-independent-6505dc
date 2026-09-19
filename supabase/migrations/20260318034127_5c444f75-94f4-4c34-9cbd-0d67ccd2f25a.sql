
-- Fix 1: The COALESCE in notify_portal_report_request tries to cast 'report' to the enum, causing the error.
-- Fix by casting request_type to text first.
CREATE OR REPLACE FUNCTION public.notify_portal_report_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  request_label text;
BEGIN
  request_label := INITCAP(REPLACE(COALESCE(NEW.request_type::text, 'report'), '_', ' '));
  INSERT INTO public.notifications (type, title, message, entity_id, read)
  VALUES (
    'portal_report_requested',
    'New Report Request',
    'A client has requested a ' || request_label,
    NEW.id::text,
    false
  );
  RETURN NEW;
END;
$$;

-- Fix 2: Expand the CHECK constraint on notifications.type to accept all trigger-inserted types
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
CHECK (type = ANY (ARRAY[
  'report_generated', 'report_failed', 'info', 'call_completed',
  'report_generation_completed', 'report_generation_failed',
  'portal_report_requested', 'agreement_generated',
  'new_ghl_contact', 'new_marketing_lead', 'missed_call',
  'client_reminder_overdue', 'client_reminder_due', 'client_reminder_upcoming',
  'report_request', 'email_received'
]));

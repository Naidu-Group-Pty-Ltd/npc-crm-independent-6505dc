
-- 1. Add 'conversation_reply' to the notifications type constraint
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
CHECK (type = ANY (ARRAY[
  'report_generated', 'report_failed', 'info', 'call_completed',
  'report_generation_completed', 'report_generation_failed',
  'portal_report_requested', 'agreement_generated',
  'new_ghl_contact', 'new_marketing_lead', 'missed_call',
  'client_reminder_overdue', 'client_reminder_due', 'client_reminder_upcoming',
  'report_request', 'email_received', 'conversation_shared',
  'game_plan_created', 'game_plan_updated', 'game_plan_milestone_completed',
  'conversation_reply'
]));

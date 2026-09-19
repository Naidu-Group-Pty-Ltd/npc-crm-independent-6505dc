
-- Add 'conversation_shared' to the notifications type CHECK constraint
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
CHECK (type = ANY (ARRAY[
  'report_generated', 'report_failed', 'info', 'call_completed',
  'report_generation_completed', 'report_generation_failed',
  'portal_report_requested', 'agreement_generated',
  'new_ghl_contact', 'new_marketing_lead', 'missed_call',
  'client_reminder_overdue', 'client_reminder_due', 'client_reminder_upcoming',
  'report_request', 'email_received', 'conversation_shared'
]));

-- Allow sharing the same conversation with multiple users by ensuring
-- the unique constraint is on (conversation_id, shared_with) not just conversation_id
-- Check if a unique constraint already exists
DO $$
BEGIN
  -- Add unique constraint if not already present
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'agent_conversation_shares_conv_user_unique'
  ) THEN
    ALTER TABLE public.agent_conversation_shares 
    ADD CONSTRAINT agent_conversation_shares_conv_user_unique 
    UNIQUE (conversation_id, shared_with);
  END IF;
END $$;

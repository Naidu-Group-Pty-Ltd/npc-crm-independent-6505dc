-- Make client_id nullable to support general/team reminders
ALTER TABLE public.client_reminders 
  ALTER COLUMN client_id DROP NOT NULL;

-- Drop the existing FK constraint on assigned_to (single UUID)
ALTER TABLE public.client_reminders 
  DROP CONSTRAINT IF EXISTS client_reminders_assigned_to_fkey;

-- Change assigned_to from single text to text array for multi-user assignment
ALTER TABLE public.client_reminders 
  ALTER COLUMN assigned_to TYPE text[] 
  USING CASE WHEN assigned_to IS NOT NULL THEN ARRAY[assigned_to] ELSE NULL END;

-- Add a reminder_scope column to distinguish client vs team reminders
ALTER TABLE public.client_reminders 
  ADD COLUMN IF NOT EXISTS reminder_scope text NOT NULL DEFAULT 'client';
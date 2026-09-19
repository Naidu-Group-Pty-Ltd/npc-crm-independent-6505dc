
-- Add assigned_to column to client_reminders
ALTER TABLE public.client_reminders 
ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.custom_users(id);

-- Add target_user_id to notifications so we can filter per-user
ALTER TABLE public.notifications 
ADD COLUMN IF NOT EXISTS target_user_id uuid REFERENCES public.custom_users(id);

-- Create index for efficient per-user notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_target_user_id ON public.notifications(target_user_id);
CREATE INDEX IF NOT EXISTS idx_client_reminders_assigned_to ON public.client_reminders(assigned_to);

-- Create notifications table
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('report_generated', 'report_failed', 'info')),
  title text NOT NULL,
  message text NOT NULL,
  report_id text,
  timestamp timestamp with time zone NOT NULL DEFAULT now(),
  read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Create policies - all authenticated users can view all notifications
CREATE POLICY "All users can view all notifications"
ON public.notifications
FOR SELECT
USING (true);

-- Service role can create notifications
CREATE POLICY "Service role can create notifications"
ON public.notifications
FOR INSERT
WITH CHECK (true);

-- All users can update notifications (to mark as read)
CREATE POLICY "All users can update notifications"
ON public.notifications
FOR UPDATE
USING (true);

-- All users can delete notifications
CREATE POLICY "All users can delete notifications"
ON public.notifications
FOR DELETE
USING (true);

-- Enable realtime
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
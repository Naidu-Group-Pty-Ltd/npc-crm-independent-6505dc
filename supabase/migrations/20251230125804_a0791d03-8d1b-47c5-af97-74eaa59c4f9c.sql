-- Enable REPLICA IDENTITY FULL for proper realtime UPDATE events
ALTER TABLE public.vapi_call_logs REPLICA IDENTITY FULL;
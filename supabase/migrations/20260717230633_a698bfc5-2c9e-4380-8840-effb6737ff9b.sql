UPDATE public.vapi_call_logs
SET call_status = 'ended',
    call_outcome = COALESCE(call_outcome, 'stale'),
    ended_at = COALESCE(ended_at, now())
WHERE call_status IN ('in-progress','ringing','queued')
  AND started_at < now() - interval '2 hours';
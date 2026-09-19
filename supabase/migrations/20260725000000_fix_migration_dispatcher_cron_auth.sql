-- Reschedule the migration dispatcher with the signed internal-request helper.
-- The dispatcher rejects the anon-key/x-internal-call headers used by the
-- previous schedule now that verifyInternal requires an HMAC envelope.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobname
    FROM cron.job
    WHERE jobname LIKE 'migration-dispatcher%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;

  PERFORM cron.schedule(
    'migration-dispatcher-15s',
    '15 seconds',
    $cmd$
      SELECT public.cron_invoke_signed_function(
        'migration-dispatcher',
        jsonb_build_object('tick', to_char(now(), 'SS')),
        'pg_cron'
      );
    $cmd$
  );
END;
$$;

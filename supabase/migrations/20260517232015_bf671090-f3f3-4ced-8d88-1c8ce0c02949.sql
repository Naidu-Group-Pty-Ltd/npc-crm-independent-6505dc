DO $$
DECLARE
  r record;
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk';
  dispatcher_url text := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/migration-dispatcher';
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname LIKE 'migration-dispatcher%' LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;

  PERFORM cron.schedule(
    'migration-dispatcher-15s',
    '15 seconds',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := jsonb_build_object('tick', to_char(now(), 'SS')),
        timeout_milliseconds := 5000
      );
    $cmd$,
      dispatcher_url,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', anon_key,
        'Authorization', 'Bearer ' || anon_key,
        'x-internal-call', 'true'
      )::text
    )
  );
END $$;
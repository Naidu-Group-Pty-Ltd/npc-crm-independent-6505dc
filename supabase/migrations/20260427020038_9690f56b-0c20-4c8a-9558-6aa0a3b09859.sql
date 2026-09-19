DO $$
DECLARE
  r record;
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk';
  dispatcher_url text := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/migration-dispatcher';
  offset_seconds int;
  suffix text;
  command_sql text;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname LIKE 'migration-dispatcher%' LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;

  FOR offset_seconds IN 0..55 BY 5 LOOP
    suffix := lpad(offset_seconds::text, 2, '0');

    IF offset_seconds = 0 THEN
      command_sql := format($cmd$
        SELECT net.http_post(
          url := %L,
          headers := %L::jsonb,
          body := %L::jsonb
        );
      $cmd$,
        dispatcher_url,
        jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', anon_key,
          'Authorization', 'Bearer ' || anon_key,
          'x-internal-call', 'true'
        )::text,
        jsonb_build_object('tick', suffix)::text
      );
    ELSE
      command_sql := format($cmd$
        SELECT pg_sleep(%s);
        SELECT net.http_post(
          url := %L,
          headers := %L::jsonb,
          body := %L::jsonb
        );
      $cmd$,
        offset_seconds,
        dispatcher_url,
        jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', anon_key,
          'Authorization', 'Bearer ' || anon_key,
          'x-internal-call', 'true'
        )::text,
        jsonb_build_object('tick', suffix)::text
      );
    END IF;

    PERFORM cron.schedule(
      'migration-dispatcher-' || suffix || 's',
      '* * * * *',
      command_sql
    );
  END LOOP;
END $$;
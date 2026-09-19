
DO $$
DECLARE jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'ghl-marketing-backfill-once' LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

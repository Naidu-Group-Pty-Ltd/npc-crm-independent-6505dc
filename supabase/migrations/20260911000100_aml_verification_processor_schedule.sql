-- The watchdog that makes "submitted" mean "will be processed".
--
-- ## What this fixes, and it is not cosmetic
--
-- `aml.verification.requested` has been emitted into `public.integration_outbox`
-- by an AFTER trigger since 20260831000100, and `cross-portal-outbox-worker`
-- has had a consumer for it since the same day. Nothing has ever driven that
-- worker: it is invoked by HTTP with `x-worker-secret`, and there is no cron
-- entry for it in this project — checked against production before writing
-- this, where `cron.job` contains 40 schedules and not one of them names it.
--
-- So the durable path existed on paper. A customer submission would have sat
-- `queued` for ever with the event unclaimed. The self-hosted capture provider
-- has never been active in production (0 rows), which is why nobody had met it.
--
-- The Standalone capture journey cannot ship on that. `aml-verification-processor`
-- is invoked directly by `aml-client-portal` the moment a submission is
-- accepted — that is the fast path, and it is what makes the customer's wait a
-- few seconds. THIS is the guarantee behind it: an Edge Function isolate can be
-- reclaimed mid-flight, and a submission whose dispatch died has to be picked up
-- by something that is still running a minute later.
--
-- One minute, because a customer is watching "Checking your identity" and a
-- sweep with nothing to claim is two cheap indexed reads. The function stops
-- taking work at a wall-clock budget, so overlapping ticks cannot pile up, and
-- every attempt is claimed by a conditional UPDATE before a cent is spent — so
-- a tick that overlaps its predecessor finds nothing to take rather than paying
-- twice.
--
-- ROLLBACK:
--   SELECT cron.unschedule('aml-verification-processor-1min');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('aml-verification-processor-1min')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aml-verification-processor-1min');

    PERFORM cron.schedule(
      'aml-verification-processor-1min',
      '* * * * *',
      $job$SELECT public.cron_invoke_signed_function('aml-verification-processor', '{}'::jsonb, 'pg_cron');$job$
    );
  END IF;
END;
$$;

-- The consumer that makes "queued" mean "will actually run".
--
-- ## What this fixes, measured rather than assumed
--
-- `aml.screening.requested` has been emitted into `public.integration_outbox`
-- by a trigger, and `cross-portal-outbox-worker/screeningConsumer.ts` has had
-- a consumer for it, for months. Nothing has ever driven that worker.
--
-- Read from production on 2026-08-16, minutes after a real operator pressed
-- Run screening on AML-2026-00005:
--
--   integration_outbox
--     event_type   aml.screening.requested
--     occurred_at  07:35:19
--     attempts     0          <- never even tried
--     locked_at    null
--     processed_at null
--
--   aml.party_screening_subjects
--     state              queued
--     screening_check_id null
--     error_category     null
--
-- The subject sat `queued` indefinitely and the workspace reported "Screening
-- is running". Nothing was running. `cron.job` held 45 schedules and not one
-- of them named this worker.
--
-- 20260911000100 found exactly this for `aml.verification.requested` and fixed
-- the verification half by scheduling `aml-verification-processor`. The other
-- half — every event the OUTBOX worker consumes, screening included — was left
-- with no driver. This is that half.
--
-- ## Why one minute
--
-- The same reasoning as the verification processor: somebody is watching a
-- case and a sweep with nothing to claim is one cheap indexed read.
-- `claim_integration_outbox` takes work with a conditional UPDATE before
-- anything is spent, so a tick that overlaps its predecessor finds nothing to
-- take rather than doing it twice, and the worker caps each pass at 25 events.
--
-- ## What this does NOT do
--
-- It does not make screening succeed. `local_lists` is in simulator mode with
-- an empty DFAT list, so the consumer will refuse — correctly, because a
-- fabricated "no match" is the most dangerous output this platform has. The
-- difference is that the refusal now REACHES the subject as an error the
-- operator can see and retry, instead of a queue nobody drains.
--
-- ROLLBACK:
--   SELECT cron.unschedule('cross-portal-outbox-worker-1min');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cross-portal-outbox-worker-1min')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cross-portal-outbox-worker-1min');

    -- The worker authenticates on `x-worker-secret` OR the platform's signed
    -- internal envelope. pg_cron cannot produce the former, which is why it
    -- could never be scheduled; `cron_invoke_signed_function` produces the
    -- latter, and the worker now accepts it from the `pg_cron` caller only.
    PERFORM cron.schedule(
      'cross-portal-outbox-worker-1min',
      '* * * * *',
      $job$SELECT public.cron_invoke_signed_function('cross-portal-outbox-worker', '{}'::jsonb, 'pg_cron');$job$
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Drain the visual-analysis backlog, heroes first.
--
-- `op: 'analyse'` looks at photographs that were stored before anything could
-- see them. 4,841 rows existed in that state, and the verdict is what decides
-- whether a floor plan leads a card — 6 of 16 sampled listings led with one.
--
-- Offset from the other three listing jobs (`:23` hourly refresh, `*/15` cache
-- sync, `*/10` enrichment sweep) so four HTTP calls never leave together.
--
-- Every five minutes rather than hourly because there is a one-time backlog to
-- get through. The function's own wall-clock budget caps a run at roughly ten
-- images, so this is ~120/hour: because the queue is ordered by `position`,
-- every listing's HERO is settled inside about four hours and the whole corpus
-- inside two days. Once drained, a run is a single indexed query returning
-- nothing, so the cadence costs nothing to leave in place.
--
-- Raise `LISTING_IMAGE_ANALYSIS_BATCH` / `LISTING_IMAGE_ANALYSIS_BUDGET_MS`, or
-- POST `{"op":"analyse"}` by hand, to drain faster.
-- ---------------------------------------------------------------------------

SELECT cron.unschedule('listing-images-analyse')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'listing-images-analyse');

SELECT cron.schedule(
  'listing-images-analyse',
  '2-59/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/listing-images',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
    ),
    body := '{"op":"analyse"}'::jsonb
  ) AS request_id;
  $$
);

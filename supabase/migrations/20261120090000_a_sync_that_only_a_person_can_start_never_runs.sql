-- =========================================================
-- A sync only a person can start is a sync that stops when they close the tab
-- =========================================================
--
-- Two of the three GoHighLevel imports had no schedule at all. They ran when
-- somebody opened a page, and what they did not finish was not finished by
-- anything.
--
-- ## What that measured, 13-14 Sep 2026
--
-- On the NPC Client Dashboard, against the SAME GHL location the prime reads
-- (`H7NNnJKSofGaRJHTkAd3`, the same three pipelines):
--
--                              prime     clone
--   clients                      776       500   <- exactly 5 x GHL's 100/page
--   conversations              1,448       489
--   messages                  13,912     1,280
--   opportunities                655       367
--   clients with a stage         654         0
--   distinct pipeline_status      17         1   <- the column DEFAULT
--
-- `import-clients-from-ghl` last wrote at 09:02 on 13 Sep and had no caller
-- but the Clients page, whose background sync asked for five pages — 500
-- contacts, from the start of the list, with no cursor, every five minutes.
--
-- `sync-ghl-pipelines` ran at 09:47 and was still upserting opportunities at
-- 09:50:10 — 190 seconds against the 120 it declares — so it never reached the
-- step that writes `clients.pipeline_status`, `current_pipeline_id`,
-- `current_stage_id` and `ghl_opportunity_id`. All 500 client rows were left
-- on their column defaults, every Client Tracker card reading "New Lead".
--
-- Conversations follow contacts, so the 276 missing clients were also the
-- reason 959 conversations were missing: `conversation-sync-cron` sweeps every
-- conversation it knows about every ~30 minutes and had nothing to discover.
-- That job is healthy and is deliberately not touched here.
--
-- ## Why this is a migration
--
-- A cron job is database state; it does not travel with a code cascade. Three
-- projects today and every clone provisioned after them would each need
-- somebody to remember. Through the migration queue it is one edit that
-- reaches all of them, and it is recorded.
--
-- ## Three rules
--
-- **It schedules only where the GHL freeze's own reason is discharged**, the
-- same guard `20261119180000` used: `ghl_account_config.legacy_disabled_at IS
-- NOT NULL`. Starting traffic against an account somebody is mid-migration on
-- is exactly what that freeze existed to prevent.
--
-- **The minutes are offset**, so the two six-hourly jobs and the hourly one do
-- not all wake at :00 against one GHL rate budget.
--
-- **The conversation job's command is ALTERED, never re-scheduled.**
-- `cron.schedule` recreates a job active, which would reinstate it on a
-- deployment that has it deliberately paused; `cron.alter_job` changes the one
-- field named and leaves `active` where it is.

DO $$
DECLARE
  v_thawed boolean;
  jid      bigint;
BEGIN
  IF to_regclass('public.ghl_account_config') IS NULL THEN
    RAISE NOTICE 'ghl_account_config does not exist here; scheduling nothing.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.ghl_account_config WHERE legacy_disabled_at IS NOT NULL
  ) INTO v_thawed;

  IF NOT v_thawed THEN
    RAISE NOTICE 'GHL account migration is not recorded as complete; scheduling nothing.';
    RETURN;
  END IF;

  -- ── The contact import ────────────────────────────────────────────────
  --
  -- Every six hours, with no cursor and no `maxPages`: the function walks the
  -- account from the start under its own wall-clock budget and upserts, so a
  -- full re-walk is both the simplest correct schedule and self-healing. At
  -- ~800 contacts that is eight GHL requests a run, 32 a day.
  --
  -- It deliberately sends an EMPTY body. `clearExisting` is refused on the
  -- signed-internal path inside the function, so no schedule can ever empty
  -- the Clients page, but a job that cannot even spell it is better.
  PERFORM cron.schedule(
    'import-clients-from-ghl-6h',
    '20 */6 * * *',
    $job$ select public.cron_invoke_signed_function('import-clients-from-ghl', '{}'::jsonb, 'pg_cron'); $job$
  );
  RAISE NOTICE 'Scheduled import-clients-from-ghl-6h.';

  -- ── The pipeline and opportunity sync ─────────────────────────────────
  --
  -- Hourly, because this is what the Client Tracker's board and every card
  -- badge are drawn from, and it is the one an operator notices going stale.
  -- A run is ~5 GHL requests; the cost is database round trips, against the
  -- deployment's own database.
  --
  -- The function stops at a wall-clock budget and hands back a cursor. This
  -- job always starts a FRESH run rather than resuming one: a resume needs the
  -- previous pass's cursor, which a static cron body cannot carry, and a fresh
  -- run reaches the same end state because every write is an upsert. Where a
  -- pass does not finish, its own reconciliation steps stand down rather than
  -- delete what it has not yet seen.
  PERFORM cron.schedule(
    'sync-ghl-pipelines-hourly',
    '40 * * * *',
    $job$ select public.cron_invoke_signed_function('sync-ghl-pipelines', '{}'::jsonb, 'pg_cron'); $job$
  );
  RAISE NOTICE 'Scheduled sync-ghl-pipelines-hourly.';

  -- ── The conversation job's misleading body ────────────────────────────
  --
  -- It sent `{"mode":"incremental"}`. `conversation-sync-cron` never parses a
  -- body at all — it runs three bands (fresh head, bootstrap, stale tail) on
  -- every tick regardless — so the argument did nothing and said something
  -- false. It is the reason this job reads, to anyone who looks at it, as an
  -- incremental sync that could never close a historical gap, which is the
  -- opposite of what it does.
  --
  -- Altered rather than re-scheduled, so a deployment that has this paused on
  -- purpose stays paused.
  -- ── The marketing-asset job's inherited identity ──────────────────────
  --
  -- Its last `cron.schedule` in this repository posts to a literal
  -- `https://dduzbchuswwbefdunfct.supabase.co` URL with a literal anon-key
  -- bearer for that same project, and the function compared the bearer against
  -- the SAME literal — so repo-side the pair agreed with itself while being
  -- wrong on every clone in both directions at once.
  --
  -- All four deployments were measured on 14 Sep 2026 already running
  -- `cron_invoke_signed_function` here, so the live job had been rewritten
  -- correctly and the function was the stale half; that is fixed in code. This
  -- makes the REPOSITORY say the same thing, so the next clone provisioned
  -- from it does not inherit the literals again.
  --
  -- Altered rather than re-scheduled, for the same reason as below.
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'sync-ghl-marketing-assets-6h' LOOP
    PERFORM cron.alter_job(
      job_id  := jid,
      command := $job$ select public.cron_invoke_signed_function('sync-ghl-marketing-assets', '{}'::jsonb, 'pg_cron'); $job$
    );
    RAISE NOTICE 'Rewrote sync-ghl-marketing-assets-6h onto the signed invoker.';
  END LOOP;

  FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'sync-ghl-conversations-cron' LOOP
    PERFORM cron.alter_job(
      job_id  := jid,
      command := $job$ select public.cron_invoke_signed_function('conversation-sync-cron', '{}'::jsonb, 'pg_cron'); $job$
    );
    RAISE NOTICE 'Rewrote sync-ghl-conversations-cron to send no vestigial mode argument.';
  END LOOP;
END $$;

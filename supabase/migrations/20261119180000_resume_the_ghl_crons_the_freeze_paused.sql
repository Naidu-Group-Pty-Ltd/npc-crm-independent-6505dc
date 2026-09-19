-- =========================================================
-- The GHL freeze ended on 8 May. The thaw never happened.
-- =========================================================
--
-- `20260425101700` — "Phase 0: Freeze & Snapshot for GHL account migration" —
-- paused two cron jobs on purpose, using `cron.alter_job(active := false)` so
-- the definitions survived:
--
--     sync-ghl-conversations-cron    */10 * * * *
--     sync-ghl-marketing-assets-6h   0 */6 * * *
--
-- The migration those jobs were paused FOR completed. `ghl_account_config`
-- records it: `default_account = 'new'`, `legacy_disabled_at` stamped
-- 2026-05-08. Nobody turned them back on.
--
-- Measured 13 Sep 2026 — four months and five days later — on the prime AND on
-- both clones, which inherited the paused state:
--
--     sync-ghl-conversations-cron    active = false
--     sync-ghl-marketing-assets-6h   active = false
--
-- So CRM Conversations advanced only when somebody opened the page and pressed
-- Sync. On the clone that shows as `ghl_conversations.last_synced_at` sitting
-- ~18 hours stale, 194 conversations against the prime's 804, and 663 messages
-- against 11,602. A separate change makes each run roughly ten times faster;
-- this is what makes runs HAPPEN.
--
-- ## Why this is a migration and not a console command
--
-- A cron's `active` flag is database state, so it does not travel with a code
-- cascade — three projects today and every clone provisioned after them would
-- each need somebody to remember. Through the migration queue it is one edit
-- that reaches all of them, and it is recorded.
--
-- ## Two rules
--
-- **It resumes only where the freeze's own reason is discharged.** The guard is
-- `ghl_account_config.legacy_disabled_at IS NOT NULL` — the same row Phase 0's
-- completion wrote. A deployment still mid-migration, or one that has no config
-- row at all, is left exactly as it is and says so. Resuming a job on a
-- deployment that is still frozen would restart traffic against an account
-- somebody is in the middle of moving.
--
-- **It never creates a job and never changes a schedule.** `cron.alter_job`
-- only flips `active`, against jobs matched BY NAME, so a deployment where
-- these were deliberately unscheduled stays unscheduled rather than having them
-- silently reinstated. This is the exact inverse of the statement that paused
-- them, and nothing more.
--
-- Re-running it is a no-op: setting `active := true` on an active job changes
-- nothing, and the audit rows are keyed so a repeat is recognisable.

DO $$
DECLARE
  v_thawed  boolean;
  jid       bigint;
  v_names   text[] := ARRAY['sync-ghl-conversations-cron', 'sync-ghl-marketing-assets-6h'];
  v_resumed text[] := ARRAY[]::text[];
  v_name    text;
BEGIN
  -- The freeze's reason, read from the row its completion wrote. `to_regclass`
  -- first because a deployment that predates the config table must not error
  -- here — it is simply one that was never frozen.
  IF to_regclass('public.ghl_account_config') IS NULL THEN
    RAISE NOTICE 'ghl_account_config does not exist here; leaving the cron jobs untouched.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.ghl_account_config WHERE legacy_disabled_at IS NOT NULL
  ) INTO v_thawed;

  IF NOT v_thawed THEN
    RAISE NOTICE 'GHL account migration is not recorded as complete; leaving the cron jobs paused.';
    RETURN;
  END IF;

  FOREACH v_name IN ARRAY v_names LOOP
    FOR jid IN SELECT jobid FROM cron.job WHERE jobname = v_name AND active IS NOT TRUE LOOP
      PERFORM cron.alter_job(job_id := jid, active := true);
      v_resumed := v_resumed || v_name;
    END LOOP;
  END LOOP;

  IF array_length(v_resumed, 1) IS NULL THEN
    RAISE NOTICE 'Nothing to resume: the GHL cron jobs are already active (or absent).';
  ELSE
    RAISE NOTICE 'Resumed % GHL cron job(s): %', array_length(v_resumed, 1), array_to_string(v_resumed, ', ');

    -- Same audit table Phase 0 wrote its pause into, so the freeze and the thaw
    -- read as one story rather than two unrelated events.
    IF to_regclass('public.ghl_migration_baseline') IS NOT NULL THEN
      INSERT INTO public.ghl_migration_baseline (snapshot_label, table_name, row_count, notes)
      SELECT
        'phase-0-cron-resumed',
        n,
        0,
        'Resumed: the GHL account migration this was paused for completed on the date in ghl_account_config.legacy_disabled_at'
      FROM unnest(v_resumed) AS n;
    END IF;
  END IF;
END $$;

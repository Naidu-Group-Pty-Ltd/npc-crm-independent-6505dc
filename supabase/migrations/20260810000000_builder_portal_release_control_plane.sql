-- Cross-portal release-control plane — the shared additions that arrived with
-- the Builder / Developer Portal's release plane.
--
-- HISTORY. This file originally installed the Builder release-control plane in
-- full: the builder rollout transition graph, cutover readiness and
-- operational-health evaluators, and the three builder-only mutation commands
-- (set_cross_portal_rollout_for, record/revoke_cross_portal_approval_for —
-- each refused any portal but 'builder' in its own first lines). Phase 7 of
-- the network extraction retired the portal from this platform, and the
-- decommission migration (20261124000000) drops those functions from every
-- database that holds them.
--
-- WHAT REMAINS is the part the SHARED plane took from that work and still
-- reads, kept here so a fresh clone's replay builds the same schema the fleet
-- runs (docs/builder-portal/45-network-extraction-plan.md §7; the plan's
-- collision rule is also why this file keeps its VERSION — it shares
-- 20260810000000 with stamp_duty_schedule_cache, and clone replay skips by
-- version, so renumbering it would change which file a fresh clone takes):
--
--   * the feature-definition honesty markers (legacy_comparison_applicable,
--     runtime_consumed, not_applicable_reason) — the Command Centre renders
--     them for every portal's features;
--   * optimistic concurrency on cross_portal_firm_rollouts (row_version and
--     its bump trigger) — set_cross_portal_firm_rollout's callers rely on the
--     column existing whatever portal owns the row;
--   * approval revocation evidence (revoked_by, revoke_reason) on
--     cross_portal_cutover_approvals.
--
-- Everything here is additive and idempotent; the Solicitor commands are
-- untouched.

-- ===========================================================================
-- 0. Pre-migration reconciliation — the shared plane must already exist
-- (20260801000400 generalised it; this file extends it).
-- ===========================================================================
DO $$
DECLARE v_missing text;
BEGIN
  FOREACH v_missing IN ARRAY ARRAY[
    'cross_portal_feature_definitions','cross_portal_firm_rollouts',
    'cross_portal_rollout_history','cross_portal_cutover_approvals']
  LOOP
    IF to_regclass('public.' || v_missing) IS NULL THEN
      RAISE EXCEPTION 'PRE-MIGRATION FAILURE: required table public.% is absent', v_missing;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cross_portal_firm_rollouts' AND column_name='portal')
  THEN
    RAISE EXCEPTION 'PRE-MIGRATION FAILURE: cross_portal_firm_rollouts.portal is absent — 20260801000400 must be applied first';
  END IF;
END $$;

CREATE TEMP TABLE _builder_release_premigration AS
SELECT
  (SELECT count(*) FROM public.cross_portal_firm_rollouts)                        AS rollouts,
  (SELECT count(*) FROM public.cross_portal_firm_rollouts WHERE portal='solicitor') AS solicitor_rollouts,
  (SELECT count(*) FROM public.cross_portal_rollout_history)                      AS history,
  (SELECT count(*) FROM public.cross_portal_cutover_approvals)                    AS approvals;

-- ===========================================================================
-- 1. Feature-definition metadata
--
-- Two honesty markers, so the Command Centre can distinguish a check that is
-- genuinely not applicable from one that was skipped, and a flag that controls
-- runtime from one that merely documents intent.
-- ===========================================================================
ALTER TABLE public.cross_portal_feature_definitions
  ADD COLUMN IF NOT EXISTS legacy_comparison_applicable boolean NOT NULL DEFAULT true;
ALTER TABLE public.cross_portal_feature_definitions
  ADD COLUMN IF NOT EXISTS runtime_consumed boolean NOT NULL DEFAULT true;
ALTER TABLE public.cross_portal_feature_definitions
  ADD COLUMN IF NOT EXISTS not_applicable_reason text;

COMMENT ON COLUMN public.cross_portal_feature_definitions.legacy_comparison_applicable IS
  'False when the feature has no legacy counterpart, so dual_read/dual_write comparison evidence cannot exist and must be reported not_applicable rather than failing or being fabricated.';
COMMENT ON COLUMN public.cross_portal_feature_definitions.runtime_consumed IS
  'False when no runtime path reads this feature key. A flag nothing reads protects nothing and must never be presented as a control.';

-- ===========================================================================
-- 2. Optimistic concurrency on the mutable rollout record
--
-- cross_portal_firm_rollouts is the one mutable row in the plane; history and
-- approvals are append-only or state-flagged. A concurrent operator advancing
-- and another rolling back must not silently last-write-win.
-- ===========================================================================
ALTER TABLE public.cross_portal_firm_rollouts
  ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_cross_portal_rollout_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.row_version := COALESCE(OLD.row_version, 0) + 1;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bump_cross_portal_rollout_version ON public.cross_portal_firm_rollouts;
CREATE TRIGGER trg_bump_cross_portal_rollout_version
  BEFORE UPDATE ON public.cross_portal_firm_rollouts
  FOR EACH ROW EXECUTE FUNCTION public.bump_cross_portal_rollout_version();

-- ===========================================================================
-- 3. Approval revocation evidence
--
-- The Solicitor plane can set revoked_at but records neither who revoked nor
-- why. Both are required release evidence whatever portal owns the approval.
-- ===========================================================================
ALTER TABLE public.cross_portal_cutover_approvals
  ADD COLUMN IF NOT EXISTS revoked_by uuid;
ALTER TABLE public.cross_portal_cutover_approvals
  ADD COLUMN IF NOT EXISTS revoke_reason text;

-- ===========================================================================
-- 4. Post-migration assertions — the shared plane is intact
-- ===========================================================================
DO $$
DECLARE v_before record;
BEGIN
  SELECT * INTO v_before FROM _builder_release_premigration;

  IF (SELECT count(*) FROM public.cross_portal_firm_rollouts) <> v_before.rollouts THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: rollout row count changed'; END IF;
  IF (SELECT count(*) FROM public.cross_portal_firm_rollouts WHERE portal='solicitor') <> v_before.solicitor_rollouts THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: solicitor rollout rows changed'; END IF;
  IF (SELECT count(*) FROM public.cross_portal_rollout_history) <> v_before.history THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: rollout history changed'; END IF;
  IF (SELECT count(*) FROM public.cross_portal_cutover_approvals) <> v_before.approvals THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: approval rows changed'; END IF;

  -- Where the Solicitor command exists it must still carry its original
  -- signature — this migration must never have redefined or overloaded it.
  -- A test harness that builds only part of the plane legitimately has no
  -- Solicitor command to preserve, so absence is not a failure; a CHANGED
  -- signature always is.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='set_cross_portal_firm_rollout')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='set_cross_portal_firm_rollout'
      AND pg_get_function_identity_arguments(p.oid) = '_firm_id uuid, _feature_key text, _to_mode text, _reason text, _actor_id uuid')
  THEN RAISE EXCEPTION 'POST-MIGRATION FAILURE: Solicitor rollout command signature changed'; END IF;

  RAISE NOTICE 'shared release-control plane columns installed; Solicitor plane unchanged';
END $$;

DROP TABLE IF EXISTS _builder_release_premigration;

-- Generalise the cross-portal rollout and cutover control plane so it serves
-- Builder organisations as well as Solicitor firms.
--
-- Phase 0 recorded this as GEN-10 and migration risk MIG-03: five tables key on
-- solicitor_firms(id), so a Builder rollout could not be feature-flag controlled
-- and would therefore have no rollback path. ADR 020 requires generalisation
-- rather than a separate Builder-only rollout system.
--
-- Approach: discriminated ownership, matching the portal-terms shape decided in
-- ADR 021. Each table gains a `portal` discriminator and a nullable
-- `builder_organisation_id` with a real foreign key; `firm_id` becomes nullable;
-- an exactly-one-owner CHECK and a portal/owner agreement CHECK keep integrity
-- database-enforced. No existing row changes meaning, and no existing column is
-- dropped, so rollback is to stop writing Builder rows.

-- ===========================================================================
-- 1. Pre-migration reconciliation
-- ===========================================================================
DO $$
DECLARE r record; v_bad bigint;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
    'cross_portal_firm_rollouts','cross_portal_rollout_history',
    'cross_portal_dual_read_comparisons','cross_portal_cutover_approvals',
    'cross_portal_reconciliation_runs']) AS t
  LOOP
    -- cross_portal_reconciliation_runs already permits a null firm_id (a global
    -- run); the others must all be owned by a firm today.
    IF r.t <> 'cross_portal_reconciliation_runs' THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE firm_id IS NULL', r.t) INTO v_bad;
      IF v_bad > 0 THEN
        RAISE EXCEPTION 'PRE-MIGRATION FAILURE: %.firm_id has % null rows before generalisation', r.t, v_bad;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'cross-portal rollout pre-migration checks passed';
END $$;

CREATE TEMP TABLE _cross_portal_premigration_counts AS
SELECT
  (SELECT count(*) FROM public.cross_portal_firm_rollouts)            AS rollouts,
  (SELECT count(*) FROM public.cross_portal_rollout_history)          AS history,
  (SELECT count(*) FROM public.cross_portal_dual_read_comparisons)    AS dual_reads,
  (SELECT count(*) FROM public.cross_portal_cutover_approvals)        AS approvals,
  (SELECT count(*) FROM public.cross_portal_reconciliation_runs)      AS runs;

-- ===========================================================================
-- 2. Feature definitions gain a portal marker
-- ===========================================================================
ALTER TABLE public.cross_portal_feature_definitions
  ADD COLUMN IF NOT EXISTS portal text NOT NULL DEFAULT 'solicitor';
ALTER TABLE public.cross_portal_feature_definitions
  DROP CONSTRAINT IF EXISTS cross_portal_feature_definitions_portal_check;
ALTER TABLE public.cross_portal_feature_definitions
  ADD CONSTRAINT cross_portal_feature_definitions_portal_check
  CHECK (portal IN ('shared','solicitor','builder'));

-- The backbone flag is genuinely cross-portal; the rest remain solicitor-owned.
UPDATE public.cross_portal_feature_definitions
SET portal = 'shared' WHERE feature_key = 'transaction_case_backbone';

INSERT INTO public.cross_portal_feature_definitions
  (feature_key, description, default_mode, legacy_removal_target, portal)
VALUES
  ('builder_portal_identity_v1',
   'Builder Portal organisations, users, memberships and sessions',
   'off', 'No legacy Builder identity exists; this flag gates first activation', 'builder'),
  ('builder_portal_admin_v1',
   'Command Centre Builder / Developer Portal administration',
   'off', 'No legacy Builder administration exists', 'builder')
ON CONFLICT (feature_key) DO NOTHING;

-- ===========================================================================
-- 3. Add discriminated ownership to the five rollout tables
-- ===========================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cross_portal_firm_rollouts','cross_portal_rollout_history',
    'cross_portal_dual_read_comparisons','cross_portal_cutover_approvals',
    'cross_portal_reconciliation_runs']
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS portal text NOT NULL DEFAULT ''solicitor''', t);
    -- [Phase 7, network extraction] builder_organisation_id used to carry an
    -- inline FK to builder_organisations; 20261122000000 released those five
    -- constraints live and 20261124000000 drops the table, so a fresh clone
    -- must not recreate them. The column stays as recorded history.
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS builder_organisation_id uuid', t);
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_portal_check');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (portal IN (''solicitor'',''builder''))',
      t, t || '_portal_check');
  END LOOP;
END $$;

-- firm_id becomes optional so a Builder row can own itself instead.
ALTER TABLE public.cross_portal_firm_rollouts        ALTER COLUMN firm_id DROP NOT NULL;
ALTER TABLE public.cross_portal_rollout_history      ALTER COLUMN firm_id DROP NOT NULL;
ALTER TABLE public.cross_portal_dual_read_comparisons ALTER COLUMN firm_id DROP NOT NULL;
ALTER TABLE public.cross_portal_cutover_approvals    ALTER COLUMN firm_id DROP NOT NULL;
-- cross_portal_reconciliation_runs.firm_id is already nullable.

-- Exactly one owner, and the owner must agree with the portal discriminator.
-- cross_portal_reconciliation_runs is the one table that legitimately permits a
-- global run with no owner at all, so it gets the weaker "at most one" form.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cross_portal_firm_rollouts','cross_portal_rollout_history',
    'cross_portal_dual_read_comparisons','cross_portal_cutover_approvals']
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_owner_agree');
    EXECUTE format($f$
      ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        (portal = 'solicitor' AND firm_id IS NOT NULL AND builder_organisation_id IS NULL)
        OR
        (portal = 'builder' AND builder_organisation_id IS NOT NULL AND firm_id IS NULL)
      ) NOT VALID $f$, t, t || '_owner_agree');
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, t || '_owner_agree');
  END LOOP;
END $$;

ALTER TABLE public.cross_portal_reconciliation_runs
  DROP CONSTRAINT IF EXISTS cross_portal_reconciliation_runs_owner_agree;
ALTER TABLE public.cross_portal_reconciliation_runs
  ADD CONSTRAINT cross_portal_reconciliation_runs_owner_agree CHECK (
    num_nonnulls(firm_id, builder_organisation_id) <= 1
    AND (portal <> 'builder' OR firm_id IS NULL)
    AND (portal <> 'solicitor' OR builder_organisation_id IS NULL)
  ) NOT VALID;
ALTER TABLE public.cross_portal_reconciliation_runs
  VALIDATE CONSTRAINT cross_portal_reconciliation_runs_owner_agree;

-- ===========================================================================
-- 4. Replace owner-scoped uniqueness with per-portal partial indexes
--
-- Created before the old constraints are dropped, so there is never a window in
-- which a duplicate rollout or approval is storable.
-- ===========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS cross_portal_firm_rollouts_solicitor_key
  ON public.cross_portal_firm_rollouts(firm_id, feature_key) WHERE firm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cross_portal_firm_rollouts_builder_key
  ON public.cross_portal_firm_rollouts(builder_organisation_id, feature_key)
  WHERE builder_organisation_id IS NOT NULL;
ALTER TABLE public.cross_portal_firm_rollouts
  DROP CONSTRAINT IF EXISTS cross_portal_firm_rollouts_firm_id_feature_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS cross_portal_cutover_approvals_solicitor_key
  ON public.cross_portal_cutover_approvals(firm_id, feature_key, approval_type)
  WHERE firm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cross_portal_cutover_approvals_builder_key
  ON public.cross_portal_cutover_approvals(builder_organisation_id, feature_key, approval_type)
  WHERE builder_organisation_id IS NOT NULL;
ALTER TABLE public.cross_portal_cutover_approvals
  DROP CONSTRAINT IF EXISTS cross_portal_cutover_approval_firm_id_feature_key_approval__key;

CREATE UNIQUE INDEX IF NOT EXISTS cross_portal_dual_read_solicitor_key
  ON public.cross_portal_dual_read_comparisons(feature_key, firm_id, subject_type, subject_id, correlation_id)
  WHERE firm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cross_portal_dual_read_builder_key
  ON public.cross_portal_dual_read_comparisons(feature_key, builder_organisation_id, subject_type, subject_id, correlation_id)
  WHERE builder_organisation_id IS NOT NULL;
ALTER TABLE public.cross_portal_dual_read_comparisons
  DROP CONSTRAINT IF EXISTS cross_portal_dual_read_compar_feature_key_firm_id_subject_t_key;

CREATE INDEX IF NOT EXISTS cross_portal_rollout_history_builder_idx
  ON public.cross_portal_rollout_history(builder_organisation_id, feature_key, changed_at DESC)
  WHERE builder_organisation_id IS NOT NULL;

-- A rollout row must reference a feature belonging to its own portal, or to the
-- shared set. A CHECK cannot reach cross_portal_feature_definitions, so this is
-- a trigger.
CREATE OR REPLACE FUNCTION public.guard_cross_portal_rollout_portal()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_feature_portal text;
BEGIN
  SELECT portal INTO v_feature_portal
  FROM public.cross_portal_feature_definitions WHERE feature_key = NEW.feature_key;

  IF v_feature_portal IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CROSS_PORTAL_FEATURE_NOT_FOUND';
  END IF;

  IF v_feature_portal <> 'shared' AND v_feature_portal IS DISTINCT FROM NEW.portal THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='CROSS_PORTAL_FEATURE_PORTAL_MISMATCH',
      DETAIL=format('rollout portal %s cannot govern feature %s owned by portal %s',
                    NEW.portal, NEW.feature_key, v_feature_portal);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_cross_portal_rollout ON public.cross_portal_firm_rollouts;
CREATE TRIGGER trg_guard_cross_portal_rollout
  BEFORE INSERT OR UPDATE OF feature_key, portal ON public.cross_portal_firm_rollouts
  FOR EACH ROW EXECUTE FUNCTION public.guard_cross_portal_rollout_portal();

-- ===========================================================================
-- 5. Portal-aware resolution, with the existing signature preserved
--
-- resolve_cross_portal_feature_mode(_firm_id, _feature_key) is called from
-- _shared/solicitorPortalAuth.ts. Its behaviour is unchanged; the new overload
-- serves Builder organisations. This is the compatibility adapter the delivery
-- rules require.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.resolve_cross_portal_feature_mode(_firm_id uuid, _feature_key text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT mode FROM public.cross_portal_firm_rollouts
      WHERE firm_id = _firm_id AND feature_key = _feature_key AND portal = 'solicitor'),
    (SELECT default_mode FROM public.cross_portal_feature_definitions WHERE feature_key = _feature_key),
    'off');
$$;

CREATE OR REPLACE FUNCTION public.resolve_cross_portal_feature_mode_for(
  _portal text, _owner_id uuid, _feature_key text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_mode text;
BEGIN
  IF _portal NOT IN ('solicitor','builder') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CROSS_PORTAL_UNKNOWN_PORTAL';
  END IF;

  IF _portal = 'solicitor' THEN
    SELECT mode INTO v_mode FROM public.cross_portal_firm_rollouts
    WHERE firm_id = _owner_id AND feature_key = _feature_key AND portal = 'solicitor';
  ELSE
    SELECT mode INTO v_mode FROM public.cross_portal_firm_rollouts
    WHERE builder_organisation_id = _owner_id AND feature_key = _feature_key AND portal = 'builder';
  END IF;

  IF v_mode IS NOT NULL THEN RETURN v_mode; END IF;

  SELECT default_mode INTO v_mode FROM public.cross_portal_feature_definitions
  WHERE feature_key = _feature_key;

  RETURN COALESCE(v_mode, 'off');
END $$;

COMMENT ON FUNCTION public.resolve_cross_portal_feature_mode_for(text, uuid, text) IS
  'Portal-aware rollout mode resolution. resolve_cross_portal_feature_mode(uuid, text) is retained unchanged as the Solicitor compatibility adapter.';

-- ===========================================================================
-- 6. Reconciliation view
-- ===========================================================================
-- [Phase 7, network extraction] The builder_organisations join left with the
-- portal (a view is validated at creation, so a fresh clone could not build
-- the old definition against a dropped table). A historic builder rollout row
-- reads owner_name NULL and therefore orphaned_owner = true — the view's own
-- vocabulary for an owner it can no longer resolve. Same definition the
-- decommission migration installs on databases that predate this edit.
CREATE OR REPLACE VIEW public.cross_portal_rollout_reconciliation AS
SELECT r.portal,
       COALESCE(r.firm_id, r.builder_organisation_id) AS owner_id,
       CASE WHEN r.firm_id IS NOT NULL THEN 'solicitor_firm' ELSE 'builder_organisation' END AS owner_kind,
       f.name AS owner_name,
       r.feature_key, d.portal AS feature_portal, r.mode, d.default_mode,
       r.changed_at, r.stable_since,
       (d.portal <> 'shared' AND d.portal IS DISTINCT FROM r.portal) AS portal_mismatch,
       (f.name IS NULL) AS orphaned_owner
FROM public.cross_portal_firm_rollouts r
LEFT JOIN public.cross_portal_feature_definitions d ON d.feature_key = r.feature_key
LEFT JOIN public.solicitor_firms f ON f.id = r.firm_id;

COMMENT ON VIEW public.cross_portal_rollout_reconciliation IS
  'Reconciliation surface for the generalised rollout plane. portal_mismatch and orphaned_owner must both be false for every row.';

-- ===========================================================================
-- 7. Post-migration assertions
-- ===========================================================================
DO $$
DECLARE v_before record; v_bad bigint;
BEGIN
  SELECT * INTO v_before FROM _cross_portal_premigration_counts;

  IF (SELECT count(*) FROM public.cross_portal_firm_rollouts) <> v_before.rollouts THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: rollout row count changed'; END IF;
  IF (SELECT count(*) FROM public.cross_portal_rollout_history) <> v_before.history THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: rollout history row count changed'; END IF;
  IF (SELECT count(*) FROM public.cross_portal_dual_read_comparisons) <> v_before.dual_reads THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: dual-read row count changed'; END IF;
  IF (SELECT count(*) FROM public.cross_portal_cutover_approvals) <> v_before.approvals THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: approval row count changed'; END IF;
  IF (SELECT count(*) FROM public.cross_portal_reconciliation_runs) <> v_before.runs THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: reconciliation run count changed'; END IF;

  -- Every preserved row must still be a valid solicitor-owned row.
  SELECT count(*) INTO v_bad FROM public.cross_portal_firm_rollouts
  WHERE portal = 'solicitor' AND firm_id IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: % solicitor rollouts lost their firm', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM public.cross_portal_rollout_reconciliation
  WHERE portal_mismatch OR orphaned_owner;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: % rollout rows fail reconciliation', v_bad; END IF;

  RAISE NOTICE 'cross-portal rollout post-migration: all row counts preserved, reconciliation clean';
END $$;

DROP TABLE IF EXISTS _cross_portal_premigration_counts;

COMMENT ON TABLE public.cross_portal_firm_rollouts IS
  'Per-organisation rollout mode. The table name is historical: since the Builder generalisation it holds both solicitor firm and builder organisation rollouts, discriminated by the portal column.';

-- ============================================================================
-- Builders Network Phase 7, wave 3 — the builder portal leaves this database
-- (plan §7; execution record in docs/builder-portal/45-network-extraction-plan.md).
--
-- One-way. The portal moved to builders.aurixasystems.com.au (Phases 1-6), the
-- marketplace reads the builder_network_stock_* mirror (wave 2), the sixteen
-- portal-session deployments are deleted (wave 1) — this file removes the
-- schema they all stood on: 63 tables, ~160 functions, one builder view, and
-- the builder rows of portal_terms_acceptances. Storage buckets deliberately
-- stay (wave 4, once the network serves the mirror's imagery).
--
-- Every statement is IF EXISTS / guarded; nothing is CASCADE. A fresh clone
-- provisioned after the deletion replays this file against a database that
-- never had the tables, and every step no-ops — except §5, which CREATES
-- builder_stock_selections in its final shape, because the table SURVIVES
-- (the Command Centre's own record of client selections) while the migration
-- that used to create it is deleted with the portal.
--
-- Order is load-bearing:
--   §1 quiet the dynamic settlement ticks (nothing may write mid-deletion)
--   §2 archive — the same snapshots wave 1 took on the prime, re-runnable, so
--      a clone archives at replay time; the prime no-ops (all 68 relations
--      exist and the guard is table-presence, not configuration)
--   §3 the builder rows of portal_terms_acceptances (archived slice first)
--   §4 the three views that name builder relations (drop one; redefine two
--      shape-identically without their builder legs)
--   §5 builder_stock_selections: release six builder FKs by measured name,
--      re-point stock_item_id at the mirror (SET NULL — a network deletion
--      must never destroy a Command Centre record; E1's precedent), and swap
--      the org guard onto the mirror with byte-identical messages
--   §6 break the one FK cycle (items ⇄ images via primary_image_id)
--   §7 drop the 63 tables children-before-parents (measured topological order)
--   §8 drop the functions, AFTER the tables — every dependent measured on
--      2026-09-14 was a trigger or CHECK on a table §7 removed
-- ============================================================================

-- ===========================================================================
-- §1 The dynamic settlement ticks. cron.unschedule(name) RAISES on a missing
-- job, so the guard is the join — measured today the prime has zero, but a
-- clone mid-drain may hold either.
-- ===========================================================================
DO $$
DECLARE j record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN (
    'settle-builder-stock-marketplace-eligibility',
    'settle-builder-stock-source-images') LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- ===========================================================================
-- §2 The archive. Reversibility is the whole point of taking it before the
-- one-way step; the prime took it in wave 1 (66 snapshots, 6,222 rows,
-- verified by count) and this replays the same act wherever it has not
-- happened. No grants to anon or authenticated — the archive is an
-- operator's record, reached by SQL, not a surface.
-- ===========================================================================
CREATE SCHEMA IF NOT EXISTS builder_archive;

CREATE TABLE IF NOT EXISTS builder_archive._manifest (
  table_name text,
  rows bigint,
  archived_at timestamptz
);

DO $archive$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'builder_allocations',
    'builder_buildings',
    'builder_construction_cases',
    'builder_construction_date_history',
    'builder_construction_milestones',
    'builder_construction_photographs',
    'builder_construction_progress_updates',
    'builder_construction_stages',
    'builder_construction_status_history',
    'builder_conversation_participants',
    'builder_conversations',
    'builder_defects',
    'builder_delivery_status_history',
    'builder_design_images',
    'builder_developments',
    'builder_document_grants',
    'builder_document_versions',
    'builder_documents',
    'builder_handovers',
    'builder_inspections',
    'builder_lots',
    'builder_membership_permissions',
    'builder_messages',
    'builder_notifications',
    'builder_onboarding_steps',
    'builder_organisation_memberships',
    'builder_organisation_settings',
    'builder_organisations',
    'builder_permission_keys',
    'builder_portal_activity_log',
    'builder_portal_sessions',
    'builder_portal_users',
    'builder_practical_completions',
    'builder_progress_claims',
    'builder_project_access',
    'builder_project_parties',
    'builder_project_status_history',
    'builder_projects',
    'builder_reservation_status_history',
    'builder_reservations',
    'builder_role_default_permissions',
    'builder_stages',
    'builder_stock_item_images',
    'builder_stock_items',
    'builder_stock_link_recovery_requests',
    'builder_stock_selections',
    'builder_stock_settlement_lease',
    'builder_stock_settlement_target',
    'builder_stock_uploads',
    'builder_task_assignments',
    'builder_tasks',
    'builder_transaction_parties',
    'builder_transaction_pipeline_stages',
    'builder_transaction_status_history',
    'builder_transactions',
    'builder_unit_holds',
    'builder_unit_pricing',
    'builder_unit_status_history',
    'builder_units',
    'builder_user_preferences',
    'builder_variation_approvals',
    'builder_variations',
    'builder_warranties',
    'builder_warranty_claims'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND to_regclass('builder_archive.' || t) IS NULL THEN
      EXECUTE format('CREATE TABLE builder_archive.%I AS TABLE public.%I', t, t);
      EXECUTE format('SELECT count(*) FROM builder_archive.%I', t) INTO n;
      INSERT INTO builder_archive._manifest (table_name, rows, archived_at)
      VALUES (t, n, now());
    END IF;
  END LOOP;

  -- The builder slice of the shared terms table, before §3 deletes it.
  IF to_regclass('public.portal_terms_acceptances') IS NOT NULL
     AND to_regclass('builder_archive.portal_terms_acceptances_builder_rows') IS NULL THEN
    CREATE TABLE builder_archive.portal_terms_acceptances_builder_rows AS
      SELECT * FROM public.portal_terms_acceptances WHERE portal = 'builder';
    SELECT count(*) INTO n FROM builder_archive.portal_terms_acceptances_builder_rows;
    INSERT INTO builder_archive._manifest (table_name, rows, archived_at)
    VALUES ('portal_terms_acceptances_builder_rows', n, now());
  END IF;

  -- What the buckets held when the schema left, so wave 4's byte deletion has
  -- a record to check against. The objects themselves stay until wave 4.
  -- storage.objects is the PLATFORM'S relation, guarded like every source:
  -- an environment without the storage schema (a partial harness, a
  -- self-hosted variant) skips the listing rather than halting the replay.
  IF to_regclass('storage.objects') IS NOT NULL
     AND to_regclass('builder_archive.stock_storage_objects') IS NULL THEN
    CREATE TABLE builder_archive.stock_storage_objects AS
      SELECT id, bucket_id, name, metadata, created_at, updated_at
      FROM storage.objects
      WHERE bucket_id IN ('builder-stock-lists', 'builder-stock-images');
    SELECT count(*) INTO n FROM builder_archive.stock_storage_objects;
    INSERT INTO builder_archive._manifest (table_name, rows, archived_at)
    VALUES ('stock_storage_objects', n, now());
  END IF;
END $archive$;

REVOKE ALL ON ALL TABLES IN SCHEMA builder_archive FROM anon, authenticated;
REVOKE USAGE ON SCHEMA builder_archive FROM anon, authenticated;

-- ===========================================================================
-- §3 The builder rows of portal_terms_acceptances (3 on the prime, archived
-- above). The columns stay — the single-owner and portal/owner CHECKs are
-- written over the three-way shape and deleting rows satisfies both;
-- 'builder' remains an accepted value nothing writes any more.
-- ===========================================================================
DO $$
BEGIN
  IF to_regclass('public.portal_terms_acceptances') IS NOT NULL THEN
    DELETE FROM public.portal_terms_acceptances WHERE portal = 'builder';
  END IF;
END $$;

-- ===========================================================================
-- §4 Views. One is the portal's own and goes; two SURVIVE and are redefined
-- shape-identically (same columns, same order, same types) without their
-- builder joins — left standing they would block §7, since a view on a table
-- blocks DROP TABLE and nothing here may CASCADE.
-- ===========================================================================
DROP VIEW IF EXISTS public.builder_document_scan_health;

-- The partner agreement register keeps its shape; a builder acceptance row no
-- longer exists (§3), so the builder legs resolved to NULL on every row this
-- can ever return. Solicitor and finance legs are untouched. Guarded on its
-- bases like every source — a view is validated at creation.
DO $vw$
BEGIN
  IF to_regclass('public.portal_terms_acceptances') IS NULL
     OR to_regclass('public.portal_terms_versions') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $v$
CREATE OR REPLACE VIEW public.partner_agreement_records
  WITH (security_invoker = true) AS
 SELECT a.id AS acceptance_id,
    a.portal,
    a.accepted_at,
    a.acknowledgements,
    a.agreement_storage_path,
    a.agreement_generated_at,
    a.agreement_pdf_bytes,
    v.id AS terms_version_id,
    v.version,
    v.title,
    v.document_hash,
    COALESCE(s.id, f.id) AS portal_user_id,
    COALESCE(s.name, fc.name) AS accepted_by_name,
    COALESCE(s.email, f.email) AS accepted_by_email,
    COALESCE(sf.name, fc.company) AS organisation_name,
    sf.trading_name AS organisation_trading_name
   FROM public.portal_terms_acceptances a
     JOIN public.portal_terms_versions v ON v.id = a.terms_version_id
     LEFT JOIN public.solicitor_portal_users s ON s.id = a.solicitor_user_id
     LEFT JOIN public.solicitor_firms sf ON sf.id = s.firm_id
     LEFT JOIN public.finance_portal_users f ON f.id = a.finance_user_id
     LEFT JOIN public.finance_agent_contacts fc ON fc.id = f.finance_contact_id
  $v$;
END $vw$;

-- The rollout reconciliation keeps its shape; a historic builder rollout row
-- reads owner_name NULL and therefore orphaned_owner = true, which is this
-- view's own vocabulary for an owner it can no longer resolve.
DO $vw$
BEGIN
  IF to_regclass('public.cross_portal_firm_rollouts') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $v$
CREATE OR REPLACE VIEW public.cross_portal_rollout_reconciliation
  WITH (security_invoker = true) AS
 SELECT r.portal,
    COALESCE(r.firm_id, r.builder_organisation_id) AS owner_id,
        CASE
            WHEN r.firm_id IS NOT NULL THEN 'solicitor_firm'::text
            ELSE 'builder_organisation'::text
        END AS owner_kind,
    f.name AS owner_name,
    r.feature_key,
    d.portal AS feature_portal,
    r.mode,
    d.default_mode,
    r.changed_at,
    r.stable_since,
    ((d.portal <> 'shared'::text) AND (d.portal IS DISTINCT FROM r.portal)) AS portal_mismatch,
    (f.name IS NULL) AS orphaned_owner
   FROM public.cross_portal_firm_rollouts r
     LEFT JOIN public.cross_portal_feature_definitions d ON d.feature_key = r.feature_key
     LEFT JOIN public.solicitor_firms f ON f.id = r.firm_id
  $v$;
END $vw$;

-- ===========================================================================
-- §5 builder_stock_selections — the survivor. The Command Centre's record of
-- which property was put in front of which client; it was never leaving.
--
-- Created here IF NOT EXISTS in its FINAL shape, because the migration that
-- used to create it is the portal's and is deleted: an existing database
-- no-ops the CREATE and is re-shaped by the ALTERs; a fresh clone gets the
-- final shape directly and the ALTERs no-op instead.
-- ===========================================================================
DO $sel$
BEGIN
  -- The survivor's own referents, present on every real database; a partial
  -- environment without them skips the create rather than halting the replay
  -- (the ALTERs below are IF EXISTS-safe either way).
  IF to_regclass('public.clients') IS NULL
     OR to_regclass('public.builder_network_stock_items') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $c$CREATE TABLE IF NOT EXISTS public.builder_stock_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id uuid
    REFERENCES public.builder_network_stock_items(id) ON DELETE SET NULL,
  organisation_id uuid NOT NULL,
  source_upload_id uuid,
  originating_builder_user_id uuid,
  builder_project_id uuid,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  selected_by_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'selected'
    CHECK (status IN ('selected', 'builder_acknowledged', 'progressed', 'completed', 'withdrawn')),
  selected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by_builder_user_id uuid,
  withdrawn_at timestamptz,
  internal_notes text,
  builder_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)$c$;
  EXECUTE $c$CREATE INDEX IF NOT EXISTS builder_stock_selections_item_idx
  ON public.builder_stock_selections (stock_item_id)$c$;
  EXECUTE $c$CREATE INDEX IF NOT EXISTS builder_stock_selections_client_idx
  ON public.builder_stock_selections (client_id)$c$;
  EXECUTE $c$CREATE INDEX IF NOT EXISTS builder_stock_selections_org_idx
  ON public.builder_stock_selections (organisation_id, status)$c$;
  EXECUTE $c$CREATE INDEX IF NOT EXISTS builder_stock_selections_actor_idx
  ON public.builder_stock_selections (selected_by_user_id)$c$;
  EXECUTE $c$CREATE UNIQUE INDEX IF NOT EXISTS builder_stock_selections_live_key
  ON public.builder_stock_selections (stock_item_id, client_id)
  WHERE status <> 'withdrawn'$c$;
  EXECUTE $c$ALTER TABLE public.builder_stock_selections ENABLE ROW LEVEL SECURITY$c$;
  EXECUTE $c$DROP POLICY IF EXISTS builder_stock_selections_service ON public.builder_stock_selections$c$;
  EXECUTE $c$CREATE POLICY builder_stock_selections_service ON public.builder_stock_selections
  AS PERMISSIVE FOR ALL TO service_role
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role')$c$;
  EXECUTE $c$REVOKE ALL ON public.builder_stock_selections FROM anon, authenticated$c$;
  EXECUTE $c$GRANT ALL ON public.builder_stock_selections TO service_role$c$;
END $sel$;

-- The six builder FKs, released by their measured names. Two are CASCADE and
-- would otherwise block §7; the rest reference tables §7 removes. The columns
-- all stay — dead uuids are the recorded history, the same treatment
-- portal_terms_acceptances.builder_user_id and
-- cross_portal_firm_rollouts.builder_organisation_id already have.
ALTER TABLE IF EXISTS public.builder_stock_selections
  DROP CONSTRAINT IF EXISTS builder_stock_selections_acknowledged_by_builder_user_id_fkey;
ALTER TABLE IF EXISTS public.builder_stock_selections
  DROP CONSTRAINT IF EXISTS builder_stock_selections_builder_project_id_fkey;
ALTER TABLE IF EXISTS public.builder_stock_selections
  DROP CONSTRAINT IF EXISTS builder_stock_selections_organisation_id_fkey;
ALTER TABLE IF EXISTS public.builder_stock_selections
  DROP CONSTRAINT IF EXISTS builder_stock_selections_originating_builder_user_id_fkey;
ALTER TABLE IF EXISTS public.builder_stock_selections
  DROP CONSTRAINT IF EXISTS builder_stock_selections_source_upload_id_fkey;
ALTER TABLE IF EXISTS public.builder_stock_selections
  DROP CONSTRAINT IF EXISTS builder_stock_selections_stock_item_id_fkey;

-- The re-point: the mirror's deletions are the network sync's acts, and a
-- foreign system's delete must never destroy this record — so SET NULL, and
-- the column drops its NOT NULL to make that reachable.
ALTER TABLE IF EXISTS public.builder_stock_selections
  ALTER COLUMN stock_item_id DROP NOT NULL;
DO $$
BEGIN
  IF to_regclass('public.builder_network_stock_items') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'builder_stock_selections_stock_item_id_fkey'
          OR (conrelid = 'public.builder_stock_selections'::regclass
              AND contype = 'f'
              AND pg_get_constraintdef(oid) LIKE '%builder_network_stock_items%')) THEN
    ALTER TABLE public.builder_stock_selections
      ADD CONSTRAINT builder_stock_selections_stock_item_id_fkey
      FOREIGN KEY (stock_item_id)
      REFERENCES public.builder_network_stock_items(id) ON DELETE SET NULL;
  END IF;
END $$;

-- The org guard, swapped onto the mirror. Messages byte-identical to the
-- portal-era function; only the table it asks changed, which is what made
-- wave 2's cutover a table-name swap. organisation_id keeps NO foreign key —
-- the mirror's org rows are the sync's to manage — and this trigger is what
-- holds the pair honest at write time instead.
CREATE OR REPLACE FUNCTION public.builder_enforce_stock_selection_org()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
DECLARE v_org uuid;
BEGIN
  SELECT organisation_id INTO v_org
  FROM public.builder_network_stock_items WHERE id = NEW.stock_item_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STOCK_ITEM_NOT_FOUND',
      DETAIL='a selection must reference an existing stock item';
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_STOCK_SELECTION_ORG_MISMATCH',
      DETAIL='a selection must name the organisation that supplied the stock item';
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.builder_stock_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

DO $trg$
BEGIN
  IF to_regclass('public.builder_stock_selections') IS NULL THEN RETURN; END IF;
  EXECUTE $t$DROP TRIGGER IF EXISTS trg_builder_stock_selection_org ON public.builder_stock_selections$t$;
  EXECUTE $t$CREATE TRIGGER trg_builder_stock_selection_org
  BEFORE INSERT OR UPDATE OF stock_item_id, organisation_id
  ON public.builder_stock_selections
  FOR EACH ROW EXECUTE FUNCTION public.builder_enforce_stock_selection_org()$t$;
  EXECUTE $t$DROP TRIGGER IF EXISTS trg_builder_stock_selections_touch ON public.builder_stock_selections$t$;
  EXECUTE $t$CREATE TRIGGER trg_builder_stock_selections_touch
  BEFORE UPDATE ON public.builder_stock_selections
  FOR EACH ROW EXECUTE FUNCTION public.builder_stock_touch_updated_at()$t$;
END $trg$;

-- ===========================================================================
-- §6 The one cycle: builder_stock_items.primary_image_id → images → items.
-- No topological order exists until one edge goes; measured name, note _fk.
-- ===========================================================================
ALTER TABLE IF EXISTS public.builder_stock_items
  DROP CONSTRAINT IF EXISTS builder_stock_items_primary_image_fk;

-- ===========================================================================
-- §6.5 The functions whose SIGNATURE carries a doomed table's ROW TYPE.
--
-- WHY THIS EXISTS, AND WHY IT IS ABOVE §7. `CREATE FUNCTION … RETURNS
-- builder_allocations` takes a hard pg_depend edge on that table's composite
-- type, so the table cannot be dropped while the function exists — the
-- function's own drop in §8 comes too late. The first run of this migration
-- failed here, on exactly that:
--
--   ERROR 2BP01: cannot drop table builder_allocations because other objects
--   depend on it
--   DETAIL: function builder_create_allocation(…) depends on type
--           builder_allocations
--
-- The census that built §7 and §8 read pg_depend for triggers, CHECKs and
-- foreign keys — the dependents a table HOLDS — and never asked what holds
-- the table. Forty-six functions do, measured on the live prime: every
-- `_upsert_*` / `_create_*` RPC that returns the row it wrote, plus
-- `claim_builder_stock_image_work` and `complete_builder_document_processing`,
-- which do not even carry the prefix. A body-text scan cannot see this class
-- at all; only pg_depend can.
--
-- DERIVED, NOT LISTED. Restating forty-six identities here would be a second
-- copy of §8 to drift from, and a clone whose function set differs by one
-- would fail exactly as production just did. So the set is computed from the
-- catalogue: every function whose argument or return type is the row type of
-- a builder table this migration drops. The doomed set needs no second list
-- either — it is the builder-prefixed tables MINUS the named survivors, which
-- is exact and was verified by count on the live prime (73 builder tables =
-- 63 dropped + 8 builder_network_* + builder_stock_selections +
-- builder_invoices).
--
-- It can only ever drop a function that names a table being dropped in this
-- same statement batch — such a function cannot survive §7 in any case — and
-- the survivor predicate is what keeps `builder_network_claim_outbox`
-- (SETOF builder_network_outbox) and the mirror's own guards out of it.
-- ===========================================================================
DO $sig$
DECLARE
  v_fn    text;
  v_count integer := 0;
BEGIN
  FOR v_fn IN
    SELECT DISTINCT p.oid::regprocedure::text
    FROM pg_depend d
    JOIN pg_proc  p ON p.oid = d.objid    AND d.classid    = 'pg_proc'::regclass
    JOIN pg_type  t ON t.oid = d.refobjid AND d.refclassid = 'pg_type'::regclass
    JOIN pg_class c ON c.oid = t.typrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE 'builder\_%'
      -- The survivors, named positively so a new builder table added later
      -- is treated as doomed (the conservative side: this migration is the
      -- portal's end, and anything it drops here it drops in §7 anyway).
      AND c.relname NOT LIKE 'builder\_network\_%'
      AND c.relname NOT IN ('builder_stock_selections', 'builder_invoices')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', v_fn);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'released % function(s) holding a doomed table row type', v_count;
END $sig$;

-- ===========================================================================
-- §7 The 63 tables, children before parents (measured topological order over
-- the live FK graph; the first five hold no builder-to-builder FK at all).
-- builder_invoices and build_progress_payments are finance tables that merely
-- wear the prefix and are NOT here; builder_network_* is the sync plane and
-- lives on; builder_stock_selections survives above.
-- ===========================================================================
DROP TABLE IF EXISTS public.builder_design_images;
DROP TABLE IF EXISTS public.builder_portal_activity_log;
DROP TABLE IF EXISTS public.builder_stock_settlement_lease;
DROP TABLE IF EXISTS public.builder_stock_settlement_target;
DROP TABLE IF EXISTS public.builder_transaction_pipeline_stages;
DROP TABLE IF EXISTS public.builder_allocations;
DROP TABLE IF EXISTS public.builder_construction_date_history;
DROP TABLE IF EXISTS public.builder_construction_photographs;
DROP TABLE IF EXISTS public.builder_construction_status_history;
DROP TABLE IF EXISTS public.builder_conversation_participants;
DROP TABLE IF EXISTS public.builder_defects;
DROP TABLE IF EXISTS public.builder_delivery_status_history;
DROP TABLE IF EXISTS public.builder_document_grants;
DROP TABLE IF EXISTS public.builder_document_versions;
DROP TABLE IF EXISTS public.builder_handovers;
DROP TABLE IF EXISTS public.builder_membership_permissions;
DROP TABLE IF EXISTS public.builder_messages;
DROP TABLE IF EXISTS public.builder_notifications;
DROP TABLE IF EXISTS public.builder_onboarding_steps;
DROP TABLE IF EXISTS public.builder_organisation_settings;
DROP TABLE IF EXISTS public.builder_practical_completions;
DROP TABLE IF EXISTS public.builder_progress_claims;
DROP TABLE IF EXISTS public.builder_project_access;
DROP TABLE IF EXISTS public.builder_project_parties;
DROP TABLE IF EXISTS public.builder_project_status_history;
DROP TABLE IF EXISTS public.builder_reservation_status_history;
DROP TABLE IF EXISTS public.builder_role_default_permissions;
DROP TABLE IF EXISTS public.builder_stock_item_images;
DROP TABLE IF EXISTS public.builder_stock_link_recovery_requests;
DROP TABLE IF EXISTS public.builder_task_assignments;
DROP TABLE IF EXISTS public.builder_transaction_parties;
DROP TABLE IF EXISTS public.builder_transaction_status_history;
DROP TABLE IF EXISTS public.builder_unit_holds;
DROP TABLE IF EXISTS public.builder_unit_pricing;
DROP TABLE IF EXISTS public.builder_unit_status_history;
DROP TABLE IF EXISTS public.builder_user_preferences;
DROP TABLE IF EXISTS public.builder_variation_approvals;
DROP TABLE IF EXISTS public.builder_warranty_claims;
DROP TABLE IF EXISTS public.builder_construction_milestones;
DROP TABLE IF EXISTS public.builder_construction_progress_updates;
DROP TABLE IF EXISTS public.builder_conversations;
DROP TABLE IF EXISTS public.builder_documents;
DROP TABLE IF EXISTS public.builder_inspections;
DROP TABLE IF EXISTS public.builder_organisation_memberships;
DROP TABLE IF EXISTS public.builder_permission_keys;
DROP TABLE IF EXISTS public.builder_portal_sessions;
DROP TABLE IF EXISTS public.builder_reservations;
DROP TABLE IF EXISTS public.builder_stock_items;
DROP TABLE IF EXISTS public.builder_tasks;
DROP TABLE IF EXISTS public.builder_variations;
DROP TABLE IF EXISTS public.builder_warranties;
DROP TABLE IF EXISTS public.builder_construction_stages;
DROP TABLE IF EXISTS public.builder_stock_uploads;
DROP TABLE IF EXISTS public.builder_construction_cases;
DROP TABLE IF EXISTS public.builder_portal_users;
DROP TABLE IF EXISTS public.builder_transactions;
DROP TABLE IF EXISTS public.builder_units;
DROP TABLE IF EXISTS public.builder_buildings;
DROP TABLE IF EXISTS public.builder_lots;
DROP TABLE IF EXISTS public.builder_stages;
DROP TABLE IF EXISTS public.builder_projects;
DROP TABLE IF EXISTS public.builder_developments;
DROP TABLE IF EXISTS public.builder_organisations;

-- ===========================================================================
-- §8 The functions, after the tables that carried their triggers and CHECKs.
-- Survivors deliberately absent from this list:
--   builder_enforce_stock_selection_org, builder_stock_touch_updated_at (§5),
--   guard_transaction_case_links (E1's mirror guard),
--   resolve_cross_portal_feature_mode_for (serves solicitor; reads only
--   surviving tables), and every builder_network_* function.
-- record/revoke_cross_portal_approval_for and set_cross_portal_rollout_for
-- ARE here: each refuses any portal but 'builder' in its own first lines.
-- ===========================================================================
DROP FUNCTION IF EXISTS public.builder_accept_current_terms(_builder_user_id uuid, _session_id uuid, _ip_hash text, _user_agent_hash text, _acknowledgements jsonb);
DROP FUNCTION IF EXISTS public.builder_accessible_construction_cases(_user_id uuid, _organisation_id uuid, _permission_key text);
DROP FUNCTION IF EXISTS public.builder_accessible_conversations(_user_id uuid, _scope_type text, _scope_id uuid);
DROP FUNCTION IF EXISTS public.builder_accessible_documents(_user_id uuid, _scope_type text, _scope_id uuid);
DROP FUNCTION IF EXISTS public.builder_accessible_organisations(_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_accessible_projects(_user_id uuid, _organisation_id uuid, _permission_key text);
DROP FUNCTION IF EXISTS public.builder_accessible_tasks(_user_id uuid, _scope_type text, _scope_id uuid);
DROP FUNCTION IF EXISTS public.builder_accessible_transactions(_user_id uuid, _organisation_id uuid, _permission_key text);
DROP FUNCTION IF EXISTS public.builder_accessible_units(_user_id uuid, _organisation_id uuid, _permission_key text);
DROP FUNCTION IF EXISTS public.builder_active_membership(_user_id uuid, _org_id uuid);
DROP FUNCTION IF EXISTS public.builder_activity_entity_is_portal_visible(_entity_type text);
DROP FUNCTION IF EXISTS public.builder_activity_log_is_append_only();
DROP FUNCTION IF EXISTS public.builder_add_construction_photograph(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _construction_case_id uuid, _payload jsonb, _reason text);
DROP FUNCTION IF EXISTS public.builder_add_document_version(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _document_id uuid, _payload jsonb, _reason text);
DROP FUNCTION IF EXISTS public.builder_add_progress_update(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _construction_case_id uuid, _construction_stage_id uuid, _payload jsonb, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_delete_membership(_actor_user_id uuid, _actor_type text, _membership_id uuid, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_delete_organisation(_actor_user_id uuid, _actor_type text, _organisation_id uuid, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_delete_user(_actor_user_id uuid, _actor_type text, _builder_user_id uuid, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_revoke_membership(_actor_user_id uuid, _actor_type text, _membership_id uuid, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_revoke_project_access(_actor_user_id uuid, _actor_type text, _access_id uuid, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_revoke_user_sessions(_actor_user_id uuid, _actor_type text, _builder_user_id uuid, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_set_membership_permissions(_actor_user_id uuid, _actor_type text, _membership_id uuid, _overrides jsonb, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_set_organisation_status(_actor_user_id uuid, _actor_type text, _organisation_id uuid, _status text, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_set_user_status(_actor_user_id uuid, _actor_type text, _builder_user_id uuid, _status text, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_upsert_development(_actor_user_id uuid, _actor_type text, _development_id uuid, _developer_organisation_id uuid, _payload jsonb, _status text, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_upsert_membership(_actor_user_id uuid, _actor_type text, _builder_user_id uuid, _organisation_id uuid, _membership_role text, _is_primary boolean, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_admin_upsert_project_access(_actor_user_id uuid, _actor_type text, _builder_user_id uuid, _project_id uuid, _organisation_side text, _access_role text, _permissions jsonb, _valid_until timestamp with time zone, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_can_see_activity(_user_id uuid, _entity_type text, _entity_id uuid);
DROP FUNCTION IF EXISTS public.builder_can_see_conversation(_user_id uuid, _conversation_id uuid, _level text);
DROP FUNCTION IF EXISTS public.builder_can_see_document(_user_id uuid, _document_id uuid, _level text);
DROP FUNCTION IF EXISTS public.builder_complete_onboarding(_builder_user_id uuid, _session_id uuid, _step_key text);
DROP FUNCTION IF EXISTS public.builder_complete_onboarding_tour(_builder_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_construction_history_append_only();
DROP FUNCTION IF EXISTS public.builder_create_allocation(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _unit_id uuid, _allocated_to_organisation_id uuid, _allocation_type text, _expires_at timestamp with time zone, _reference text, _reason text);
DROP FUNCTION IF EXISTS public.builder_create_conversation(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _scope_type text, _scope_id uuid, _payload jsonb, _participant_ids uuid[], _reason text);
DROP FUNCTION IF EXISTS public.builder_create_reservation(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _unit_id uuid, _organisation_id uuid, _payload jsonb, _reason text);
DROP FUNCTION IF EXISTS public.builder_create_unit_hold(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _unit_id uuid, _organisation_id uuid, _expires_at timestamp with time zone, _hold_reference text, _reason text);
DROP FUNCTION IF EXISTS public.builder_delete_construction_photograph(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _construction_case_id uuid, _photograph_id uuid, _reason text);
DROP FUNCTION IF EXISTS public.builder_delete_project_party(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _project_id uuid, _party_id uuid, _reason text);
DROP FUNCTION IF EXISTS public.builder_delete_transaction_party(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _transaction_id uuid, _party_id uuid, _reason text);
DROP FUNCTION IF EXISTS public.builder_delivery_history_append_only();
DROP FUNCTION IF EXISTS public.builder_delivery_org(_construction_case_id uuid);
DROP FUNCTION IF EXISTS public.builder_document_version_is_downloadable(_version_id uuid);
DROP FUNCTION IF EXISTS public.builder_document_versions_immutable();
DROP FUNCTION IF EXISTS public.builder_enforce_collaboration_scope();
DROP FUNCTION IF EXISTS public.builder_enforce_construction_parentage();
DROP FUNCTION IF EXISTS public.builder_enforce_defect_parentage();
DROP FUNCTION IF EXISTS public.builder_enforce_delivery_parentage();
DROP FUNCTION IF EXISTS public.builder_enforce_milestone_parentage();
DROP FUNCTION IF EXISTS public.builder_enforce_photograph_parentage();
DROP FUNCTION IF EXISTS public.builder_enforce_project_access_org();
DROP FUNCTION IF EXISTS public.builder_enforce_project_development_org();
DROP FUNCTION IF EXISTS public.builder_enforce_stage_parentage();
DROP FUNCTION IF EXISTS public.builder_enforce_stock_image_org();
DROP FUNCTION IF EXISTS public.builder_enforce_stock_primary_image();
DROP FUNCTION IF EXISTS public.builder_enforce_transaction_parentage();
DROP FUNCTION IF EXISTS public.builder_enforce_unit_parentage();
DROP FUNCTION IF EXISTS public.builder_ensure_onboarding_steps(_builder_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_guard_membership();
DROP FUNCTION IF EXISTS public.builder_guard_permission_grant();
DROP FUNCTION IF EXISTS public.builder_guard_permission_scope();
DROP FUNCTION IF EXISTS public.builder_guard_session_organisation();
DROP FUNCTION IF EXISTS public.builder_inventory_history_append_only();
DROP FUNCTION IF EXISTS public.builder_is_construction_transition_allowed(_from text, _to text);
DROP FUNCTION IF EXISTS public.builder_is_delivery_transition_allowed(_kind text, _from text, _to text);
DROP FUNCTION IF EXISTS public.builder_is_milestone_transition_allowed(_from text, _to text);
DROP FUNCTION IF EXISTS public.builder_is_project_transition_allowed(_from text, _to text);
DROP FUNCTION IF EXISTS public.builder_is_reservation_transition_allowed(_from text, _to text);
DROP FUNCTION IF EXISTS public.builder_is_transaction_transition_allowed(_from text, _to text);
DROP FUNCTION IF EXISTS public.builder_is_unit_availability_transition_allowed(_from text, _to text);
DROP FUNCTION IF EXISTS public.builder_issue_session(_user_id uuid, _token_hash text, _absolute_expires_at timestamp with time zone, _idle_expires_at timestamp with time zone, _ip_hash text, _user_agent_hash text, _device_label text);
DROP FUNCTION IF EXISTS public.builder_link_transaction_to_case(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _transaction_id uuid, _case_id uuid, _reason text);
DROP FUNCTION IF EXISTS public.builder_log_activity(_actor_user_id uuid, _actor_type text, _action text, _entity_type text, _entity_id uuid, _organisation_id uuid, _builder_user_id uuid, _previous_state jsonb, _new_state jsonb, _reason text, _metadata jsonb, _ip_address text, _user_agent text);
DROP FUNCTION IF EXISTS public.builder_mark_conversation_read(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _conversation_id uuid);
DROP FUNCTION IF EXISTS public.builder_mark_notifications_read(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _notification_ids uuid[]);
DROP FUNCTION IF EXISTS public.builder_messages_immutable();
DROP FUNCTION IF EXISTS public.builder_post_message(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _conversation_id uuid, _body text, _display_name text, _reason text);
DROP FUNCTION IF EXISTS public.builder_prevent_project_access_org_drift();
DROP FUNCTION IF EXISTS public.builder_project_status_history_append_only();
DROP FUNCTION IF EXISTS public.builder_register_uploaded_document_version(_document_version_id uuid, _actor_builder_user_id uuid, _actor_type text);
DROP FUNCTION IF EXISTS public.builder_release_allocation(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _allocation_id uuid, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_release_unit_hold(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _hold_id uuid, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_resolve_construction_permission(_user_id uuid, _construction_case_id uuid, _permission_key text, _level text);
DROP FUNCTION IF EXISTS public.builder_resolve_permission(_user_id uuid, _org_id uuid, _permission_key text, _level text);
DROP FUNCTION IF EXISTS public.builder_resolve_project_permission(_user_id uuid, _project_id uuid, _permission_key text, _level text);
DROP FUNCTION IF EXISTS public.builder_resolve_scope_permission(_user_id uuid, _scope_type text, _scope_id uuid, _permission_key text, _level text);
DROP FUNCTION IF EXISTS public.builder_resolve_session(_token_hash text, _idle_minutes integer);
DROP FUNCTION IF EXISTS public.builder_resolve_transaction_permission(_user_id uuid, _transaction_id uuid, _permission_key text, _level text);
DROP FUNCTION IF EXISTS public.builder_resolve_unit_permission(_user_id uuid, _unit_id uuid, _permission_key text, _level text);
DROP FUNCTION IF EXISTS public.builder_revoke_session(_session_id uuid, _reason text);
DROP FUNCTION IF EXISTS public.builder_revoke_sessions_on_membership_loss();
DROP FUNCTION IF EXISTS public.builder_revoke_sessions_on_user_deactivation();
DROP FUNCTION IF EXISTS public.builder_revoke_user_sessions(_user_id uuid, _reason text, _except_session_id uuid);
DROP FUNCTION IF EXISTS public.builder_rollout_transition_allowed(_from text, _to text);
DROP FUNCTION IF EXISTS public.builder_scope_exists(_scope_type text, _scope_id uuid);
DROP FUNCTION IF EXISTS public.builder_scope_org(_scope_type text, _scope_id uuid);
DROP FUNCTION IF EXISTS public.builder_select_session_organisation(_session_id uuid, _builder_user_id uuid, _organisation_id uuid);
DROP FUNCTION IF EXISTS public.builder_set_construction_date(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _construction_case_id uuid, _date_kind text, _new_date date, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_set_document_grant(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _document_id uuid, _builder_user_id uuid, _can_download boolean, _revoke boolean, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_set_task_assignment(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _task_id uuid, _builder_user_id uuid, _unassign boolean, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_set_transaction_client(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _transaction_id uuid, _client_id uuid, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_set_unit_price(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _unit_id uuid, _list_price numeric, _price_basis text, _reason text);
DROP FUNCTION IF EXISTS public.builder_stock_image_work_pending();
DROP FUNCTION IF EXISTS public.builder_stock_items_rearm_settlement();
DROP FUNCTION IF EXISTS public.builder_stock_publication_readiness(p_upload_id uuid);
DROP FUNCTION IF EXISTS public.builder_stock_publications_pending();
DROP FUNCTION IF EXISTS public.builder_stock_upload_superseded(p_upload_id uuid);
DROP FUNCTION IF EXISTS public.builder_stock_uploads_rearm_settlement();
DROP FUNCTION IF EXISTS public.builder_touch_row();
DROP FUNCTION IF EXISTS public.builder_transaction_history_append_only();
DROP FUNCTION IF EXISTS public.builder_transition_construction_case(_construction_case_id uuid, _expected_version bigint, _from text, _to text, _reason text, _actor_type text, _actor_builder_user_id uuid, _actor_staff_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_transition_delivery(_kind text, _entity_id uuid, _expected_version bigint, _from text, _to text, _reason text, _actor_type text, _actor_builder_user_id uuid, _actor_staff_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_transition_milestone(_milestone_id uuid, _expected_version bigint, _from text, _to text, _reason text, _actor_type text, _actor_builder_user_id uuid, _actor_staff_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_transition_project(_project_id uuid, _expected_version bigint, _from text, _to text, _reason text, _actor_type text, _actor_builder_user_id uuid, _actor_staff_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_transition_reservation(_reservation_id uuid, _expected_version bigint, _from text, _to text, _reason text, _actor_type text, _actor_builder_user_id uuid, _actor_staff_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_transition_transaction(_transaction_id uuid, _expected_version bigint, _from text, _to text, _reason text, _actor_type text, _actor_builder_user_id uuid, _actor_staff_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_transition_unit_availability(_unit_id uuid, _expected_version bigint, _from text, _to text, _reason text, _actor_type text, _actor_builder_user_id uuid, _actor_staff_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_transition_unit_release(_unit_id uuid, _expected_version bigint, _from text, _to text, _reason text, _actor_type text, _actor_builder_user_id uuid, _actor_staff_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_tri_state_permissions_valid(value jsonb);
DROP FUNCTION IF EXISTS public.builder_unlink_transaction_from_case(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _transaction_id uuid, _reason text);
DROP FUNCTION IF EXISTS public.builder_unread_counts(_user_id uuid);
DROP FUNCTION IF EXISTS public.builder_upsert_building(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _building_id uuid, _project_id uuid, _stage_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_construction_case(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _construction_case_id uuid, _transaction_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_construction_stage(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _stage_id uuid, _construction_case_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_defect(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _defect_id uuid, _construction_case_id uuid, _inspection_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_delivery_record(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _kind text, _construction_case_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_document(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _document_id uuid, _scope_type text, _scope_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_inspection(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _inspection_id uuid, _construction_case_id uuid, _construction_stage_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_lot(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _lot_id uuid, _project_id uuid, _stage_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_milestone(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _milestone_id uuid, _construction_case_id uuid, _construction_stage_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_organisation_settings(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _organisation_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_progress_claim(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _claim_id uuid, _construction_case_id uuid, _milestone_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_project(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _project_id uuid, _payload jsonb, _developer_organisation_id uuid, _builder_organisation_id uuid, _development_id uuid, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_project_party(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _project_id uuid, _party_id uuid, _payload jsonb, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_stage(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _stage_id uuid, _project_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_task(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _task_id uuid, _scope_type text, _scope_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_transaction(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _transaction_id uuid, _project_id uuid, _unit_id uuid, _organisation_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_transaction_party(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _transaction_id uuid, _party_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_unit(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _unit_id uuid, _project_id uuid, _stage_id uuid, _building_id uuid, _lot_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_user_preferences(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_variation(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _variation_id uuid, _construction_case_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_variation_approval(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _approval_id uuid, _variation_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_upsert_warranty_claim(_actor_user_id uuid, _actor_type text, _actor_builder_user_id uuid, _claim_id uuid, _construction_case_id uuid, _warranty_id uuid, _payload jsonb, _expected_version bigint, _reason text);
DROP FUNCTION IF EXISTS public.builder_visible_activity(_user_id uuid, _organisation_id uuid, _entity_type text, _entity_id uuid, _limit integer);
DROP FUNCTION IF EXISTS public.builder_workspace_summary(_user_id uuid, _organisation_id uuid);
DROP FUNCTION IF EXISTS public.claim_builder_document_processing_jobs(_worker_id text, _limit integer);
DROP FUNCTION IF EXISTS public.claim_builder_stock_image_work(p_limit integer, p_lease_seconds integer, p_organisation_id uuid);
DROP FUNCTION IF EXISTS public.claim_builder_stock_settlement_lease(p_seconds integer, p_holder text);
DROP FUNCTION IF EXISTS public.complete_builder_document_processing(_job_id uuid, _worker_id text, _sha256 text, _detected_mime text, _byte_size bigint, _scan_status text, _scan_provider text, _scan_reference text, _scan_details jsonb, _error text);
DROP FUNCTION IF EXISTS public.complete_builder_stock_image_work(p_item_id uuid, p_next_stage text, p_result text, p_error text, p_retry_after_seconds integer, p_reset_attempts boolean);
DROP FUNCTION IF EXISTS public.consume_builder_portal_reset_attempt(p_email text, p_token_hash text, p_max integer);
DROP FUNCTION IF EXISTS public.ensure_builder_stock_settlement_scheduled();
DROP FUNCTION IF EXISTS public.get_builder_cutover_readiness(_organisation_id uuid, _feature_key text);
DROP FUNCTION IF EXISTS public.get_builder_operational_health(_organisation_id uuid);
DROP FUNCTION IF EXISTS public.guard_builder_document_version_immutable();
DROP FUNCTION IF EXISTS public.publish_builder_stock_upload(p_upload_id uuid);
DROP FUNCTION IF EXISTS public.publish_ready_builder_stock_uploads();
DROP FUNCTION IF EXISTS public.record_cross_portal_approval_for(_portal text, _owner_id uuid, _feature_key text, _approval_type text, _evidence_reference text, _actor_id uuid, _actor_type text);
DROP FUNCTION IF EXISTS public.release_builder_stock_settlement_lease();
DROP FUNCTION IF EXISTS public.reopen_builder_stock_runtime_failures();
DROP FUNCTION IF EXISTS public.reopen_builder_stock_stranded_items();
DROP FUNCTION IF EXISTS public.revoke_cross_portal_approval_for(_portal text, _owner_id uuid, _feature_key text, _approval_type text, _reason text, _actor_id uuid, _actor_type text);
DROP FUNCTION IF EXISTS public.set_builder_stock_eligibility_target(p_version integer);
DROP FUNCTION IF EXISTS public.set_builder_stock_sanitization_target(p_version integer);
DROP FUNCTION IF EXISTS public.set_builder_stock_source_images_target(p_version integer);
DROP FUNCTION IF EXISTS public.set_cross_portal_rollout_for(_portal text, _owner_id uuid, _feature_key text, _to_mode text, _reason text, _actor_id uuid, _actor_type text, _expected_version bigint);
DROP FUNCTION IF EXISTS public.settle_builder_stock_marketplace_eligibility_tick();
DROP FUNCTION IF EXISTS public.settle_builder_stock_source_images_tick();

-- ============================================================================
-- Builders Network Phase 5 — release the nine inbound FKs (prime → builder)
-- and re-point the transaction-case slot at the network mirror
-- (docs/builder-portal/45-network-extraction-plan.md §7 Phase 5 and §3 E1;
--  the measured edge list is docs/builder-portal/44-network-extraction-boundary.md)
--
-- The builder tables leave this database in Phase 7. Every prime-side table
-- that references one must stop doing so first, or Phase 7's drops either
-- fail on the constraint or CASCADE into non-builder rows — five
-- cross_portal_* tables the Solicitor cutover also lives in, and
-- portal_terms_acceptances, which holds EVERY portal's consent records.
--
-- The COLUMNS stay. After this migration each is an opaque remote reference
-- to an entity whose home is now the network: the Phase 4 move preserved
-- organisation ids, so aml.partner_organisations' two builder links and the
-- three builder consent records keep naming the same entities. No row is
-- touched; only the nine constraints go, each by its measured name, never
-- by CASCADE.
--
-- ONE of the nine is not merely released but RE-POINTED, in the plan's own
-- E1 design and the ship-together discipline of 20260805000000 ("the column,
-- the CHECKs, the guard and the trigger ship together"): the fourth
-- transaction-case slot stays a live feature of the clone, so
-- `transaction_case_links.builder_transaction_id` gains a new FK onto
-- `builder_network_transactions` — a mirror table created HERE, whose PK IS
-- the network's transaction id (which is what makes the cutover a pure FK
-- re-point) — and `guard_transaction_case_links`' fourth branch changes one
-- identifier and gains a NOT FOUND → BUILDER_TRANSACTION_NOT_MIRRORED
-- message. CROSS_CLIENT_CASE_LINK stays byte-identical; the trigger and its
-- column list are untouched. Without this half, the first network-side
-- transaction linked after cutover would be refused by a guard reading a
-- table whose data stopped moving, and after Phase 7 the guard would error
-- on a missing relation — the trigger lives on a STAYING table, so its
-- builder_transactions read cannot survive the decommission.
--
-- Interim consequence, deliberate: until the connection is live and the
-- mirror is hydrated, linking a builder transaction to a case refuses
-- loudly as BUILDER_TRANSACTION_NOT_MIRRORED (0 links exist today, and the
-- clone portal's write path retires in Phase 6). A loud, named refusal in
-- the gap beats a guard asserting client identity against yesterday's copy.
--
-- Measured on the live prime at authoring (2026-09-14): nine inbound FKs
-- exactly, matching the boundary doc with zero drift; referencing rows
-- E4 = 2 / E5 = 3, every other edge 0; orphans 0 on every edge;
-- transaction_case_links carries 0 builder links, so the re-point gate holds
-- trivially.
--
-- DEFERRED, BY NAME (Phase 6/7, with the stock mirror): builder_stock_selections
-- (1 row) stays in the clone per plan §3 E3 but still carries seven FKs into
-- builder tables, stock_item_id → builder_stock_items among them. Its re-point
-- needs `builder_network_stock_items`, which does not exist yet — Phase 7's
-- drop list must exclude the selections table and release those FKs first.
--
-- Replay safety: a fresh clone provisioned AFTER Phase 7 never creates the
-- builder tables, so every check and drop below is guarded by to_regclass —
-- a missing builder table means there is nothing to orphan-check and no
-- constraint to drop, and the file is a clean no-op. The re-point and the
-- guard replacement are likewise conditioned on the slot column existing,
-- because on a corpus Phase 7 has pruned the column never appears. The
-- mirror table itself is unconditional — it is staying infrastructure, like
-- its four transport siblings from 20261121000000. Re-application on a
-- database that already ran it is a no-op throughout (IF NOT EXISTS /
-- IF EXISTS / OR REPLACE / existence-checked ADD CONSTRAINT).
--
-- Reversal: re-adding the released constraints is valid only until Phase 7
-- removes the builder tables. That window is a hard gate — after it, the
-- columns are remote references permanently.
-- ============================================================================

DO $phase5$
DECLARE
  v_bad bigint;
BEGIN
  -- ---------------------------------------------------------------------
  -- Orphan gate: a constraint may be released only while it provably holds.
  -- A dangling reference hidden by the release would surface later as a
  -- silent wrong answer, so any orphan stops the phase here, loudly.
  -- Each gate runs only where both ends of the edge exist.
  -- ---------------------------------------------------------------------

  IF to_regclass('aml.partner_organisations') IS NOT NULL
     AND to_regclass('public.builder_organisations') IS NOT NULL THEN
    SELECT count(*) INTO v_bad FROM aml.partner_organisations p
      WHERE p.builder_organisation_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b
                        WHERE b.id = p.builder_organisation_id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'phase5 orphan gate: aml.partner_organisations carries % dangling builder_organisation_id row(s)', v_bad;
    END IF;
  END IF;

  IF to_regclass('public.portal_terms_acceptances') IS NOT NULL
     AND to_regclass('public.builder_portal_users') IS NOT NULL THEN
    SELECT count(*) INTO v_bad FROM public.portal_terms_acceptances t
      WHERE t.builder_user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.builder_portal_users u
                        WHERE u.id = t.builder_user_id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'phase5 orphan gate: portal_terms_acceptances carries % dangling builder_user_id row(s)', v_bad;
    END IF;
  END IF;

  IF to_regclass('public.transaction_case_links') IS NOT NULL
     AND to_regclass('public.builder_transactions') IS NOT NULL THEN
    SELECT count(*) INTO v_bad FROM public.transaction_case_links l
      WHERE l.builder_transaction_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.builder_transactions bt
                        WHERE bt.id = l.builder_transaction_id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'phase5 orphan gate: transaction_case_links carries % dangling builder_transaction_id row(s)', v_bad;
    END IF;
  END IF;

  IF to_regclass('public.document_processing_jobs') IS NOT NULL
     AND to_regclass('public.builder_document_versions') IS NOT NULL THEN
    SELECT count(*) INTO v_bad FROM public.document_processing_jobs j
      WHERE j.builder_document_version_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.builder_document_versions v
                        WHERE v.id = j.builder_document_version_id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'phase5 orphan gate: document_processing_jobs carries % dangling builder_document_version_id row(s)', v_bad;
    END IF;
  END IF;

  IF to_regclass('public.builder_organisations') IS NOT NULL THEN
    SELECT
      (SELECT count(*) FROM public.cross_portal_firm_rollouts r
        WHERE r.builder_organisation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b WHERE b.id = r.builder_organisation_id))
    + (SELECT count(*) FROM public.cross_portal_rollout_history h
        WHERE h.builder_organisation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b WHERE b.id = h.builder_organisation_id))
    + (SELECT count(*) FROM public.cross_portal_cutover_approvals a
        WHERE a.builder_organisation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b WHERE b.id = a.builder_organisation_id))
    + (SELECT count(*) FROM public.cross_portal_dual_read_comparisons d
        WHERE d.builder_organisation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b WHERE b.id = d.builder_organisation_id))
    + (SELECT count(*) FROM public.cross_portal_reconciliation_runs n
        WHERE n.builder_organisation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.builder_organisations b WHERE b.id = n.builder_organisation_id))
    INTO v_bad;
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'phase5 orphan gate: cross_portal_* carries % dangling builder_organisation_id row(s)', v_bad;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- Release the nine constraints, each by its measured production name.
  -- Never CASCADE: what each drop removes is exactly one constraint.
  -- ---------------------------------------------------------------------

  IF to_regclass('aml.partner_organisations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE aml.partner_organisations DROP CONSTRAINT IF EXISTS partner_organisations_builder_organisation_id_fkey';
  END IF;
  IF to_regclass('public.portal_terms_acceptances') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.portal_terms_acceptances DROP CONSTRAINT IF EXISTS portal_terms_acceptances_builder_user_id_fkey';
  END IF;
  IF to_regclass('public.transaction_case_links') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.transaction_case_links DROP CONSTRAINT IF EXISTS transaction_case_links_builder_transaction_id_fkey';
  END IF;
  IF to_regclass('public.document_processing_jobs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.document_processing_jobs DROP CONSTRAINT IF EXISTS document_processing_jobs_builder_document_version_id_fkey';
  END IF;
  IF to_regclass('public.cross_portal_firm_rollouts') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cross_portal_firm_rollouts DROP CONSTRAINT IF EXISTS cross_portal_firm_rollouts_builder_organisation_id_fkey';
  END IF;
  IF to_regclass('public.cross_portal_rollout_history') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cross_portal_rollout_history DROP CONSTRAINT IF EXISTS cross_portal_rollout_history_builder_organisation_id_fkey';
  END IF;
  IF to_regclass('public.cross_portal_cutover_approvals') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cross_portal_cutover_approvals DROP CONSTRAINT IF EXISTS cross_portal_cutover_approvals_builder_organisation_id_fkey';
  END IF;
  IF to_regclass('public.cross_portal_dual_read_comparisons') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cross_portal_dual_read_comparisons DROP CONSTRAINT IF EXISTS cross_portal_dual_read_comparisons_builder_organisation_id_fkey';
  END IF;
  IF to_regclass('public.cross_portal_reconciliation_runs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.cross_portal_reconciliation_runs DROP CONSTRAINT IF EXISTS cross_portal_reconciliation_runs_builder_organisation_id_fkey';
  END IF;
END
$phase5$;

-- ============================================================================
-- E1 — the transaction mirror, and the re-point (plan §3 E1).
--
-- The PK IS the network's transaction id: the inbound sync writes rows under
-- the ids the network minted, which is exactly what lets the case-link slot
-- keep its column and swap only the table it references. No DEFAULT on the
-- id, deliberately — nothing on this side may mint one.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.builder_network_transactions (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL
    REFERENCES public.builder_network_connections(id) ON DELETE CASCADE,
  -- The guard's assertion column: which of this workspace's clients the
  -- network says the sale belongs to. Nullable — unsold inventory and
  -- direct-to-public sales exist and must never reach a case.
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (btrim(status) <> ''),
  stage_key text,
  remote_updated_at timestamptz,
  source_version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS builder_network_transactions_connection_idx
  ON public.builder_network_transactions (connection_id);

-- Set-once: a mirrored transaction cannot move between connections
-- (the builder_enforce_stock_selection_org shape — a named P0001, not a
-- silent overwrite).
CREATE OR REPLACE FUNCTION public.builder_network_transaction_connection_set_once()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.connection_id IS DISTINCT FROM NEW.connection_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_NETWORK_CONNECTION_IMMUTABLE',
      DETAIL='a mirrored transaction cannot move between connections';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_builder_network_transaction_connection
  ON public.builder_network_transactions;
CREATE TRIGGER trg_builder_network_transaction_connection
  BEFORE UPDATE OF connection_id ON public.builder_network_transactions
  FOR EACH ROW EXECUTE FUNCTION public.builder_network_transaction_connection_set_once();

-- Service-role only, like its four transport siblings: the browser never
-- reads the sync plane.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.builder_network_transactions ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS builder_network_transactions_service ON public.builder_network_transactions';
  EXECUTE 'CREATE POLICY builder_network_transactions_service ON public.builder_network_transactions AS PERMISSIVE FOR ALL TO service_role USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  EXECUTE 'REVOKE ALL ON public.builder_network_transactions FROM anon, authenticated';
  EXECUTE 'GRANT ALL ON public.builder_network_transactions TO service_role';
END $$;

-- The re-point itself. Conditioned on the slot column existing, because a
-- corpus Phase 7 has pruned never adds it; gated on every referenced id
-- being mirrored, because a link that names an unmirrored transaction
-- cannot be re-pointed — it can only be looked at (0 such links measured).
DO $phase5_repoint$
DECLARE
  v_bad bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transaction_case_links'
      AND column_name = 'builder_transaction_id'
  ) THEN
    SELECT count(*) INTO v_bad FROM public.transaction_case_links l
      WHERE l.builder_transaction_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.builder_network_transactions m
                        WHERE m.id = l.builder_transaction_id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'phase5 re-point gate: % transaction_case_links row(s) name a builder transaction the network mirror does not hold', v_bad;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'transaction_case_links_builder_network_transaction_fkey'
        AND conrelid = 'public.transaction_case_links'::regclass
    ) THEN
      EXECUTE 'ALTER TABLE public.transaction_case_links
                 ADD CONSTRAINT transaction_case_links_builder_network_transaction_fkey
                 FOREIGN KEY (builder_transaction_id)
                 REFERENCES public.builder_network_transactions(id) ON DELETE SET NULL';
    END IF;

    -- The guard's fourth branch: one identifier changes, and NOT FOUND gains
    -- its own message so "not mirrored" is never dressed up as a client
    -- mismatch. Every other branch is byte-identical to 20260805000000, and
    -- CROSS_CLIENT_CASE_LINK keeps its exact spelling. The trigger and its
    -- column list are untouched.
    EXECUTE $guard$
      CREATE OR REPLACE FUNCTION public.guard_transaction_case_links() RETURNS trigger
      LANGUAGE plpgsql SET search_path = public AS $fn$
      DECLARE case_client uuid; domain_client uuid;
      BEGIN
        SELECT client_id INTO case_client FROM public.transaction_cases WHERE id = NEW.case_id;
        IF case_client IS NULL THEN
          RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CASE_NOT_FOUND';
        END IF;

        IF NEW.legal_matter_id IS NOT NULL THEN
          domain_client := NULL;
          SELECT client_id INTO domain_client FROM public.legal_matters WHERE id = NEW.legal_matter_id;
          IF domain_client IS DISTINCT FROM case_client THEN
            RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CROSS_CLIENT_CASE_LINK';
          END IF;
        END IF;

        IF NEW.purchase_file_id IS NOT NULL THEN
          domain_client := NULL;
          SELECT client_id INTO domain_client FROM public.purchase_files WHERE id = NEW.purchase_file_id;
          IF domain_client IS DISTINCT FROM case_client THEN
            RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CROSS_CLIENT_CASE_LINK';
          END IF;
        END IF;

        IF NEW.client_deal_id IS NOT NULL THEN
          domain_client := NULL;
          SELECT client_id INTO domain_client FROM public.client_deals WHERE id = NEW.client_deal_id;
          IF domain_client IS DISTINCT FROM case_client THEN
            RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CROSS_CLIENT_CASE_LINK';
          END IF;
        END IF;

        -- The fourth slot reads the NETWORK MIRROR. A NULL client_id on the
        -- mirrored transaction is not "matches anything" — it is unsold
        -- inventory, which must never reach a case; and a transaction the
        -- mirror does not hold is refused by name rather than being scored
        -- as some other client's.
        IF NEW.builder_transaction_id IS NOT NULL THEN
          domain_client := NULL;
          SELECT client_id INTO domain_client
          FROM public.builder_network_transactions WHERE id = NEW.builder_transaction_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BUILDER_TRANSACTION_NOT_MIRRORED';
          END IF;
          IF domain_client IS DISTINCT FROM case_client THEN
            RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CROSS_CLIENT_CASE_LINK';
          END IF;
        END IF;

        RETURN NEW;
      END $fn$
    $guard$;
  END IF;
END
$phase5_repoint$;

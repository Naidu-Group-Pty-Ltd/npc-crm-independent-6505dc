-- Phase 1 (canonical contracts) — separate AML workflow-status dimensions,
-- explicit activation fields, duplicate-open-case index and field provenance.
--
-- Additive and reversible. The legacy `aml.cases.status` enum remains the
-- compatibility source of truth during the transition; new columns are
-- nullable or defaulted and are backfilled deterministically below. The
-- TypeScript mirror of the backfill mapping lives in
-- `src/lib/aml/caseDimensions.ts` and must stay in sync.
--
-- ROLLBACK (safe while the V3 workspace flags remain off):
--   DROP TABLE IF EXISTS aml.field_provenance;
--   DROP TABLE IF EXISTS aml.workflow_dimension_migrations;
--   DROP INDEX IF EXISTS aml.aml_cases_one_open_per_client;
--   ALTER TABLE aml.cases
--     DROP COLUMN IF EXISTS case_stage,
--     DROP COLUMN IF EXISTS client_portal_status,
--     DROP COLUMN IF EXISTS finance_portal_status,
--     DROP COLUMN IF EXISTS service_gate_status,
--     DROP COLUMN IF EXISTS service_gate_effective_at,
--     DROP COLUMN IF EXISTS service_gate_policy_version,
--     DROP COLUMN IF EXISTS activation_timing,
--     DROP COLUMN IF EXISTS agreement_state,
--     DROP COLUMN IF EXISTS activation_policy_version,
--     DROP COLUMN IF EXISTS legacy_activation_model,
--     DROP COLUMN IF EXISTS migration_classification,
--     DROP COLUMN IF EXISTS migration_reviewed_by,
--     DROP COLUMN IF EXISTS migration_reviewed_at;

-- 1) Workflow-dimension and activation columns -------------------------------

ALTER TABLE aml.cases
  ADD COLUMN IF NOT EXISTS case_stage text,
  ADD COLUMN IF NOT EXISTS client_portal_status text,
  ADD COLUMN IF NOT EXISTS finance_portal_status text,
  ADD COLUMN IF NOT EXISTS service_gate_status text,
  ADD COLUMN IF NOT EXISTS service_gate_effective_at timestamptz,
  ADD COLUMN IF NOT EXISTS service_gate_policy_version text,
  ADD COLUMN IF NOT EXISTS activation_timing text,
  ADD COLUMN IF NOT EXISTS agreement_state text,
  ADD COLUMN IF NOT EXISTS activation_policy_version text,
  ADD COLUMN IF NOT EXISTS legacy_activation_model text,
  ADD COLUMN IF NOT EXISTS migration_classification text,
  ADD COLUMN IF NOT EXISTS migration_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS migration_reviewed_at timestamptz;

-- Allowed values (directive §16 / §17). Text + CHECK rather than new enums so
-- future values ship as plain constraint swaps (transactional, reversible).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aml_cases_case_stage_check') THEN
    ALTER TABLE aml.cases ADD CONSTRAINT aml_cases_case_stage_check CHECK (
      case_stage IS NULL OR case_stage IN (
        'draft','activated','awaiting_client','client_in_progress','client_submitted',
        'staff_review','checks_in_progress','additional_info_required','decision_pending',
        'cleared','cleared_with_conditions','enhanced_cdd','blocked','closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aml_cases_client_portal_status_check') THEN
    ALTER TABLE aml.cases ADD CONSTRAINT aml_cases_client_portal_status_check CHECK (
      client_portal_status IS NULL OR client_portal_status IN (
        'not_started','action_required','in_progress','submitted','under_review',
        'additional_info_required','complete','contact_adviser'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aml_cases_finance_portal_status_check') THEN
    ALTER TABLE aml.cases ADD CONSTRAINT aml_cases_finance_portal_status_check CHECK (
      finance_portal_status IS NULL OR finance_portal_status IN (
        'not_requested','information_required','submitted','clarification_required',
        'under_review','accepted','no_further_action'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aml_cases_service_gate_status_check') THEN
    ALTER TABLE aml.cases ADD CONSTRAINT aml_cases_service_gate_status_check CHECK (
      service_gate_status IS NULL OR service_gate_status IN (
        'not_activated','cdd_incomplete','information_outstanding','under_review',
        'conditions_outstanding','approved_with_controls','approved','locked','terminated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aml_cases_activation_timing_check') THEN
    ALTER TABLE aml.cases ADD CONSTRAINT aml_cases_activation_timing_check CHECK (
      activation_timing IS NULL OR activation_timing IN (
        'pre_agreement','conditional_agreement','post_agreement_trigger','legacy_unclassified'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aml_cases_agreement_state_check') THEN
    ALTER TABLE aml.cases ADD CONSTRAINT aml_cases_agreement_state_check CHECK (
      agreement_state IS NULL OR agreement_state IN (
        'not_executed','conditional_executed','operative','terminated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aml_cases_legacy_activation_model_check') THEN
    ALTER TABLE aml.cases ADD CONSTRAINT aml_cases_legacy_activation_model_check CHECK (
      legacy_activation_model IS NULL OR legacy_activation_model IN ('A','B'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aml_cases_migration_classification_check') THEN
    ALTER TABLE aml.cases ADD CONSTRAINT aml_cases_migration_classification_check CHECK (
      migration_classification IS NULL OR migration_classification IN (
        'auto_classified','human_reviewed','ambiguous_pending_review'));
  END IF;
END $$;

-- 2) Migration audit side-table ----------------------------------------------
-- Backfill provenance is recorded here rather than in aml.case_events so the
-- SHA-256 hash chain (computed only by the aml-cases edge function) is never
-- forked by SQL-inserted rows.

CREATE TABLE IF NOT EXISTS aml.workflow_dimension_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  previous_status text NOT NULL,
  previous_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_case_stage text,
  assigned_client_portal_status text,
  assigned_service_gate_status text,
  assigned_activation_timing text,
  assigned_agreement_state text,
  assigned_legacy_activation_model text,
  classification text NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE aml.workflow_dimension_migrations ENABLE ROW LEVEL SECURITY;
-- Default-deny RLS; access is exclusively through SECURITY DEFINER edge
-- functions using service_role (same posture as the rest of the aml schema).
GRANT ALL ON aml.workflow_dimension_migrations TO service_role;

-- 3) Deterministic backfill ---------------------------------------------------
-- Mirrors LEGACY_STATUS_TO_* in src/lib/aml/caseDimensions.ts. Activation
-- fields derive from metadata->'activation'->>'model' where recorded; cases
-- without a recorded model are marked ambiguous for human review (§17.4).
-- Production aml.cases is empty at time of authoring; this backfill exists for
-- staging/local data and for reproducibility.

WITH classified AS (
  SELECT
    c.id,
    c.status,
    c.metadata,
    CASE c.status
      WHEN 'draft' THEN 'draft'
      WHEN 'kyc_in_progress' THEN 'client_in_progress'
      WHEN 'kyc_complete' THEN 'client_submitted'
      WHEN 'edd_required' THEN 'enhanced_cdd'
      WHEN 'under_review' THEN 'staff_review'
      WHEN 'escalated_mlro' THEN 'decision_pending'
      WHEN 'cleared' THEN 'cleared'
      WHEN 'blocked' THEN 'blocked'
      WHEN 'closed' THEN 'closed'
    END AS new_stage,
    CASE c.status
      WHEN 'draft' THEN 'not_started'
      WHEN 'kyc_in_progress' THEN 'in_progress'
      WHEN 'kyc_complete' THEN 'submitted'
      WHEN 'edd_required' THEN 'additional_info_required'
      WHEN 'under_review' THEN 'under_review'
      WHEN 'escalated_mlro' THEN 'under_review'
      WHEN 'cleared' THEN 'complete'
      WHEN 'blocked' THEN 'contact_adviser'
      WHEN 'closed' THEN 'complete'
    END AS new_portal,
    CASE c.status
      WHEN 'draft' THEN 'not_activated'
      WHEN 'kyc_in_progress' THEN 'cdd_incomplete'
      WHEN 'kyc_complete' THEN 'under_review'
      WHEN 'edd_required' THEN 'information_outstanding'
      WHEN 'under_review' THEN 'under_review'
      WHEN 'escalated_mlro' THEN 'under_review'
      WHEN 'cleared' THEN 'approved'
      WHEN 'blocked' THEN 'locked'
      WHEN 'closed' THEN 'terminated'
    END AS new_gate,
    NULLIF(upper(c.metadata #>> '{activation,model}'), '') AS legacy_model,
    NULLIF(c.metadata #>> '{activation,program_version}', '') AS program_version
  FROM aml.cases c
  WHERE c.case_stage IS NULL
),
updated AS (
  UPDATE aml.cases c SET
    case_stage = cl.new_stage,
    client_portal_status = cl.new_portal,
    finance_portal_status = 'not_requested',
    service_gate_status = cl.new_gate,
    activation_timing = CASE cl.legacy_model
      WHEN 'A' THEN 'post_agreement_trigger'
      WHEN 'B' THEN 'conditional_agreement'
      ELSE 'legacy_unclassified' END,
    agreement_state = CASE cl.legacy_model
      WHEN 'A' THEN 'operative'
      WHEN 'B' THEN 'conditional_executed'
      ELSE NULL END,
    activation_policy_version = cl.program_version,
    legacy_activation_model = CASE WHEN cl.legacy_model IN ('A','B') THEN cl.legacy_model ELSE NULL END,
    migration_classification = CASE
      WHEN cl.legacy_model IN ('A','B') THEN 'auto_classified'
      ELSE 'ambiguous_pending_review' END
  FROM classified cl
  WHERE c.id = cl.id
  RETURNING c.id, cl.status AS previous_status, cl.metadata AS previous_metadata,
    c.case_stage, c.client_portal_status, c.service_gate_status,
    c.activation_timing, c.agreement_state, c.legacy_activation_model,
    c.migration_classification
)
INSERT INTO aml.workflow_dimension_migrations (
  case_id, previous_status, previous_metadata, assigned_case_stage,
  assigned_client_portal_status, assigned_service_gate_status,
  assigned_activation_timing, assigned_agreement_state,
  assigned_legacy_activation_model, classification)
SELECT id, previous_status, COALESCE(previous_metadata, '{}'::jsonb), case_stage,
  client_portal_status, service_gate_status, activation_timing, agreement_state,
  legacy_activation_model, migration_classification
FROM updated;

-- 4) Duplicate-open-case enforcement -----------------------------------------
-- The aml-cases edge function already 409s on a read-then-write check; this
-- partial unique index closes the race window. Predicate matches the edge
-- function's guard exactly: cleared/blocked/closed cases do not block a new
-- activation.

CREATE UNIQUE INDEX IF NOT EXISTS aml_cases_one_open_per_client
  ON aml.cases (client_id)
  WHERE client_id IS NOT NULL
    AND status NOT IN ('cleared'::aml.case_status, 'blocked'::aml.case_status, 'closed'::aml.case_status);

-- 5) Field provenance (Appendix C.3) -----------------------------------------
-- Canonical record of where each material value came from. Append-first:
-- conflicting values are new rows; acceptance stamps the accepted row rather
-- than overwriting sources.

CREATE TABLE IF NOT EXISTS aml.field_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  party_id uuid,
  entity_id uuid,
  field_key text NOT NULL,
  value jsonb,
  source_type text NOT NULL CHECK (source_type IN (
    'client_portal','finance_portal','document','provider','purchase_file','staff')),
  source_record_id text,
  source_portal text,
  submitted_by text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN (
    'unverified','pending','verified','failed','waived')),
  conflict_status text NOT NULL DEFAULT 'none' CHECK (conflict_status IN (
    'none','conflict','superseded','resolved')),
  is_canonical boolean NOT NULL DEFAULT false,
  canonical_value jsonb,
  accepted_by uuid,
  accepted_at timestamptz,
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aml_field_provenance_case_field_idx
  ON aml.field_provenance (case_id, field_key);
CREATE INDEX IF NOT EXISTS aml_field_provenance_conflict_idx
  ON aml.field_provenance (case_id) WHERE conflict_status = 'conflict';

ALTER TABLE aml.field_provenance ENABLE ROW LEVEL SECURITY;
-- Default-deny RLS; SECURITY DEFINER edge functions only.
GRANT ALL ON aml.field_provenance TO service_role;

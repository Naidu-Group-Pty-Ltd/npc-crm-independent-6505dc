-- =============================================================================
-- Commercial & Industrial Finance Assessments
-- =============================================================================
-- An assessment is a self-contained working document: the proposed transaction,
-- the borrower structure, their existing portfolio and the policy assumptions
-- used to test it. It deliberately carries NO client foreign key until the
-- final linking step, which is why client_id is nullable and only written by
-- the link operation.
--
-- Access follows the repository's established pattern: RLS admits service_role
-- only, and all reads and writes are mediated by the `manage-ci-assessments`
-- edge function which authenticates the caller and scopes every query by
-- user_id. Nothing here is reachable with an anon or authenticated JWT.
--
-- Existing commercial_properties / commercial_leases / industrial_* tables are
-- untouched — assessments sit alongside the asset register rather than
-- replacing it, so no existing record or report changes behaviour.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- commercial_industrial_assessments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_industrial_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,

  reference text NOT NULL,
  title text NOT NULL DEFAULT 'Untitled assessment',
  status text NOT NULL DEFAULT 'draft',
  segment text NOT NULL DEFAULT 'commercial',
  assessment_type text NOT NULL DEFAULT 'commercial_investment',

  -- The whole working document. Stored as one JSONB blob because it is always
  -- read and written as a unit by the wizard, and because a schema change to a
  -- deeply nested section must not require a migration on live drafts.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Denormalised for list filtering and the summary metrics. Refreshed on every
  -- calculation run; never the source of truth.
  requested_loan numeric,
  maximum_indicative_loan numeric,
  proposed_lvr numeric,
  proposed_dscr numeric,
  outcome text,
  binding_constraint text,

  -- Client association. Null until the final linking step runs.
  client_id uuid,
  linked_at timestamptz,
  linked_by uuid,

  current_calculation_id uuid,

  -- Optimistic concurrency. The edge function rejects a write whose expected
  -- version does not match, so two tabs cannot silently overwrite each other.
  version integer NOT NULL DEFAULT 1,

  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,

  CONSTRAINT ci_assessments_status_check CHECK (status IN (
    'draft', 'data_entry', 'ready_to_calculate', 'calculated',
    'requires_review', 'completed', 'linked', 'archived'
  )),
  CONSTRAINT ci_assessments_segment_check CHECK (segment IN ('commercial', 'industrial'))
);

CREATE INDEX IF NOT EXISTS ci_assessments_user_status_idx
  ON public.commercial_industrial_assessments(user_id, status)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS ci_assessments_user_updated_idx
  ON public.commercial_industrial_assessments(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ci_assessments_client_idx
  ON public.commercial_industrial_assessments(client_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ci_assessments_segment_idx
  ON public.commercial_industrial_assessments(user_id, segment);
CREATE UNIQUE INDEX IF NOT EXISTS ci_assessments_reference_idx
  ON public.commercial_industrial_assessments(user_id, reference);

GRANT ALL ON public.commercial_industrial_assessments TO service_role;
ALTER TABLE public.commercial_industrial_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role manages ci assessments" ON public.commercial_industrial_assessments;
CREATE POLICY "service_role manages ci assessments"
  ON public.commercial_industrial_assessments FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_ci_assessments_updated_at ON public.commercial_industrial_assessments;
CREATE TRIGGER trg_ci_assessments_updated_at
  BEFORE UPDATE ON public.commercial_industrial_assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- commercial_industrial_calculation_runs
-- -----------------------------------------------------------------------------
-- Immutable. A completed assessment must keep producing the number it produced
-- on the day it was completed even after platform defaults move, so each run
-- stores the full inputs and the resolved policy alongside its outputs.
-- Recalculation writes a NEW row; it never updates one.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_industrial_calculation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL
    REFERENCES public.commercial_industrial_assessments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,

  engine_version text NOT NULL,
  policy_version text NOT NULL,
  scenario_key text NOT NULL DEFAULT 'base',

  inputs_snapshot jsonb NOT NULL,
  policy_snapshot jsonb NOT NULL,
  outputs jsonb NOT NULL,

  outcome text,
  binding_constraint text,
  maximum_indicative_loan numeric,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ci_calc_runs_assessment_idx
  ON public.commercial_industrial_calculation_runs(assessment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ci_calc_runs_user_idx
  ON public.commercial_industrial_calculation_runs(user_id);

GRANT ALL ON public.commercial_industrial_calculation_runs TO service_role;
ALTER TABLE public.commercial_industrial_calculation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role manages ci calculation runs" ON public.commercial_industrial_calculation_runs;
CREATE POLICY "service_role manages ci calculation runs"
  ON public.commercial_industrial_calculation_runs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- -----------------------------------------------------------------------------
-- commercial_industrial_assessment_scenarios
-- -----------------------------------------------------------------------------
-- A scenario is a named mutation of the base payload, not a copy of the whole
-- assessment. Storing the definition rather than a duplicated document is what
-- lets the comparison state exactly which assumption moved.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_industrial_assessment_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL
    REFERENCES public.commercial_industrial_assessments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,

  scenario_key text NOT NULL,
  label text NOT NULL,
  changed_assumption text,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  latest_outputs jsonb,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ci_scenarios_assessment_idx
  ON public.commercial_industrial_assessment_scenarios(assessment_id);

GRANT ALL ON public.commercial_industrial_assessment_scenarios TO service_role;
ALTER TABLE public.commercial_industrial_assessment_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role manages ci scenarios" ON public.commercial_industrial_assessment_scenarios;
CREATE POLICY "service_role manages ci scenarios"
  ON public.commercial_industrial_assessment_scenarios FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_ci_scenarios_updated_at ON public.commercial_industrial_assessment_scenarios;
CREATE TRIGGER trg_ci_scenarios_updated_at
  BEFORE UPDATE ON public.commercial_industrial_assessment_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- commercial_industrial_assessment_client_links
-- -----------------------------------------------------------------------------
-- Records WHO linked an assessment to a client, WHEN, and exactly WHICH fields
-- they chose to write back. Unlinking sets unlinked_at and leaves the row —
-- the audit history of a link survives the link itself.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_industrial_assessment_client_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL
    REFERENCES public.commercial_industrial_assessments(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  user_id uuid NOT NULL,

  -- The full reconciliation decision set, one entry per item with the
  -- disposition the user chose.
  reconciliation_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What was actually written to the client record as a result.
  applied_changes jsonb NOT NULL DEFAULT '[]'::jsonb,

  linked_by uuid,
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_by uuid,
  unlinked_at timestamptz
);

CREATE INDEX IF NOT EXISTS ci_client_links_assessment_idx
  ON public.commercial_industrial_assessment_client_links(assessment_id);
CREATE INDEX IF NOT EXISTS ci_client_links_client_idx
  ON public.commercial_industrial_assessment_client_links(client_id);

GRANT ALL ON public.commercial_industrial_assessment_client_links TO service_role;
ALTER TABLE public.commercial_industrial_assessment_client_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role manages ci client links" ON public.commercial_industrial_assessment_client_links;
CREATE POLICY "service_role manages ci client links"
  ON public.commercial_industrial_assessment_client_links FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- -----------------------------------------------------------------------------
-- commercial_industrial_assessment_audit_events
-- -----------------------------------------------------------------------------
-- Append-only. Deliberately carries no free-text payload from the assessment
-- itself beyond a structured detail object, so an ordinary audit read never
-- exposes borrower financial detail to somebody reviewing access history.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_industrial_assessment_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL
    REFERENCES public.commercial_industrial_assessments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,

  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ci_audit_assessment_idx
  ON public.commercial_industrial_assessment_audit_events(assessment_id, created_at DESC);

GRANT ALL ON public.commercial_industrial_assessment_audit_events TO service_role;
ALTER TABLE public.commercial_industrial_assessment_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role manages ci audit events" ON public.commercial_industrial_assessment_audit_events;
CREATE POLICY "service_role manages ci audit events"
  ON public.commercial_industrial_assessment_audit_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- -----------------------------------------------------------------------------
-- commercial_industrial_policy_profiles
-- -----------------------------------------------------------------------------
-- Organisation-level assumption overrides with effective-from dating and full
-- change history. A profile is never edited in place: a change writes a new
-- row with a later effective_from, so a historical calculation can always be
-- re-resolved against the profile that was current when it ran.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_industrial_policy_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,

  profile_key text NOT NULL,
  label text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version text NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ci_policy_profiles_user_idx
  ON public.commercial_industrial_policy_profiles(user_id, profile_key, effective_from DESC);

GRANT ALL ON public.commercial_industrial_policy_profiles TO service_role;
ALTER TABLE public.commercial_industrial_policy_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role manages ci policy profiles" ON public.commercial_industrial_policy_profiles;
CREATE POLICY "service_role manages ci policy profiles"
  ON public.commercial_industrial_policy_profiles FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_ci_policy_profiles_updated_at ON public.commercial_industrial_policy_profiles;
CREATE TRIGGER trg_ci_policy_profiles_updated_at
  BEFORE UPDATE ON public.commercial_industrial_policy_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- Foreign key from assessment to its current calculation run.
-- Added after both tables exist. ON DELETE SET NULL so purging old runs cannot
-- cascade into the assessment itself.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ci_assessments_current_calculation_fkey'
  ) THEN
    ALTER TABLE public.commercial_industrial_assessments
      ADD CONSTRAINT ci_assessments_current_calculation_fkey
      FOREIGN KEY (current_calculation_id)
      REFERENCES public.commercial_industrial_calculation_runs(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON TABLE public.commercial_industrial_assessments IS
  'Commercial & Industrial finance assessments. client_id stays null until the final linking step.';
COMMENT ON TABLE public.commercial_industrial_calculation_runs IS
  'Immutable calculation snapshots. Recalculation appends a new row so historical results never change.';
COMMENT ON COLUMN public.commercial_industrial_assessments.version IS
  'Optimistic concurrency token. The edge function rejects writes with a stale expected version.';

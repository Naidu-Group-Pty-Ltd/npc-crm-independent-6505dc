-- Arrangement governance — Phase 2 of the AML/CTF partner/reliance domain.
--
-- s 37A conditions a CDD arrangement on being WRITTEN and REGULARLY
-- REVIEWED. Until now the review was three scalar columns on the agreement
-- (next_review_due / last_reviewed_at / last_reviewed_by) — enough to block
-- an overdue grant, not enough to evidence WHAT was assessed, what was
-- found, or what the operative decision rests on. This migration adds:
--
--   reliance_agreements (extended, additive) — structured scope (customer
--       types / procedures / record classes), eligibility classification
--       (recorded configuration, never inferred), record-availability SLA,
--       version + effective dates, executed-document reference and a
--       pointer to the operative assessment. All new columns are nullable
--       or safely defaulted: historical rows keep working unchanged.
--
--   arrangement_assessments — the IMMUTABLE review history. Re-assessment
--       supersedes (status + superseded_by_id), it never edits. Same
--       supersede-not-overwrite doctrine as aml.retention_triggers: the
--       basis of any past reliance decision stays reconstructable.
--
-- Eligibility classification records WHICH controlled value an authorised
-- human recorded; it is not a legal conclusion by the system. An agreement
-- whose eligibility is unassessed, whose assessment is overdue or
-- unsuitable, or whose scope does not cover the procedure, blocks NEW
-- reliance access (enforced in aml-reliance behind the
-- aml_arrangement_governance flag, seeded false). The independent-CDD
-- route is never gated by any of this.
--
-- Additive only.
--
-- ROLLBACK:
--   ALTER TABLE aml.reliance_agreements DROP CONSTRAINT IF EXISTS fk_aml_agreements_current_assessment;
--   ALTER TABLE aml.reliance_agreements
--     DROP COLUMN IF EXISTS current_assessment_id,
--     DROP COLUMN IF EXISTS executed_document_reference,
--     DROP COLUMN IF EXISTS expires_on,
--     DROP COLUMN IF EXISTS effective_from,
--     DROP COLUMN IF EXISTS agreement_version,
--     DROP COLUMN IF EXISTS cross_border_terms,
--     DROP COLUMN IF EXISTS jurisdiction,
--     DROP COLUMN IF EXISTS record_availability_sla_hours,
--     DROP COLUMN IF EXISTS scope_record_classes,
--     DROP COLUMN IF EXISTS scope_procedures,
--     DROP COLUMN IF EXISTS scope_customer_types,
--     DROP COLUMN IF EXISTS eligibility_classification;
--   DROP TABLE IF EXISTS aml.arrangement_assessments;
--   DELETE FROM public.feature_flags WHERE key = 'aml_arrangement_governance';

ALTER TABLE aml.reliance_agreements
  ADD COLUMN IF NOT EXISTS eligibility_classification text NOT NULL DEFAULT 'unassessed'
    CHECK (eligibility_classification IN
      ('unassessed', 'eligible_reporting_entity', 'eligible_foreign_equivalent', 'not_eligible')),
  ADD COLUMN IF NOT EXISTS scope_customer_types text[],
  ADD COLUMN IF NOT EXISTS scope_procedures text[],
  ADD COLUMN IF NOT EXISTS scope_record_classes text[],
  ADD COLUMN IF NOT EXISTS record_availability_sla_hours integer
    CHECK (record_availability_sla_hours IS NULL OR record_availability_sla_hours > 0),
  ADD COLUMN IF NOT EXISTS jurisdiction text,
  ADD COLUMN IF NOT EXISTS cross_border_terms text,
  ADD COLUMN IF NOT EXISTS agreement_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS expires_on date,
  ADD COLUMN IF NOT EXISTS executed_document_reference text,
  ADD COLUMN IF NOT EXISTS current_assessment_id uuid;

CREATE TABLE IF NOT EXISTS aml.arrangement_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES aml.reliance_agreements(id),
  assessment_version integer NOT NULL,
  assessed_by uuid NOT NULL,
  assessed_by_label text,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  trigger text NOT NULL CHECK (trigger IN
    ('initial', 'scheduled', 'significant_change', 'incident', 'other')),
  evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  findings text,
  decision text NOT NULL CHECK (decision IN
    ('suitable', 'suitable_with_conditions', 'unsuitable')),
  conditions text,
  next_due_at date NOT NULL,
  status text NOT NULL DEFAULT 'operative'
    CHECK (status IN ('operative', 'superseded')),
  superseded_at timestamptz,
  superseded_by_id uuid REFERENCES aml.arrangement_assessments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- History is append-only and versioned per agreement.
  UNIQUE (agreement_id, assessment_version),
  -- A superseded row must say when and by what; an operative row must not.
  CONSTRAINT arrangement_assessment_supersede_coherent CHECK (
    (status = 'operative' AND superseded_at IS NULL)
    OR (status = 'superseded' AND superseded_at IS NOT NULL)
  )
);

-- One operative assessment per agreement, enforced structurally.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_arrangement_assessment_operative
  ON aml.arrangement_assessments (agreement_id) WHERE status = 'operative';
CREATE INDEX IF NOT EXISTS idx_aml_arrangement_assessments_agreement
  ON aml.arrangement_assessments (agreement_id, assessment_version DESC);

ALTER TABLE aml.reliance_agreements
  DROP CONSTRAINT IF EXISTS fk_aml_agreements_current_assessment;
ALTER TABLE aml.reliance_agreements
  ADD CONSTRAINT fk_aml_agreements_current_assessment
  FOREIGN KEY (current_assessment_id) REFERENCES aml.arrangement_assessments(id);

GRANT ALL ON aml.arrangement_assessments TO service_role;
ALTER TABLE aml.arrangement_assessments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "aml_arrangement_assessments_service_only"
    ON aml.arrangement_assessments FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enforcement flag for the arrangement layer of the reliance eligibility
-- guard. Off by default: legacy behaviour (agreement active + review not
-- overdue + consent + attestation) is unchanged until enabled.
INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_arrangement_governance', 'false'::jsonb,
   'AML partner domain Phase 2: new reliance grants additionally require a recorded eligibility classification, an in-scope arrangement, and an operative, current, suitable arrangement assessment. Off = Phase 1 / legacy checks only.')
ON CONFLICT (key) DO NOTHING;

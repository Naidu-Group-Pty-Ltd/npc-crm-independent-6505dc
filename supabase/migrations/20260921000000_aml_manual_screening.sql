-- Manual screening: a second EXECUTION METHOD for a required screening, not a
-- second policy and not an exemption.
--
-- ## What already existed, and is reused unchanged
--
-- `aml.screening_checks` is already the canonical record of a screening
-- attempt, `aml.screening_matches` already carries candidates into the
-- reviewer/MLRO adjudication workflow, and `aml.pep_determinations` already
-- records a manually established PEP conclusion with sources and rationale.
-- None of that is duplicated here. A manual check is a `screening_checks`
-- row, its candidates are `screening_matches` rows, and PEP keeps its own
-- record.
--
-- The existing status vocabulary already expresses every manual outcome:
--
--     no_match            -> status 'clear'
--     possible_match      -> status 'matched', with open screening_matches
--     confirmed_match     -> status 'matched', with a confirmed match
--     unable_to_complete  -> status 'failed'
--
-- so no new status values are introduced and every consumer of `status`
-- keeps working without knowing manual screening exists.
--
-- ## Why `execution_mode` could NOT carry this
--
-- `execution_mode` is `live` | `simulation`: whether the run went against
-- real provider data or the simulator. `aml-cases` treats
-- `execution_mode = 'simulation' OR authoritative = false` as not
-- authoritative. A manual check performed by the MLRO against real published
-- lists IS authoritative and IS live — it simply was not performed by the
-- provider. Overloading that column would have made every manual check read
-- as a simulation, which is the opposite of what it is.
--
-- Manual-vs-automated is a second, orthogonal axis, so it gets its own
-- column and the existing one keeps its meaning.
--
-- ## The rule the columns enforce
--
-- A manual check that claims `no_match` must carry the evidence that makes
-- that claim reasonable: who performed it, when, which sources were checked,
-- which names were searched, and why the conclusion follows. The database
-- refuses a manual no-match without them, so a "clear" cannot be recorded by
-- any code path that forgets to collect the evidence.
--
-- Additive and idempotent. No existing row is rewritten; every historical
-- automated check keeps its meaning and reads as `automated`.
--
-- ROLLBACK (exact):
--   ALTER TABLE aml.screening_checks
--     DROP CONSTRAINT IF EXISTS screening_checks_unable_reason_required,
--     DROP CONSTRAINT IF EXISTS screening_checks_manual_evidence,
--     DROP CONSTRAINT IF EXISTS screening_checks_manual_actor,
--     DROP CONSTRAINT IF EXISTS screening_checks_manual_outcome_check,
--     DROP CONSTRAINT IF EXISTS screening_checks_unable_reason_check,
--     DROP CONSTRAINT IF EXISTS screening_checks_screening_method_check,
--     DROP COLUMN IF EXISTS screening_method,
--     DROP COLUMN IF EXISTS performed_by,
--     DROP COLUMN IF EXISTS performed_at,
--     DROP COLUMN IF EXISTS rationale,
--     DROP COLUMN IF EXISTS sources_checked,
--     DROP COLUMN IF EXISTS searched_names,
--     DROP COLUMN IF EXISTS manual_outcome,
--     DROP COLUMN IF EXISTS unable_reason,
--     DROP COLUMN IF EXISTS policy_required,
--     DROP COLUMN IF EXISTS voluntary;
--   ALTER TABLE aml.party_screening_subjects DROP COLUMN IF EXISTS screening_method;

/* ── 1. How the check was performed ───────────────────────────────────── */
ALTER TABLE aml.screening_checks
  ADD COLUMN IF NOT EXISTS screening_method text NOT NULL DEFAULT 'automated',
  -- Server-set from the authenticated session. Never accepted from a client.
  ADD COLUMN IF NOT EXISTS performed_by uuid,
  ADD COLUMN IF NOT EXISTS performed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rationale text,
  -- [{source_type, source_name, source_reference, searched_name, searched_at, notes}]
  ADD COLUMN IF NOT EXISTS sources_checked jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The names actually put to those sources, primary and aliases.
  ADD COLUMN IF NOT EXISTS searched_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_outcome text,
  ADD COLUMN IF NOT EXISTS unable_reason text,
  -- Whether POLICY required this screening, recorded on the attempt so a
  -- voluntary check can never be read back as a mandatory one, or the
  -- reverse.
  ADD COLUMN IF NOT EXISTS policy_required boolean,
  ADD COLUMN IF NOT EXISTS voluntary boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE aml.screening_checks
    ADD CONSTRAINT screening_checks_screening_method_check
    CHECK (screening_method IN ('automated', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE aml.screening_checks
    ADD CONSTRAINT screening_checks_manual_outcome_check
    CHECK (manual_outcome IS NULL OR manual_outcome IN
      ('no_match', 'possible_match', 'confirmed_match', 'unable_to_complete'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE aml.screening_checks
    ADD CONSTRAINT screening_checks_unable_reason_check
    CHECK (unable_reason IS NULL OR unable_reason IN
      ('insufficient_identity', 'source_unavailable',
       'evidence_inconclusive', 'other_documented_reason'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A manual check names the person who performed it and when. Without that
-- there is no determination, only an assertion.
DO $$ BEGIN
  ALTER TABLE aml.screening_checks
    ADD CONSTRAINT screening_checks_manual_actor
    CHECK (screening_method <> 'manual'
           OR (performed_by IS NOT NULL AND performed_at IS NOT NULL
               AND manual_outcome IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/*
 * The one that matters. A manual conclusion of NO MATCH is the claim that a
 * customer is not on a list — the single most consequential thing this
 * feature can record — so the evidence for it is a table constraint rather
 * than a hope about the calling code:
 *
 *   at least one source actually checked
 *   at least one name actually searched
 *   a rationale of real length
 *
 * `unable_to_complete` is exempt because it asserts the opposite: that the
 * screening could NOT be concluded. It carries a reason code instead.
 */
DO $$ BEGIN
  ALTER TABLE aml.screening_checks
    ADD CONSTRAINT screening_checks_manual_evidence
    CHECK (
      screening_method <> 'manual'
      OR manual_outcome = 'unable_to_complete'
      OR (
        jsonb_array_length(sources_checked) >= 1
        AND jsonb_array_length(searched_names) >= 1
        AND rationale IS NOT NULL
        AND length(btrim(rationale)) >= 20
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- `unable_to_complete` must say why.
DO $$ BEGIN
  ALTER TABLE aml.screening_checks
    ADD CONSTRAINT screening_checks_unable_reason_required
    CHECK (manual_outcome <> 'unable_to_complete' OR unable_reason IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS screening_checks_method_idx
  ON aml.screening_checks(case_id, screening_method, created_at DESC);
-- The audit query this exists to answer: which screenings were performed by
-- hand, by whom, and with what conclusion.
CREATE INDEX IF NOT EXISTS screening_checks_manual_idx
  ON aml.screening_checks(performed_by, manual_outcome, performed_at DESC)
  WHERE screening_method = 'manual';

/* ── 2. Which method produced the CURRENT position ────────────────────── */
-- The subject projects the latest authoritative attempt. Recording the method
-- there means Stage 5 can say how the current result was reached without
-- re-reading the whole history, and can never present a manual conclusion as
-- a provider one.
ALTER TABLE aml.party_screening_subjects
  ADD COLUMN IF NOT EXISTS screening_method text;

DO $$ BEGIN
  ALTER TABLE aml.party_screening_subjects
    ADD CONSTRAINT party_screening_subjects_method_check
    CHECK (screening_method IS NULL OR screening_method IN ('automated', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ── 3. Retention ─────────────────────────────────────────────────────── */
INSERT INTO aml.retention_schedules (entity_type, retention_years, legal_basis, disposal_method)
SELECT * FROM (VALUES
  ('manual_screening_check', 7::numeric,
   'AML/CTF Act 2006 (Cth) s 107 — the record of a screening performed and concluded by the MLRO, including the sources checked and the basis for the conclusion.',
   'soft_delete')
) AS v(entity_type, retention_years, legal_basis, disposal_method)
WHERE NOT EXISTS (
  SELECT 1 FROM aml.retention_schedules r WHERE r.entity_type = v.entity_type
);

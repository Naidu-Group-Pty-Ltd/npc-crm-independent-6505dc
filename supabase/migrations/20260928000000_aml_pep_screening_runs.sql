-- ═══════════════════════════════════════════════════════════════════════
-- The PEP screening run: what the platform searched, and what came back
-- ═══════════════════════════════════════════════════════════════════════
--
-- A determination has to show HOW the conclusion was reached. Until now the
-- only record of the searching was whatever the operator typed into a source
-- row afterwards — which is a record of what they remembered, made after the
-- fact, in their own words, and different every time.
--
-- This is the record of the search ITSELF: which registers were read, how
-- current each was, what each returned, and which findings are indicators.
-- It is written by the server at the moment of the search.
--
-- WHAT A ROW IN HERE IS NOT
-- It is not a determination, and it can never become one. `verdict` uses a
-- vocabulary that shares no value with `pep_determinations.result` — there is
-- no `clear`, no `not_pep`, no `pass` — and a test asserts the two sets are
-- disjoint. A run finding nothing has established that some registers hold
-- nothing under that name, which is a fact about the search.
--
-- The reviewer or MLRO reads the run and makes the determination. That is why
-- `pep_determinations` is a separate table with its own hash chain: the search
-- is evidence, the determination is a decision, and collapsing them is how an
-- automated result becomes an unfounded clearance.

CREATE TABLE IF NOT EXISTS aml.pep_screening_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  party_screening_subject_id uuid REFERENCES aml.party_screening_subjects(id) ON DELETE SET NULL,

  -- The identity actually searched, derived server-side from the party row.
  -- Recorded because "we searched" means nothing without "for whom".
  subject_name text NOT NULL,
  searched_names text[] NOT NULL DEFAULT ARRAY[]::text[],

  -- A statement about the SEARCH. Deliberately not overlapping with any
  -- determination outcome.
  verdict text NOT NULL CHECK (verdict IN (
    'indicators_found', 'no_indicators', 'incomplete', 'not_searchable')),

  -- Whether a person still has to look. Almost always true, correctly: this
  -- informs a determination, it does not shorten one to a tick.
  requires_manual_review boolean NOT NULL DEFAULT true,

  -- The full structured result, exactly as the engine produced it, so the run
  -- can be re-read years later without re-deriving anything.
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  indicators jsonb NOT NULL DEFAULT '[]'::jsonb,
  not_reached text[] NOT NULL DEFAULT ARRAY[]::text[],

  -- Which register versions were read. A run is only reproducible if it
  -- records what it read, not merely when it ran.
  register_versions jsonb NOT NULL DEFAULT '{}'::jsonb,

  run_by uuid,
  run_by_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── What a reviewer decided about each candidate ───────────────────────
--
-- A candidate is a lead. Somebody has to say whether it is this person, and
-- a rejection has to say why — "dismissed" with no reason is indistinguishable
-- from nobody having looked.
CREATE TABLE IF NOT EXISTS aml.pep_screening_candidate_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  run_id uuid NOT NULL REFERENCES aml.pep_screening_runs(id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  candidate_name text NOT NULL,
  -- `accepted` — this is the subject, and it bears on the determination.
  -- `rejected` — this is somebody else, and the reason says how that was told.
  decision text NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  reason text NOT NULL,
  reviewed_by uuid,
  reviewed_by_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, candidate_id)
);

-- A rejection with an empty reason is the thing this column exists to stop.
DO $$ BEGIN
  ALTER TABLE aml.pep_screening_candidate_reviews
    ADD CONSTRAINT pep_candidate_review_reason_present
    CHECK (length(btrim(reason)) >= 10);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT ALL ON aml.pep_screening_runs TO service_role;
GRANT ALL ON aml.pep_screening_candidate_reviews TO service_role;
ALTER TABLE aml.pep_screening_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.pep_screening_candidate_reviews ENABLE ROW LEVEL SECURITY;

-- Service role only, like every other AML evidence table. Reads go through an
-- edge function, which is where the coverage statement is attached — a direct
-- client grant would let a caller obtain a bare verdict with nothing beside it.
DO $$ BEGIN
  CREATE POLICY "aml_pep_screening_runs_service_only" ON aml.pep_screening_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "aml_pep_candidate_reviews_service_only"
    ON aml.pep_screening_candidate_reviews
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_aml_pep_screening_runs_case
  ON aml.pep_screening_runs(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_pep_screening_runs_subject
  ON aml.pep_screening_runs(party_screening_subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_pep_candidate_reviews_run
  ON aml.pep_screening_candidate_reviews(run_id);

COMMENT ON TABLE aml.pep_screening_runs IS
  'The record of a PEP SEARCH — which registers were read and what they '
  'returned. Never a determination: the verdict vocabulary shares no value '
  'with pep_determinations.result, and a run that found nothing has '
  'established a fact about the search, not about the person.';

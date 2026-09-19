-- Screening scope becomes a decision the system RECORDS, not one it recomputes
-- and forgets.
--
-- ── What existed before this migration ───────────────────────────────────
-- `decideScreeningPolicy` decided which scopes a case needed, and the only
-- trace of that decision was a `case_events` row with
-- `reason = 'screening_scope_decision'`. Audit-only: nothing queried it,
-- nothing gated on it, and there was no way to ask "which cases were
-- exempted from sanctions screening, on what basis, under which policy" —
-- the question an audit actually asks.
--
-- Sanctions was also hardcoded mandatory for every case. That was right for
-- every case the programme had, because targeted financial sanctions are not
-- a risk-based control: the Charter of the United Nations Act 1945 and the
-- Autonomous Sanctions Act 2011 bind every dealing, and no rating, profile
-- or questionnaire answer reduces them.
--
-- ── What changes, and the one thing that does not ────────────────────────
-- What a case can now be is OUTSIDE THE PERIMETER: a record opened for an
-- enquiry that never became an engagement, an administrative duplicate of
-- the case that carries the CDD, a service declined before it commenced. In
-- none of those is a designated service provided, so no obligation attaches.
--
-- That is a perimeter question, not a risk question, and it is the only
-- basis on which sanctions screening may be stood down. `low risk` must
-- never appear as a reason code here.
--
-- ── Fail closed, by construction ─────────────────────────────────────────
-- The DEFAULT IS ALWAYS INSIDE. A case with no perimeter row is inside. A
-- row with an unrecognised reason code is inside. A row that excludes no
-- scopes is inside. There is no data state in these tables that produces an
-- exemption by accident, and no client-writable path reaches them.
--
-- Additive and idempotent. No existing row is rewritten, no history is
-- deleted, and every historical screening decision keeps the policy version
-- it was made under.
--
-- ROLLBACK (exact):
--   ALTER TABLE aml.party_screening_subjects
--     DROP COLUMN IF EXISTS voluntary_run_at,
--     DROP COLUMN IF EXISTS voluntary_run_by,
--     DROP COLUMN IF EXISTS voluntary_run_by_label;
--   DROP TABLE IF EXISTS aml.case_screening_scopes;
--   DROP TABLE IF EXISTS aml.case_screening_perimeter;

/* ── 1. The perimeter classification ──────────────────────────────────── */
-- Append-only with supersession, following aml.pep_determinations: a
-- reclassification is a NEW row that supersedes the previous one, so the
-- basis a past decision rested on is never edited away.
CREATE TABLE IF NOT EXISTS aml.case_screening_perimeter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  classification text NOT NULL
    CHECK (classification IN ('designated_service', 'outside_perimeter')),
  -- A fixed list rather than free text. An exemption defended by prose
  -- nobody can aggregate is not defensible at all. NULL only for the
  -- inside-the-perimeter classification, which needs no reason.
  reason_code text
    CHECK (reason_code IS NULL OR reason_code IN (
      'no_designated_service',
      'enquiry_only',
      'duplicate_record',
      'service_declined_pre_commencement')),
  -- Which obligations the finding removes. Recorded rather than assumed: a
  -- perimeter finding is not automatically a finding about every control,
  -- and defaulting this to "all of them" would stand PEP down on the
  -- strength of a sanctions decision nobody made.
  scopes_excluded text[] NOT NULL DEFAULT '{}',
  note text,
  recorded_by uuid,
  recorded_by_label text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  policy_version text NOT NULL,
  superseded_at timestamptz,
  superseded_by uuid REFERENCES aml.case_screening_perimeter(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- An out-of-perimeter finding without a reason is not a finding.
  CONSTRAINT case_screening_perimeter_reason_required
    CHECK (classification <> 'outside_perimeter' OR reason_code IS NOT NULL),
  -- ...and one that excludes nothing exempts nothing.
  --
  -- `coalesce(..., 0)` is load-bearing: `array_length` of an EMPTY array is
  -- NULL rather than 0, `NULL >= 1` is NULL, and a CHECK constraint passes on
  -- NULL. Without it this constraint accepts the one shape it exists to
  -- refuse. Corrected in 20260920000100 after a probe against the real table
  -- caught it; kept correct here so a fresh apply is right first time.
  CONSTRAINT case_screening_perimeter_scopes_required
    CHECK (classification <> 'outside_perimeter'
           OR coalesce(array_length(scopes_excluded, 1), 0) >= 1)
);

-- At most one operative classification per case. A partial unique index
-- rather than a trigger, so two concurrent writers cannot both believe they
-- recorded the current one.
CREATE UNIQUE INDEX IF NOT EXISTS case_screening_perimeter_one_current
  ON aml.case_screening_perimeter(case_id) WHERE superseded_at IS NULL;

ALTER TABLE aml.case_screening_perimeter ENABLE ROW LEVEL SECURITY;
GRANT ALL ON aml.case_screening_perimeter TO service_role;
DO $$ BEGIN
  CREATE POLICY "aml_case_screening_perimeter_service_only"
    ON aml.case_screening_perimeter
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ── 2. The per-scope decision ────────────────────────────────────────── */
-- The canonical answer to "was this scope required for this case, and why".
-- One row per (case, scope), superseded rather than updated, so a case that
-- moves between policy versions carries both decisions and an auditor can
-- see which rule produced which outcome.
--
-- `state` is deliberately only 'required' | 'not_required'. It is a
-- statement about OBLIGATION. Screening lifecycle — queued, processing,
-- completed, possible_match — belongs to party_screening_subjects and to
-- screening_checks, and must never be conflated with this: `not_required`
-- means no obligation arose, and it is not, and can never be rendered as,
-- "screened and clear".
CREATE TABLE IF NOT EXISTS aml.case_screening_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  scope text NOT NULL
    CHECK (scope IN ('sanctions', 'pep', 'adverse_media', 'watchlist')),
  required boolean NOT NULL,
  -- Whether an authorised operator may run it voluntarily. A scope that is
  -- not required is always optional: "we did not have to" is not a reason to
  -- stop someone who wants the evidence anyway.
  optional boolean NOT NULL,
  state text NOT NULL CHECK (state IN ('required', 'not_required')),
  reason_code text NOT NULL,
  reason text NOT NULL,
  policy_version text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  -- Only the server decides. There is no value here a client can supply.
  decision_source text NOT NULL DEFAULT 'server_policy'
    CHECK (decision_source = 'server_policy'),
  -- The inputs the decision was reproducible from, verbatim.
  material_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  perimeter_id uuid REFERENCES aml.case_screening_perimeter(id),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- required and state say the same thing; disagreeing is not a state the
  -- table will hold.
  CONSTRAINT case_screening_scopes_state_agrees
    CHECK ((required AND state = 'required') OR (NOT required AND state = 'not_required'))
);

CREATE UNIQUE INDEX IF NOT EXISTS case_screening_scopes_one_current
  ON aml.case_screening_scopes(case_id, scope) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS case_screening_scopes_case_idx
  ON aml.case_screening_scopes(case_id);
-- The audit query this table exists to answer: which cases were exempted,
-- from what, on what basis.
CREATE INDEX IF NOT EXISTS case_screening_scopes_exemptions_idx
  ON aml.case_screening_scopes(scope, reason_code)
  WHERE required = false AND superseded_at IS NULL;

ALTER TABLE aml.case_screening_scopes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON aml.case_screening_scopes TO service_role;
DO $$ BEGIN
  CREATE POLICY "aml_case_screening_scopes_service_only"
    ON aml.case_screening_scopes
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ── 3. Retention ─────────────────────────────────────────────────────── */
-- Screening scope decisions are CDD records: they establish what was
-- required of a customer and why. They follow the same seven-year retention
-- as the determinations they sit beside.
INSERT INTO aml.retention_schedules (entity_type, retention_years, legal_basis, disposal_method)
SELECT * FROM (VALUES
  ('case_screening_scope', 7::numeric,
   'AML/CTF Act 2006 (Cth) s 107 — CDD records establishing what screening was required of a customer and on what basis.',
   'soft_delete'),
  ('case_screening_perimeter', 7::numeric,
   'AML/CTF Act 2006 (Cth) s 107 — the record establishing whether a designated service was provided at all.',
   'soft_delete')
) AS v(entity_type, retention_years, legal_basis, disposal_method)
WHERE NOT EXISTS (
  SELECT 1 FROM aml.retention_schedules r WHERE r.entity_type = v.entity_type
);

/* ── 4. Who asked for a voluntary run ─────────────────────────────────── */
-- A scope that is not required may still be screened, and the record has to
-- say that a person chose to — otherwise a check sitting against an exempt
-- case is indistinguishable from one the policy demanded, which is exactly
-- the confusion this whole change exists to remove.
--
-- These also let the scope reconciler tell an in-flight VOLUNTARY run from a
-- stale queued request left over from before the exemption. Without that it
-- would stand the subject down mid-run and cancel work an operator had just
-- authorised.
ALTER TABLE aml.party_screening_subjects
  ADD COLUMN IF NOT EXISTS voluntary_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS voluntary_run_by uuid,
  ADD COLUMN IF NOT EXISTS voluntary_run_by_label text;

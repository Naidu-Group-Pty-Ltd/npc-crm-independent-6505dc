-- ═══════════════════════════════════════════════════════════════════════
-- A public index of domestic office holders, for PEP determinations
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT THIS IS
-- An index the platform holds itself, built from PUBLIC sources, so that
-- determining political exposure does not mean an operator reading five
-- websites and hoping they spelled the name the same way in each.
--
-- WHAT IT IS EMPHATICALLY NOT
-- A register that can clear anybody. It is partial by construction — no
-- public source lists every prominent public function, and none lists
-- family members or close associates at all. So:
--
--   a HIT is a CANDIDATE, to be confirmed against the official register;
--   a MISS is NOTHING. It is not a clearance, it is not evidence, and it
--   must never be recorded as either.
--
-- This platform has already had the other failure once: `sanctions_entries`
-- was empty from the day it was built, and every screening against it would
-- have cleared everybody. The lesson is written into the read path here —
-- `search_pep_officeholders` returns the index's own coverage and currency
-- alongside every result, precisely so a caller cannot render "0 candidates"
-- without also rendering what was and was not looked at.
--
-- NORMALISATION IS SERVER-SIDE, ALWAYS. `normalised_names` is written by the
-- SAME function the query uses (`normaliseName` in
-- `_shared/aml/sanctionsIngest.pure.ts`, mirrored in
-- `scripts/aml/sanctionsParsers.mjs` and held by `dfatParserParity.test.ts`).
-- A loader that normalised differently would write rows no query can ever
-- match, which looks exactly like an index that works.

-- ── load runs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aml.pep_officeholder_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_code text NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  -- What the source itself says it is current to, which is a different
  -- question from when we synced it. `assessListRecency` learned this the
  -- expensive way on the sanctions lists: a four-year-old file uploaded
  -- today passes every control that measures our own activity.
  source_as_at date,
  entry_count integer NOT NULL DEFAULT 0,
  removed_count integer NOT NULL DEFAULT 0,
  payload_sha256 text,
  error_message text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── the index itself ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aml.pep_officeholders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_code text NOT NULL,
  external_id text NOT NULL,
  full_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  normalised_names text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- The office, in the source's own words. Never re-worded here: an
  -- operator confirming a candidate needs the term the register uses.
  position_title text NOT NULL,
  -- AUSTRAC's three categories. `domestic` for everything this index holds
  -- today; the column exists because the vocabulary is the determination's,
  -- not the loader's, and a foreign source would land in the same table.
  pep_type text NOT NULL DEFAULT 'domestic'
    CHECK (pep_type IN ('foreign', 'domestic', 'international_organisation')),
  jurisdiction text,
  -- Current or former. A former office holder is assessed on risk, never
  -- written off by the passage of time, so both are indexed and the dates
  -- are carried rather than used to filter.
  position_start date,
  position_end date,
  currently_held boolean,
  -- Where an operator goes to CONFIRM. Every row must be able to say this:
  -- the index is a lead, and the official register is the source.
  confirm_url text,
  source_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_id uuid REFERENCES aml.pep_officeholder_syncs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_code, external_id)
);

GRANT ALL ON aml.pep_officeholder_syncs TO service_role;
GRANT ALL ON aml.pep_officeholders TO service_role;
ALTER TABLE aml.pep_officeholder_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.pep_officeholders ENABLE ROW LEVEL SECURITY;

-- Service role only, exactly like the sanctions tables. Every read goes
-- through an edge function, which is where the coverage statement is
-- attached — a direct client grant would let a caller obtain a bare "0
-- rows" with nothing beside it, which is the reading this whole table is
-- built to prevent.
DO $$ BEGIN
  CREATE POLICY "aml_pep_officeholder_syncs_service_only"
    ON aml.pep_officeholder_syncs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "aml_pep_officeholders_service_only" ON aml.pep_officeholders
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_aml_pep_officeholders_source
  ON aml.pep_officeholders(source_code);
-- GIN over the normalised token array, the same shape the sanctions
-- screening uses, so a name search is one index scan.
CREATE INDEX IF NOT EXISTS idx_aml_pep_officeholders_names
  ON aml.pep_officeholders USING GIN (normalised_names);
CREATE INDEX IF NOT EXISTS idx_aml_pep_officeholder_syncs_recent
  ON aml.pep_officeholder_syncs(source_code, started_at DESC);

-- A row with no searchable tokens can never be found, so it is not an
-- index entry — it is a silent hole in coverage. Refused at the column.
DO $$ BEGIN
  ALTER TABLE aml.pep_officeholders
    ADD CONSTRAINT pep_officeholders_searchable
    CHECK (cardinality(normalised_names) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE aml.pep_officeholders IS
  'Public-source index of office holders. A hit is a CANDIDATE to confirm '
  'against the official register; an absence is not a clearance and must '
  'never be recorded as evidence that somebody is not a PEP.';

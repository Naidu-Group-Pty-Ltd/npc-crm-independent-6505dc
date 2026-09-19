-- Zero-cost verification stack: local sanctions lists, biometric storage and
-- access auditing (docs/aml/kyc-zero-cost-solution.md).
--
-- Design notes:
--   * Screening runs against lists WE hold, downloaded from the official
--     primary sources (DFAT / UN / OFAC). OpenSanctions is deliberately not
--     used: its aggregated data is CC-BY-NC and we are a commercial user.
--   * Biometrics live in their own private bucket, not aml-documents, so the
--     access policy can be tighter than for ordinary evidence.
--   * Every biometric read is logged. Retaining sensitive information under
--     APP 11 means being able to say who looked at it and why.
--
-- Additive only.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS aml.biometric_access_log;
--   DROP TABLE IF EXISTS aml.sanctions_entries;
--   DROP TABLE IF EXISTS aml.sanctions_list_syncs;
--   ALTER TABLE aml.verification_checks DROP COLUMN IF EXISTS identity_check_id;
--   ALTER TABLE aml.verification_checks DROP COLUMN IF EXISTS document_reference;
--   DELETE FROM storage.buckets WHERE id = 'aml-biometrics';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Sanctions / PEP reference data, from official primary sources
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS aml.sanctions_list_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_code text NOT NULL,              -- 'dfat' | 'un' | 'ofac'
  source_url text NOT NULL,
  -- Hash of the downloaded payload. An unchanged hash means the publisher has
  -- not moved; it is also the evidence that we screened against a known file.
  payload_sha256 text,
  entry_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed')),
  error_detail text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aml.sanctions_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_code text NOT NULL,
  -- The publisher's own reference, so a match can be traced back to the
  -- gazetted listing rather than to a row in our database.
  external_id text NOT NULL,
  entry_type text NOT NULL DEFAULT 'individual'
    CHECK (entry_type IN ('individual', 'entity', 'vessel', 'aircraft', 'unknown')),
  primary_name text NOT NULL,
  -- Aliases matter more than the primary name for screening quality.
  aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- Pre-computed normalised forms. Normalising at write time keeps the
  -- screening query cheap and, more importantly, keeps normalisation
  -- identical between indexing and querying.
  normalised_names text[] NOT NULL DEFAULT ARRAY[]::text[],
  date_of_birth text,
  place_of_birth text,
  nationalities text[] NOT NULL DEFAULT ARRAY[]::text[],
  listing_reference text,
  listing_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_id uuid REFERENCES aml.sanctions_list_syncs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_code, external_id)
);

GRANT ALL ON aml.sanctions_list_syncs TO service_role;
GRANT ALL ON aml.sanctions_entries TO service_role;
ALTER TABLE aml.sanctions_list_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.sanctions_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "aml_sanctions_syncs_service_only" ON aml.sanctions_list_syncs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "aml_sanctions_entries_service_only" ON aml.sanctions_entries
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_aml_sanctions_entries_list
  ON aml.sanctions_entries(list_code);
-- GIN over the normalised alias array is what makes candidate selection fast
-- enough to screen every party on every case without a paid service.
CREATE INDEX IF NOT EXISTS idx_aml_sanctions_entries_names
  ON aml.sanctions_entries USING GIN (normalised_names);
CREATE INDEX IF NOT EXISTS idx_aml_sanctions_syncs_recent
  ON aml.sanctions_list_syncs(list_code, started_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Biometric storage + access audit
-- ─────────────────────────────────────────────────────────────────────────

-- Private bucket, separate from aml-documents. 8 MB ceiling: a selfie frame
-- has no business being larger, and a tight limit is itself a control.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('aml-biometrics', 'aml-biometrics', false, 8388608,
        ARRAY['image/jpeg', 'image/png', 'application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

-- No storage policies are created: the bucket is reachable only through the
-- service role inside an edge function, which is where the access log is
-- written. A direct client grant would bypass that log.

CREATE TABLE IF NOT EXISTS aml.biometric_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_check_id uuid NOT NULL REFERENCES aml.verification_checks(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_label text,
  action text NOT NULL CHECK (action IN ('view', 'download', 'compare', 'dispose')),
  -- Free text, minimum length enforced by the edge function. "Because I could"
  -- is not a reason; the field exists so that the log answers "why".
  reason text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON aml.biometric_access_log TO service_role;
ALTER TABLE aml.biometric_access_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "aml_biometric_access_log_service_only" ON aml.biometric_access_log
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_aml_biometric_access_check
  ON aml.biometric_access_log(verification_check_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_biometric_access_case
  ON aml.biometric_access_log(case_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Link verification attempts to the provider-call record and the document
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE aml.verification_checks
  ADD COLUMN IF NOT EXISTS identity_check_id uuid;
ALTER TABLE aml.verification_checks
  ADD COLUMN IF NOT EXISTS document_reference text;

-- Retention: biometrics are disposed on the same trigger-based clock as every
-- other record (§18) — measured from the end of the business relationship,
-- never from upload date.
INSERT INTO aml.retention_schedules (entity_type, retention_years, legal_basis, disposal_method, notes)
SELECT 'biometric', 7,
       'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) — record-keeping; '
       || 'Privacy Act 1988 (Cth), Australian Privacy Principle 11 — destruction of personal information',
       'hard_delete',
       'Facial images and derived templates captured for customer identification. Retained for '
       || 'seven years from the end of the business relationship (trigger-based, never from upload '
       || 'date), then destroyed. Hard delete: a biometric is not a record we soft-delete.'
WHERE NOT EXISTS (
  SELECT 1 FROM aml.retention_schedules WHERE entity_type = 'biometric'
);

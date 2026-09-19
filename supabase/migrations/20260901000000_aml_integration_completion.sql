-- Integration completion (PR #1939): submission review, document lineage,
-- controlled P3 IDV evidence, party reconciliation + provenance, party-scoped
-- screening, and retention registrations for every new record type.
--
-- Additive only. Column sets for aml.documents, aml.submission_versions,
-- aml.screening_checks, aml.beneficial_owners, aml.authorised_representatives
-- and aml.retention_schedules were read from production
-- (dduzbchuswwbefdunfct) before writing: nothing below already exists there.
--
-- ROLLBACK (exact):
--   ALTER TABLE aml.documents DROP COLUMN IF EXISTS client_safe_rejection_reason,
--     DROP COLUMN IF EXISTS internal_review_note, DROP COLUMN IF EXISTS version_number,
--     DROP COLUMN IF EXISTS previous_document_id, DROP COLUMN IF EXISTS replacement_document_id,
--     DROP COLUMN IF EXISTS replaced_at, DROP COLUMN IF EXISTS replaced_by,
--     DROP COLUMN IF EXISTS replacement_reason;
--   ALTER TABLE aml.submission_versions DROP COLUMN IF EXISTS review_status,
--     DROP COLUMN IF EXISTS review_decided_by, DROP COLUMN IF EXISTS review_decided_at,
--     DROP COLUMN IF EXISTS review_reason, DROP COLUMN IF EXISTS superseded_at,
--     DROP COLUMN IF EXISTS superseded_reason;
--   ALTER TABLE aml.beneficial_owners DROP COLUMN IF EXISTS verification_check_id;
--   ALTER TABLE aml.authorised_representatives DROP COLUMN IF EXISTS verification_check_id;
--   DROP TABLE IF EXISTS aml.party_screening_subjects;
--   DROP TABLE IF EXISTS aml.party_field_provenance;
--   DROP TABLE IF EXISTS aml.party_reconciliation_items;
--   DROP TABLE IF EXISTS aml.idv_evidence_references;
--   DELETE FROM aml.retention_schedules WHERE entity_type IN
--     ('verification_check','idv_evidence_reference','biometric_capture',
--      'submission_review_decision','document_version','document_review_decision',
--      'client_request_notification','party_reconciliation_item',
--      'party_field_provenance','party_screening_subject','party_verification_link');

/* ── Stage 9/10: document review reasons and version lineage ─────────────── */
-- Two reasons, deliberately separate columns: the client-safe one is the only
-- text the portal may ever read; internal reviewer reasoning (suspicion, risk,
-- MLRO thinking) stays staff-side and is never projected.
ALTER TABLE aml.documents
  ADD COLUMN IF NOT EXISTS client_safe_rejection_reason text,
  ADD COLUMN IF NOT EXISTS internal_review_note text,
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS previous_document_id uuid REFERENCES aml.documents(id),
  ADD COLUMN IF NOT EXISTS replacement_document_id uuid REFERENCES aml.documents(id),
  ADD COLUMN IF NOT EXISTS replaced_at timestamptz,
  ADD COLUMN IF NOT EXISTS replaced_by uuid,
  ADD COLUMN IF NOT EXISTS replacement_reason text;
CREATE INDEX IF NOT EXISTS idx_aml_documents_lineage
  ON aml.documents(previous_document_id) WHERE previous_document_id IS NOT NULL;

/* ── Stage 3: submission review state ───────────────────────────────────── */
-- The snapshot itself stays immutable; review state lives alongside it.
ALTER TABLE aml.submission_versions
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'submitted'
    CHECK (review_status IN ('submitted','under_review','changes_requested',
                             'accepted','escalated','superseded')),
  ADD COLUMN IF NOT EXISTS review_decided_by uuid,
  ADD COLUMN IF NOT EXISTS review_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_reason text;
CREATE INDEX IF NOT EXISTS idx_aml_submission_review_status
  ON aml.submission_versions(case_id, review_status);

/* ── Stage 11: controlled P3 IDV evidence references ────────────────────── */
-- The identity document used by canonical electronic IDV becomes a governed
-- evidence record. The storage object is NOT duplicated: bucket + object are
-- recorded server-side and only ever resolved into a short-lived signed URL
-- by an authorised staff operation.
CREATE TABLE IF NOT EXISTS aml.idv_evidence_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  case_id uuid NOT NULL,
  party_type text NOT NULL DEFAULT 'case_subject',
  party_id uuid,
  verification_check_id uuid NOT NULL REFERENCES aml.verification_checks(id),
  evidence_type text NOT NULL DEFAULT 'identity_document_copy'
    CHECK (evidence_type IN ('identity_document_copy','biometric_capture')),
  storage_bucket text NOT NULL,
  storage_object text NOT NULL,
  content_hash text,
  mime_type text,
  original_filename text,
  -- P3 for the identity copy, P6 for a raw biometric: the classification
  -- travels with the record so retention and export guards can read it.
  information_classification text NOT NULL
    CHECK (information_classification IN ('P3','P6')),
  evidence_version integer NOT NULL DEFAULT 1,
  retention_entity_type text NOT NULL,
  disposal_trigger text NOT NULL DEFAULT 'raw_id_copy_necessity_end',
  legal_hold boolean NOT NULL DEFAULT false,
  disposal_status text NOT NULL DEFAULT 'retained'
    CHECK (disposal_status IN ('retained','disposal_due','disposed','blocked_by_hold')),
  disposed_at timestamptz,
  disposal_evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  UNIQUE (verification_check_id, evidence_type, evidence_version)
);
CREATE INDEX IF NOT EXISTS idx_aml_idv_evidence_case ON aml.idv_evidence_references(case_id);
CREATE INDEX IF NOT EXISTS idx_aml_idv_evidence_disposal
  ON aml.idv_evidence_references(disposal_status) WHERE disposed_at IS NULL;
ALTER TABLE aml.idv_evidence_references ENABLE ROW LEVEL SECURITY;

/* ── Stage 13: party reconciliation work + field provenance ─────────────── */
-- Declared parties never become canonical records automatically. Each
-- declaration becomes a work item an authorised human resolves; similarity is
-- a suggestion only and is stored as such.
CREATE TABLE IF NOT EXISTS aml.party_reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  case_id uuid NOT NULL,
  submission_id uuid,
  declared_role text NOT NULL,
  declared_name text NOT NULL,
  declared_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  declaration_hash text NOT NULL,
  change_kind text NOT NULL DEFAULT 'new'
    CHECK (change_kind IN ('new','changed','removed','role_changed','unchanged')),
  exact_candidate_type text,
  exact_candidate_id uuid,
  similarity_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_manual boolean NOT NULL DEFAULT false,
  resolution_status text NOT NULL DEFAULT 'open'
    CHECK (resolution_status IN ('open','linked','created','manual_only','rejected','superseded','conflict')),
  resolved_party_type text,
  resolved_party_id uuid,
  resolution_rationale text,
  resolved_by uuid,
  resolved_at timestamptz,
  verification_required boolean NOT NULL DEFAULT true,
  screening_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, declaration_hash)
);
CREATE INDEX IF NOT EXISTS idx_aml_recon_open
  ON aml.party_reconciliation_items(case_id, resolution_status);
ALTER TABLE aml.party_reconciliation_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS aml.party_field_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  case_id uuid NOT NULL,
  reconciliation_item_id uuid REFERENCES aml.party_reconciliation_items(id),
  party_type text,
  party_id uuid,
  source_submission_id uuid,
  source_section text,
  source_field text NOT NULL,
  submitted_value text,
  canonical_value text,
  resolution_status text NOT NULL DEFAULT 'declared',
  actor_id uuid,
  actor_label text,
  rationale text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_provenance_case ON aml.party_field_provenance(case_id);
ALTER TABLE aml.party_field_provenance ENABLE ROW LEVEL SECURITY;

/* ── Stage 16: party-scoped screening work ─────────────────────────────── */
CREATE TABLE IF NOT EXISTS aml.party_screening_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  case_id uuid NOT NULL,
  party_type text NOT NULL,
  party_id uuid,
  reconciliation_item_id uuid REFERENCES aml.party_reconciliation_items(id),
  screened_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  date_of_birth date,
  country text,
  required boolean NOT NULL DEFAULT true,
  state text NOT NULL DEFAULT 'not_started'
    CHECK (state IN ('not_required','not_started','queued','processing','completed',
                     'possible_match','confirmed_match','false_positive','error')),
  screening_check_id uuid REFERENCES aml.screening_checks(id),
  provider_key text,
  list_version text,
  last_screened_at timestamptz,
  refresh_due_at timestamptz,
  adjudicated_by uuid,
  adjudicated_at timestamptz,
  adjudication_note text,
  error_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_party_screening_case
  ON aml.party_screening_subjects(case_id, state);
CREATE INDEX IF NOT EXISTS idx_aml_party_screening_refresh
  ON aml.party_screening_subjects(refresh_due_at) WHERE refresh_due_at IS NOT NULL;
ALTER TABLE aml.party_screening_subjects ENABLE ROW LEVEL SECURITY;

/* ── Stage 15: canonical verification link on canonical party rows ──────── */
-- The legacy identity_check_id columns stay for history; verification STATE is
-- derived from these canonical links, never set directly by a client.
ALTER TABLE aml.beneficial_owners
  ADD COLUMN IF NOT EXISTS verification_check_id uuid REFERENCES aml.verification_checks(id);
ALTER TABLE aml.authorised_representatives
  ADD COLUMN IF NOT EXISTS verification_check_id uuid REFERENCES aml.verification_checks(id);

/* ── Stage 20: retention registrations for every new record type ────────── */
-- s 107 seven-year default unless the class is necessity-based. Raw biometric
-- and raw ID copies carry years = 0 because their clock is necessity, not a
-- period (the engine reads the disposal trigger).
INSERT INTO aml.retention_schedules (entity_type, retention_years, legal_basis, disposal_method, notes, active)
VALUES
  ('verification_check',            7, 'AML/CTF Act s 107', 'soft_delete',   'Canonical identity-verification record (P3 evidence metadata).', true),
  ('idv_evidence_reference',        0, 'Privacy Act APP 11.2 / AML/CTF s 107', 'hard_delete', 'Raw identity-document copy: dispose when no longer reasonably necessary; the reference row survives as disposal evidence.', true),
  ('biometric_capture',            0, 'Privacy Act APP 11.2 (sensitive information)', 'hard_delete', 'Raw biometric (P6): minimised explicit schedule, object destroyed before pointer.', true),
  ('submission_review_decision',    7, 'AML/CTF Act s 107', 'recorded_only', 'Reviewer decision on a client submission (P4).', true),
  ('document_version',              7, 'AML/CTF Act s 107', 'soft_delete',   'Document version lineage including superseded copies.', true),
  ('document_review_decision',      7, 'AML/CTF Act s 107', 'recorded_only', 'Accept/reject decision with internal reasoning (P4).', true),
  ('client_request_notification',   2, 'Operational record',                  'hard_delete', 'Transient client-safe notification copy (P1).', true),
  ('party_reconciliation_item',     7, 'AML/CTF Act s 107', 'recorded_only', 'Declared-party reconciliation work and outcome (P4).', true),
  ('party_field_provenance',        7, 'AML/CTF Act s 107', 'recorded_only', 'Field-level provenance for imported party data.', true),
  ('party_screening_subject',       7, 'AML/CTF Act s 107', 'recorded_only', 'Party-scoped screening work and adjudication (P4).', true),
  ('party_verification_link',       7, 'AML/CTF Act s 107', 'recorded_only', 'Party ↔ verification evidence relationship.', true)
ON CONFLICT DO NOTHING;

/* ── Verification: the migration must converge ──────────────────────────── */
DO $$
BEGIN
  IF (SELECT count(*) FROM aml.retention_schedules
      WHERE entity_type IN ('verification_check','idv_evidence_reference','biometric_capture',
        'submission_review_decision','document_version','document_review_decision',
        'client_request_notification','party_reconciliation_item','party_field_provenance',
        'party_screening_subject','party_verification_link')) < 11 THEN
    RAISE EXCEPTION 'retention registration did not converge for the new record types';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='aml' AND table_name='documents' AND column_name='client_safe_rejection_reason') THEN
    RAISE EXCEPTION 'document review columns did not apply';
  END IF;
END $$;

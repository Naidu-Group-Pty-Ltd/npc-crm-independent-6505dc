-- Record-classification correction + controlled evidence-access structures
-- (pre-rollout remediation, Stage A/B).
--
-- ── WHAT WAS WRONG (verified against the controlled records framework) ────
--
-- The Phase 7 catalogue (20260805150000) misclassified two record classes:
--
--   raw_id_document_copy   seeded P5 (prohibited). The framework places
--                          retained identity-document copies in P3 —
--                          RESTRICTED CDD EVIDENCE, deliverable to a partner
--                          only through the controlled, approved, expiring
--                          evidence-delivery path. P5 is reserved for
--                          suspicious-matter/reporting/tipping-off material
--                          and credentials.
--   legal_hold_record      seeded P5. The framework places legal holds in
--                          P4 — REVIEWER/MLRO RESTRICTED (with risk
--                          reasoning, match adjudication, EDD, reviewer
--                          notes and overrides). Holds stay invisible to
--                          clients and partners either way; P4 is the
--                          correct internal class.
--
-- What was RIGHT and is preserved unchanged: biometric_raw_capture is P6;
-- necessity-based triggers on both raw classes; hard-delete disposal;
-- object-before-pointer destruction; legal holds blocking disposal; the
-- structural rule that P4/P5/P6 can never be partner-exportable.
--
-- This migration also seeds the one genuinely-P5 class the catalogue was
-- missing (suspicious-matter / reporting material), so the P5 boundary is
-- machine-checkable, and adds the two structures Stage B's controlled
-- evidence access needs:
--
--   * partner_evidence_deliveries.evidence_document_id — an OPAQUE
--     server-side reference to the existing aml.documents evidence row that
--     backs a delivery. Nullable (historical deliveries stay metadata-only);
--     never a path; the bucket and storage_path never leave the server.
--   * reliance_access_log widening: grant_id becomes nullable (workspace
--     evidence access can exist without a bearer grant) and the action
--     CHECK gains 'evidence_access' (superset swap — every historical value
--     stays valid).
--
-- The corrective UPDATEs FAIL CLOSED: if the expected catalogue rows are
-- absent or no longer carry the classifications Phase 7 seeded, the
-- migration raises instead of guessing.
--
-- Additive / widening only. No ID, hash, trigger, date or history changes.
--
-- ROLLBACK:
--   ALTER TABLE aml.partner_evidence_deliveries DROP COLUMN IF EXISTS evidence_document_id;
--   -- Restore the narrower access-log shape ONLY after confirming no
--   -- evidence_access rows / NULL-grant rows exist:
--   --   DELETE FROM aml.reliance_access_log WHERE action = 'evidence_access';
--   --   ALTER TABLE aml.reliance_access_log ALTER COLUMN grant_id SET NOT NULL;
--   --   ALTER TABLE aml.reliance_access_log DROP CONSTRAINT reliance_access_log_action_check;
--   --   ALTER TABLE aml.reliance_access_log ADD CONSTRAINT reliance_access_log_action_check
--   --     CHECK (action IN ('redeem','view_attestation','independent_assessment','records_request'));
--   DELETE FROM aml.record_class_catalogue WHERE record_code = 'suspicious_matter_material';
--   UPDATE aml.record_class_catalogue SET information_classification = 'P5',
--     default_visibility = 'prohibited', partner_exportable = false
--     WHERE record_code = 'raw_id_document_copy';
--   UPDATE aml.record_class_catalogue SET information_classification = 'P5'
--     WHERE record_code = 'legal_hold_record';

-- ── 1. Fail-closed guard: the rows this migration corrects must exist ────

DO $$
DECLARE raw_row aml.record_class_catalogue%ROWTYPE; hold_row aml.record_class_catalogue%ROWTYPE;
BEGIN
  SELECT * INTO raw_row FROM aml.record_class_catalogue WHERE record_code = 'raw_id_document_copy';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'classification correction expects raw_id_document_copy in aml.record_class_catalogue (Phase 7 migration 20260805150000 must run first)';
  END IF;
  SELECT * INTO hold_row FROM aml.record_class_catalogue WHERE record_code = 'legal_hold_record';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'classification correction expects legal_hold_record in aml.record_class_catalogue';
  END IF;
  IF raw_row.information_classification NOT IN ('P5', 'P3') THEN
    RAISE EXCEPTION 'raw_id_document_copy carries unexpected classification % — refusing to guess', raw_row.information_classification;
  END IF;
  IF hold_row.information_classification NOT IN ('P5', 'P4') THEN
    RAISE EXCEPTION 'legal_hold_record carries unexpected classification % — refusing to guess', hold_row.information_classification;
  END IF;
END $$;

-- ── 2. The corrections ────────────────────────────────────────────────────
-- Retained ID-document copies are restricted CDD evidence (P3): default
-- visibility stays origin-staff, and partner delivery is possible ONLY
-- through the controlled evidence path (origin review, exact-code approval,
-- expiring, audited). Trigger (raw_id_copy_necessity_end), zone, disposal
-- (hard_delete) and schedule (necessity-based, years=0) are unchanged —
-- structured verification outcomes remain a SEPARATE class on the CDD clock.

UPDATE aml.record_class_catalogue SET
  information_classification = 'P3',
  default_visibility = 'origin_staff',
  partner_exportable = true,
  notes = 'Restricted CDD evidence (P3): a retained full identity-document image. Not currently stored by the platform (structured sighting attributes only). Deliverable to a partner ONLY through the controlled, approved, expiring evidence-delivery path — never through the ordinary passport payload. Necessity-end clock; hard delete; never inherits the structured-CDD retention period.'
WHERE record_code = 'raw_id_document_copy';

-- Legal holds are reviewer/MLRO-restricted (P4). Everything else about them
-- is unchanged: never client- or partner-visible, never exportable (the
-- P4/P5/P6 CHECK still forbids it structurally), and an active hold still
-- blocks disposal (activeHoldFor runs at dry run AND execution).

UPDATE aml.record_class_catalogue SET
  information_classification = 'P4',
  notes = 'Reviewer/MLRO restricted (P4). Hold reasons may name investigations; never client- or partner-visible. An active hold blocks disposal at dry run and re-checked at execution.'
WHERE record_code = 'legal_hold_record';

-- The genuinely-P5 class the catalogue lacked: suspicious-matter /
-- regulatory-reporting material (fact, status and content of reporting,
-- tipping-off-sensitive information). Catalogued so the P5 boundary is a
-- row the guards and tests can point at, not a convention.

INSERT INTO aml.record_class_catalogue
  (record_code, family, label, information_classification, default_visibility,
   storage_zone, access_logging_required, retention_trigger_kind, disposal_rule,
   partner_exportable, notes) VALUES
  ('suspicious_matter_material', 'RPT', 'Suspicious-matter and regulatory-reporting material', 'P5', 'prohibited',
   'restricted_reporting_vault', true, 'report_complete', 'recorded_only',
   false, 'Prohibited/highly restricted (P5): the fact, status and content of suspicious-matter and AUSTRAC reporting, and tipping-off-sensitive information. Never enters any partner or client surface, export, event payload or notification (s 123).')
ON CONFLICT (record_code) DO NOTHING;

-- Post-correction assertion: the corrected state must hold exactly.
DO $$
BEGIN
  IF (SELECT information_classification FROM aml.record_class_catalogue WHERE record_code = 'raw_id_document_copy') <> 'P3'
     OR (SELECT information_classification FROM aml.record_class_catalogue WHERE record_code = 'legal_hold_record') <> 'P4'
     OR (SELECT information_classification FROM aml.record_class_catalogue WHERE record_code = 'biometric_raw_capture') <> 'P6'
     OR NOT EXISTS (SELECT 1 FROM aml.record_class_catalogue
                    WHERE record_code = 'suspicious_matter_material' AND information_classification = 'P5') THEN
    RAISE EXCEPTION 'classification correction did not converge — catalogue inconsistent';
  END IF;
END $$;

-- ── 3. Evidence-access structures (Stage B) ───────────────────────────────
-- The delivery row gains an OPAQUE reference to the existing evidence
-- object (aml.documents — private aml-documents bucket, service-role RLS).
-- Deliberately an id, never a path: storage resolution happens server-side
-- inside the authorised operation only, and the Phase 4 rule stands — no
-- partner-domain table carries an object location.

ALTER TABLE aml.partner_evidence_deliveries
  ADD COLUMN IF NOT EXISTS evidence_document_id uuid REFERENCES aml.documents(id);

-- Access-log widening (superset swap): workspace evidence access is logged
-- like every other partner access, with or without a bearer grant.

ALTER TABLE aml.reliance_access_log
  ALTER COLUMN grant_id DROP NOT NULL;
ALTER TABLE aml.reliance_access_log
  DROP CONSTRAINT IF EXISTS reliance_access_log_action_check;
ALTER TABLE aml.reliance_access_log
  ADD CONSTRAINT reliance_access_log_action_check CHECK (action IN
    ('redeem', 'view_attestation', 'independent_assessment', 'records_request',
     'evidence_access'));
CREATE INDEX IF NOT EXISTS idx_aml_reliance_access_case_action
  ON aml.reliance_access_log (case_id, action, created_at DESC);

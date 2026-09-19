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

UPDATE aml.record_class_catalogue SET
  information_classification = 'P3',
  default_visibility = 'origin_staff',
  partner_exportable = true,
  notes = 'Restricted CDD evidence (P3): a retained full identity-document image. Not currently stored by the platform (structured sighting attributes only). Deliverable to a partner ONLY through the controlled, approved, expiring evidence-delivery path — never through the ordinary passport payload. Necessity-end clock; hard delete; never inherits the structured-CDD retention period.'
WHERE record_code = 'raw_id_document_copy';

UPDATE aml.record_class_catalogue SET
  information_classification = 'P4',
  notes = 'Reviewer/MLRO restricted (P4). Hold reasons may name investigations; never client- or partner-visible. An active hold blocks disposal at dry run and re-checked at execution.'
WHERE record_code = 'legal_hold_record';

INSERT INTO aml.record_class_catalogue
  (record_code, family, label, information_classification, default_visibility,
   storage_zone, access_logging_required, retention_trigger_kind, disposal_rule,
   partner_exportable, notes) VALUES
  ('suspicious_matter_material', 'RPT', 'Suspicious-matter and regulatory-reporting material', 'P5', 'prohibited',
   'restricted_reporting_vault', true, 'report_complete', 'recorded_only',
   false, 'Prohibited/highly restricted (P5): the fact, status and content of suspicious-matter and AUSTRAC reporting, and tipping-off-sensitive information. Never enters any partner or client surface, export, event payload or notification (s 123).')
ON CONFLICT (record_code) DO NOTHING;

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

ALTER TABLE aml.partner_evidence_deliveries
  ADD COLUMN IF NOT EXISTS evidence_document_id uuid REFERENCES aml.documents(id);

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
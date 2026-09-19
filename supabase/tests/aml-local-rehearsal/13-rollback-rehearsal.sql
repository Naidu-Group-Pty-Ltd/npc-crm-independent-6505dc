\set ON_ERROR_STOP on
-- Rehearse the CORRECTION migration rollback exactly as its header states.
ALTER TABLE aml.partner_evidence_deliveries DROP COLUMN IF EXISTS evidence_document_id;
DELETE FROM aml.reliance_access_log WHERE action = 'evidence_access';
ALTER TABLE aml.reliance_access_log ALTER COLUMN grant_id SET NOT NULL;
ALTER TABLE aml.reliance_access_log DROP CONSTRAINT reliance_access_log_action_check;
ALTER TABLE aml.reliance_access_log ADD CONSTRAINT reliance_access_log_action_check
  CHECK (action IN ('redeem','view_attestation','independent_assessment','records_request'));
DELETE FROM aml.record_class_catalogue WHERE record_code = 'suspicious_matter_material';
UPDATE aml.record_class_catalogue SET information_classification = 'P5',
  default_visibility = 'prohibited', partner_exportable = false
  WHERE record_code = 'raw_id_document_copy';
UPDATE aml.record_class_catalogue SET information_classification = 'P5'
  WHERE record_code = 'legal_hold_record';
-- Rehearse the ACTION-FLAG migration rollback.
DELETE FROM public.feature_flags WHERE key IN
  ('aml_partner_grants_write','aml_partner_records_requests_write',
   'aml_partner_evidence_delivery_write','aml_partner_determinations_write',
   'aml_partner_service_blocking');
-- Verify: catalogue back to Phase 7 seed state; earlier-phase objects intact.
SELECT 'rollback: raw ID back to P5: ' || (information_classification='P5')::text AS r FROM aml.record_class_catalogue WHERE record_code='raw_id_document_copy';
SELECT 'rollback: hold back to P5: ' || (information_classification='P5')::text AS r FROM aml.record_class_catalogue WHERE record_code='legal_hold_record';
SELECT 'rollback: SMR row gone: ' || (count(*)=0)::text AS r FROM aml.record_class_catalogue WHERE record_code='suspicious_matter_material';
SELECT 'rollback: action flags gone: ' || (count(*)=0)::text AS r FROM public.feature_flags WHERE key LIKE 'aml_partner_%_write';
SELECT 'phase objects intact: obligations survive: ' || (count(*)>=1)::text AS r FROM aml.partner_refresh_obligations;
SELECT 'phase objects intact: outbox events survive: ' || (count(*)>=3)::text AS r FROM public.integration_outbox WHERE event_type LIKE 'aml.%';
SELECT 'phase objects intact: deliveries survive: ' || (count(*)>=1)::text AS r FROM aml.partner_evidence_deliveries;

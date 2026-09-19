\set ON_ERROR_STOP on
-- Synthetic material-change, obligations, claim/replay and evidence-log battery.
INSERT INTO aml.consents (id, case_id, kind, version, actor_type, actor_label)
VALUES ('f0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','compliance_sharing','2026.2','client','Synthetic Person One')
ON CONFLICT DO NOTHING;
INSERT INTO aml.compliance_attestations (id, case_id, version, payload, payload_sha256, issued_by, schema_version, material_input_hash)
VALUES ('90000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',1,
  '{"schema":"aml.compliance_attestation.v2","subject":"Synthetic Person One"}','sha-synthetic-1',
  'a0000000-0000-4000-8000-00000000000e',2,'material-hash-old')
ON CONFLICT DO NOTHING;
INSERT INTO aml.reliance_agreements (id, partner_org_name, partner_org_type, agreement_reference, executed_on, next_review_due, created_by, partner_org_id)
VALUES ('91000000-0000-4000-8000-000000000001','Synthetic Finance Partner Pty Ltd','finance','SYN-AGR-1','2026-01-01','2027-01-01','a0000000-0000-4000-8000-00000000000e','b0000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO aml.reliance_grants (id, case_id, agreement_id, attestation_id, consent_id, access_token_hash, granted_by, expires_at, partner_org_id, partner_case_link_id)
VALUES ('92000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','synthetic-token-hash-000000000000000001','a0000000-0000-4000-8000-00000000000e', now() + interval '30 days','b0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

-- Material change applies once, atomically, and is idempotent on re-run.
SELECT aml.apply_partner_material_change(
  'a0000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',
  'material-hash-new', ARRAY['subject_identity'], 'information_updated', 'refresh',
  'a0000000-0000-4000-8000-00000000000e', 14, NULL) AS first_run;
SELECT aml.apply_partner_material_change(
  'a0000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',
  'material-hash-new', ARRAY['subject_identity'], 'information_updated', 'refresh',
  'a0000000-0000-4000-8000-00000000000e', 14, NULL) AS second_run;
SELECT 'attestation flagged once: ' || (refresh_required_at IS NOT NULL)::text AS result
  FROM aml.compliance_attestations WHERE id='90000000-0000-4000-8000-000000000001';
SELECT 'grant refresh flagged: ' || (refresh_required_at IS NOT NULL)::text AS result
  FROM aml.reliance_grants WHERE id='92000000-0000-4000-8000-000000000001';
SELECT 'exactly one open obligation: ' || (count(*)=1)::text AS result
  FROM aml.partner_refresh_obligations WHERE partner_case_link_id='d0000000-0000-4000-8000-000000000001' AND status='open';
SELECT 'exactly one refresh event: ' || (count(*)=1)::text AS result
  FROM public.integration_outbox WHERE event_type='aml.attestation.refresh_required';

-- Revocation emits once; a duplicate transition cannot re-emit or un-revoke.
UPDATE aml.reliance_grants SET revoked_at=now(), revoked_by='a0000000-0000-4000-8000-00000000000e', revoke_reason='synthetic rollback drill' WHERE id='92000000-0000-4000-8000-000000000001';
UPDATE aml.reliance_grants SET revoke_reason='synthetic rollback drill 2' WHERE id='92000000-0000-4000-8000-000000000001';
SELECT 'revoked event emitted once: ' || (count(*)=1)::text AS result
  FROM public.integration_outbox WHERE event_type='aml.partner_access.revoked';
SELECT 'grant remains revoked: ' || (revoked_at IS NOT NULL)::text AS result
  FROM aml.reliance_grants WHERE id='92000000-0000-4000-8000-000000000001';

-- Worker claim -> dead-letter -> replay roundtrip on the platform machinery.
SELECT 'claim returns rows: ' || (count(*) > 0)::text AS result FROM public.claim_integration_outbox('synthetic-worker', 10);
WITH one AS (SELECT id, aggregate_type, aggregate_id, event_type, payload, attempts FROM public.integration_outbox WHERE event_type LIKE 'aml.%' LIMIT 1),
ins AS (INSERT INTO public.integration_dead_letters (outbox_id, aggregate_type, aggregate_id, event_type, payload, attempts, last_error)
  SELECT id, aggregate_type, aggregate_id, event_type, payload, attempts, 'synthetic terminal failure' FROM one RETURNING id)
SELECT public.replay_integration_dead_letter(id, 'a0000000-0000-4000-8000-00000000000e') IS NOT NULL AS replayed FROM ins;
SELECT 'replayed event reset: ' || (count(*) > 0)::text AS result FROM public.integration_outbox WHERE processed_at IS NULL AND attempts = 0 AND event_type LIKE 'aml.%';

-- Widened access log: evidence_access rows with NULL grant work; URL never present by construction.
INSERT INTO aml.reliance_access_log (grant_id, case_id, action, actor_label, detail)
VALUES (NULL, 'a0000000-0000-4000-8000-000000000001', 'evidence_access', 'Synthetic Finance Partner — synthetic.co@example.test',
  '{"result":"denied","denial_code":"evidence_access_disabled","membership_id":"93000000-0000-4000-8000-000000000001"}');
SELECT 'grant-less evidence_access log row: PASS' AS result;

-- Evidence delivery chain with opaque document reference.
INSERT INTO aml.documents (id, case_id, filename, storage_path, mime_type, status, uploaded_by_type)
VALUES ('94000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','synthetic-authority.pdf','synthetic/case-1/authority.pdf','application/pdf','accepted','staff')
ON CONFLICT DO NOTHING;
INSERT INTO aml.partner_records_requests (id, case_id, partner_case_link_id, partner_org_id, requested_record_codes, rationale, requested_by_source, requested_by_id, status, approved_record_codes, reviewed_by, reviewed_at)
VALUES ('95000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001', ARRAY['authority_evidence'],'Synthetic authority verification for pilot','finance_portal_users','a0000000-0000-4000-8000-00000000000e','approved',ARRAY['authority_evidence'],'a0000000-0000-4000-8000-00000000000e',now())
ON CONFLICT DO NOTHING;
INSERT INTO aml.partner_evidence_deliveries (id, request_id, case_id, partner_case_link_id, partner_org_id, record_code, safe_label, delivered_by, expires_at, evidence_document_id)
VALUES ('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','authority_evidence','Authority to act evidence','a0000000-0000-4000-8000-00000000000e', now() + interval '14 days','94000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
SELECT 'delivery -> opaque document reference resolves: ' || (d.evidence_document_id = doc.id)::text AS result
  FROM aml.partner_evidence_deliveries d JOIN aml.documents doc ON doc.id = d.evidence_document_id
  WHERE d.id='96000000-0000-4000-8000-000000000001';
SELECT 'no path column on deliveries: ' || (count(*)=0)::text AS result
  FROM information_schema.columns WHERE table_schema='aml' AND table_name='partner_evidence_deliveries' AND column_name LIKE '%path%';

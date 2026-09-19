INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_partner_grants_write', 'false'::jsonb,
   'Phase 9 rollout layer 4: allow NEW reliance grants (grant_access). Revocation is never gated. Off = grant issuance answers 409; everything read-only continues.'),
  ('aml_partner_records_requests_write', 'false'::jsonb,
   'Phase 9 rollout layer 4: allow partner records-request submission (request_cdd_records). Off = submission answers 409; existing requests remain reviewable.'),
  ('aml_partner_evidence_delivery_write', 'false'::jsonb,
   'Phase 9 rollout layer 4: allow evidence-delivery recording (staff) and controlled P3 object access (partner). Off = both answer 409; delivery metadata remains visible.'),
  ('aml_partner_determinations_write', 'false'::jsonb,
   'Phase 9 rollout layer 4: allow partner determinations through the workspace (record_partner_determination). Off = recording answers 409.'),
  ('aml_partner_service_blocking', 'false'::jsonb,
   'RESERVED — no code path enforces service or settlement blocking on partner state and none is authorised. Must remain false. Recorded so its state is visible in readiness/preflight.')
ON CONFLICT (key) DO NOTHING;
-- Action-level rollout flags for the partner/reliance domain (Phase 9
-- controlled rollout, Stage E2).
--
-- The controlled documents require a READ-ONLY rollout before any partner
-- write capability is enabled. The existing flags gate surfaces (workspace
-- master + per-portal) and infrastructure (events, retention, reporting)
-- but cannot independently sequence the four write capabilities, so each
-- gains its own flag, enforced SERVER-SIDE in aml-reliance (hidden buttons
-- are not enforcement):
--
--   aml_partner_grants_write             gates grant_access (issuing NEW
--                                        reliance grants). revoke_grant is
--                                        deliberately NOT gated — revocation
--                                        is a safety action and must always
--                                        work.
--   aml_partner_records_requests_write   gates request_cdd_records (partner
--                                        submission). Origin review of an
--                                        already-submitted request stays
--                                        available.
--   aml_partner_evidence_delivery_write  gates record_partner_evidence_
--                                        delivery (staff) AND
--                                        get_partner_evidence_delivery_access
--                                        (partner object retrieval) — the
--                                        whole capability.
--   aml_partner_determinations_write     gates record_partner_determination
--                                        (workspace path).
--   aml_partner_service_blocking         reserved. NO code path enforces
--                                        service or settlement blocking on
--                                        partner state, and none may be
--                                        added under this programme. Seeded
--                                        false and must remain false.
--
-- All default false. Enabling is an operator decision taken one capability
-- at a time per the dependency order in
-- docs/aml/rollout/feature-flag-dependency-order.md.
--
-- ROLLBACK:
--   DELETE FROM public.feature_flags WHERE key IN
--     ('aml_partner_grants_write', 'aml_partner_records_requests_write',
--      'aml_partner_evidence_delivery_write', 'aml_partner_determinations_write',
--      'aml_partner_service_blocking');

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

-- Aurixa AML/CTF Compliance Passport — partner distribution flag (Phase 1).
--
-- Phase 1 adds a server-authoritative readiness engine
-- (`_shared/aml/passport/passportDistribution.pure.ts`) and four operations on
-- `aml-reliance` that evaluate and execute Passport distribution to the
-- Finance, Solicitor/Conveyancer and Builder/Developer portals.
--
-- No schema, no data and no existing behaviour changes here. Distribution
-- reuses the existing reliance architecture end to end — partner
-- organisations, partner-case links, portal memberships, reliance agreements,
-- arrangement assessments, reliance grants, disclosure manifests, the
-- controlled evidence-access mechanism and the hash-chained case event log.
-- Nothing is copied and no document bytes move.
--
-- DEFAULT FALSE, and enforced server-side in the function rather than in the
-- browser. With it off:
--   * the two read operations answer with `enabled: false` and evaluate
--     nothing distributable;
--   * the two write operations answer 409 `distribution_disabled`;
--   * `grant_access`, `revoke_grant`, the Compliance Sharing panel and the
--     Partner Compliance Workspace behave exactly as they did before.
--
-- The flag gates DISTRIBUTION only. It never relaxes a prerequisite: with it
-- on, every s 37A condition the existing engine already enforced still has to
-- be satisfied, because the readiness engine composes those same evaluators
-- rather than reimplementing them.

INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_passport_partner_distribution', 'false'::jsonb,
   'Compliance Passport: partner distribution readiness and sharing (get_passport_distribution_readiness / get_passport_distribution_status / share_passport_to_partner / share_passport_to_partners on aml-reliance). Server-derived s 37A readiness over the existing reliance architecture. Off = reads report disabled and writes answer 409 distribution_disabled; nothing else changes.')
ON CONFLICT (key) DO NOTHING;

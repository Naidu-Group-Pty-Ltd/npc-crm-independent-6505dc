-- Aurixa AML/CTF Compliance Passport — presentation feature flags.
--
-- The Passport is an additive presentation layer over the existing AML
-- records (attestations, grants, manifests, assessments, case events).
-- These flags gate NEW read-only projections only; no schema, no data and
-- no existing behaviour changes. Both default OFF: with them off, the
-- application behaves exactly as before this migration existed.
--
-- Partner-facing Passport presentation deliberately has NO new flag: it
-- rides the existing aml_partner_compliance_workspace family, because it is
-- the same workspace payload presented differently — a second flag would be
-- a second authorisation path.

INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_passport_command_view', 'false'::jsonb,
   'Compliance Passport: Command Centre projection (get_passport_view on aml-reliance) and its workspace section. Read-only presentation over existing AML records. Off = the op answers 404 passport_disabled and nothing changes.'),
  ('aml_passport_client_view', 'false'::jsonb,
   'Compliance Passport: Client Portal projection (get_passport on aml-client-portal) and the client passport/booklet surface. A dedicated server-side sanitised view. Off = the op answers 404 passport_disabled and nothing changes.')
ON CONFLICT (key) DO NOTHING;

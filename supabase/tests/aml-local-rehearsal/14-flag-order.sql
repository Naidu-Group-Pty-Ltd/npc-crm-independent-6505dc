\set ON_ERROR_STOP on
-- E3/E7/E8 flag-order rehearsal at the database layer (synthetic tenant).
-- Layer 1
UPDATE public.feature_flags SET value='true'::jsonb WHERE key IN ('aml_partner_identity','aml_arrangement_governance','aml_attestation_v2');
-- Layer 2 (read-only workspace + reporting + finance surface only)
UPDATE public.feature_flags SET value='true'::jsonb WHERE key IN ('aml_partner_compliance_workspace','aml_partner_operations_reporting','aml_partner_workspace_finance');
SELECT 'developer surface stays false: ' || (value='false'::jsonb)::text AS r FROM public.feature_flags WHERE key='aml_partner_workspace_developer';
SELECT 'write flags all still false after layer 2: ' || (count(*)=5)::text AS r FROM public.feature_flags WHERE key IN ('aml_partner_grants_write','aml_partner_records_requests_write','aml_partner_evidence_delivery_write','aml_partner_determinations_write','aml_partner_service_blocking') AND value='false'::jsonb;
-- Layer 3 (events already exercised; retention)
UPDATE public.feature_flags SET value='true'::jsonb WHERE key IN ('aml_partner_event_outbox','aml_partner_records_retention');
-- Layer 4: one at a time, verifying between steps
UPDATE public.feature_flags SET value='true'::jsonb WHERE key='aml_partner_grants_write';
SELECT 'layer4 step1: only grants_write on: ' || (count(*)=1)::text AS r FROM public.feature_flags WHERE key LIKE 'aml_partner_%_write' AND value='true'::jsonb;
UPDATE public.feature_flags SET value='true'::jsonb WHERE key='aml_partner_records_requests_write';
UPDATE public.feature_flags SET value='true'::jsonb WHERE key='aml_partner_evidence_delivery_write';
UPDATE public.feature_flags SET value='true'::jsonb WHERE key='aml_partner_determinations_write';
SELECT 'service blocking remains false: ' || (value='false'::jsonb)::text AS r FROM public.feature_flags WHERE key='aml_partner_service_blocking';
-- Rollback drill: disable the latest write flag; authoritative records preserved.
UPDATE public.feature_flags SET value='false'::jsonb WHERE key='aml_partner_determinations_write';
SELECT 'flag rollback: determinations off, records preserved: ' || ((SELECT count(*) FROM aml.partner_refresh_obligations) >= 1)::text AS r;
-- Reset every partner flag to false (leave the rehearsal DB in default state).
UPDATE public.feature_flags SET value='false'::jsonb WHERE key LIKE 'aml_partner%';
SELECT 'all partner flags reset false: ' || (count(*)=14)::text AS r FROM public.feature_flags WHERE key LIKE 'aml_partner%' AND value='false'::jsonb;

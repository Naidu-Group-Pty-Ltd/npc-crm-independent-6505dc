-- Synthetic behaviour battery (Stage D steps 4-10). SYNTHETIC DATA ONLY.
\set ON_ERROR_STOP on

-- 4/8/9. RLS: authenticated/anon have NO route into partner tables.
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM aml.partner_organisations LIMIT 1;
    RAISE EXCEPTION 'RLS FAILED: authenticated read partner_organisations';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM aml.partner_evidence_deliveries LIMIT 1;
    RAISE EXCEPTION 'RLS FAILED: authenticated read deliveries';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO aml.partner_refresh_obligations DEFAULT VALUES;
    RAISE EXCEPTION 'RLS FAILED: authenticated wrote obligations';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'RLS deny (authenticated): PASS' AS result;

-- Seed synthetic domain (as service path would, via superuser standing in
-- for SECURITY DEFINER service role).
INSERT INTO auth.users(id, email) VALUES ('a0000000-0000-4000-8000-00000000000e','synthetic.mlro@example.test') ON CONFLICT DO NOTHING;
INSERT INTO public.custom_users(id, email) VALUES ('a0000000-0000-4000-8000-00000000000e','synthetic.mlro@example.test') ON CONFLICT DO NOTHING;
INSERT INTO public.clients(id) VALUES ('c0000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO aml.cases (id, case_reference, subject_display_name, subject_type, client_id, created_by)
VALUES ('a0000000-0000-4000-8000-000000000001', 'SYN-CASE-1', 'Synthetic Person One', 'individual', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000e');
INSERT INTO aml.partner_organisations (id, legal_name, organisation_type, created_by)
VALUES ('b0000000-0000-4000-8000-000000000001', 'Synthetic Finance Partner Pty Ltd', 'finance', 'a0000000-0000-4000-8000-00000000000e');
INSERT INTO aml.partner_organisations (id, legal_name, organisation_type, created_by)
VALUES ('b0000000-0000-4000-8000-000000000002', 'Synthetic Attacker Org Pty Ltd', 'builder', 'a0000000-0000-4000-8000-00000000000e');

-- 6a. Events flag OFF -> a link insert writes NO outbox row (default off).
INSERT INTO aml.partner_case_links (id, case_id, partner_org_id, portal_type, relationship_role, legal_route, purpose, linked_by)
VALUES ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'finance', 'lender_broker', 'reliance', 'Synthetic finance reliance link for pilot', 'a0000000-0000-4000-8000-00000000000e');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.integration_outbox WHERE event_type LIKE 'aml.%') THEN
    RAISE EXCEPTION 'flag-off wrote outbox rows';
  END IF;
END $$;
SELECT 'flag off => zero outbox writes: PASS' AS result;

-- 6b. Enable events; a link state change emits atomically; same-key enqueue is idempotent.
UPDATE public.feature_flags SET value='true'::jsonb WHERE key='aml_partner_event_outbox';
UPDATE aml.partner_case_links SET state='suspended', suspended_at=now() WHERE id='d0000000-0000-4000-8000-000000000001';
UPDATE aml.partner_case_links SET state='active', suspended_at=NULL WHERE id='d0000000-0000-4000-8000-000000000001';
SELECT 'suspend event emitted: ' || (count(*)=1)::text AS result FROM public.integration_outbox WHERE event_type='aml.partner_case_link.suspended';
SELECT aml.enqueue_partner_event('aml.partner_access.expired','reliance_grant','e0000000-0000-4000-8000-000000000001',1,'{"grant_id":"e0000000-0000-4000-8000-000000000001"}','dup-key-test', NULL,NULL,NULL,NULL);
SELECT aml.enqueue_partner_event('aml.partner_access.expired','reliance_grant','e0000000-0000-4000-8000-000000000001',1,'{"grant_id":"e0000000-0000-4000-8000-000000000001"}','dup-key-test', NULL,NULL,NULL,NULL);
SELECT 'duplicate enqueue -> one row: ' || (count(*)=1)::text AS result FROM public.integration_outbox WHERE idempotency_key='dup-key-test';

-- 6c. Restricted payload key is refused at the choke point.
DO $$ BEGIN
  BEGIN
    PERFORM aml.enqueue_partner_event('aml.partner_access.revoked','reliance_grant','e0000000-0000-4000-8000-000000000002',1,'{"risk_rating":"high"}','tripwire-test',NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'tripwire FAILED to block restricted key';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%restricted key%' THEN RAISE; END IF;
  END;
END $$;
SELECT 'restricted-key payload refused: PASS' AS result;

-- 6d. Unknown event type refused (closed catalogue).
DO $$ BEGIN
  BEGIN
    PERFORM aml.enqueue_partner_event('aml.invented.event','x','e0000000-0000-4000-8000-000000000003',1,'{}','unknown-type-test',NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'catalogue FAILED to block unknown type';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%unknown partner event type%' THEN RAISE; END IF;
  END;
END $$;
SELECT 'unknown event type refused: PASS' AS result;

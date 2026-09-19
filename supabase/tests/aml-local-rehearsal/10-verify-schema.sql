-- Schema verification (Stage D step 3). Raises on any missing object.
DO $$
DECLARE t text; missing text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'partner_organisations','partner_portal_memberships','partner_case_links',
    'partner_org_name_mappings','arrangement_assessments','disclosure_manifests',
    'partner_records_requests','partner_evidence_deliveries','partner_refresh_obligations',
    'partner_notifications','partner_event_catalogue','record_class_catalogue',
    'partner_sla_targets','reliance_agreements','compliance_attestations',
    'reliance_grants','independent_assessments','reliance_access_log',
    'retention_triggers','legal_holds','retention_scans','retention_scan_items',
    'retention_schedules','documents'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='aml' AND table_name=t) THEN
      missing := missing || ' aml.' || t;
    END IF;
  END LOOP;
  IF missing <> '' THEN RAISE EXCEPTION 'missing tables:%', missing; END IF;
END $$;
DO $$ BEGIN
  -- Phase 6 envelope on the platform outbox
  PERFORM 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='integration_outbox' AND column_name IN ('partner_org_id','destination_class','payload_classification') HAVING count(*)=3;
  IF NOT FOUND THEN RAISE EXCEPTION 'outbox envelope columns missing'; END IF;
  -- Stage B column
  PERFORM 1 FROM information_schema.columns WHERE table_schema='aml' AND table_name='partner_evidence_deliveries' AND column_name='evidence_document_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'evidence_document_id missing'; END IF;
  -- corrected classifications
  IF (SELECT information_classification FROM aml.record_class_catalogue WHERE record_code='raw_id_document_copy') <> 'P3' THEN RAISE EXCEPTION 'raw ID not P3'; END IF;
  IF (SELECT information_classification FROM aml.record_class_catalogue WHERE record_code='legal_hold_record') <> 'P4' THEN RAISE EXCEPTION 'legal hold not P4'; END IF;
  IF (SELECT information_classification FROM aml.record_class_catalogue WHERE record_code='suspicious_matter_material') <> 'P5' THEN RAISE EXCEPTION 'SMR row not P5'; END IF;
  IF (SELECT information_classification FROM aml.record_class_catalogue WHERE record_code='biometric_raw_capture') <> 'P6' THEN RAISE EXCEPTION 'biometric not P6'; END IF;
END $$;
-- structural export guard: P4/P5/P6 can never be flagged exportable
DO $$ BEGIN
  BEGIN
    UPDATE aml.record_class_catalogue SET partner_exportable = true WHERE record_code = 'legal_hold_record';
    RAISE EXCEPTION 'CHECK failed to block P4 exportable';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE aml.record_class_catalogue SET partner_exportable = true WHERE record_code = 'suspicious_matter_material';
    RAISE EXCEPTION 'CHECK failed to block P5 exportable';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE aml.record_class_catalogue SET partner_exportable = true WHERE record_code = 'biometric_raw_capture';
    RAISE EXCEPTION 'CHECK failed to block P6 exportable';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- triggers, functions, policies, flags
SELECT 'aml triggers' AS check, count(*) FROM information_schema.triggers WHERE trigger_schema='aml' AND trigger_name LIKE 'trg_aml_emit%';
SELECT 'enqueue fn' AS check, count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='aml' AND p.proname IN ('enqueue_partner_event','apply_partner_material_change','partner_events_enabled','assert_partner_event_payload_safe');
SELECT 'rls enabled partner tables' AS check, count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='aml' AND c.relname LIKE 'partner%' AND c.relrowsecurity;
SELECT 'partner flags (all false)' AS check, count(*) FROM public.feature_flags WHERE key LIKE 'aml_partner%' AND value = 'false'::jsonb;
SELECT key, value FROM public.feature_flags WHERE key LIKE 'aml_partner%' ORDER BY key;

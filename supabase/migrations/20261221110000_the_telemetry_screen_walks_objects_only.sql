-- ============================================================================
-- The telemetry privacy screen walks OBJECTS, and nothing goes round it.
--
-- `record_portal_operational_event` (phase 14) refuses metadata carrying a
-- sensitive key with
--
--     jsonb_path_exists(_metadata, '$.**.keyvalue() ? (@.key like_regex …)')
--
-- `$.**` visits every item, scalars included, and `.keyvalue()` raises on
-- anything that is not an object. So any metadata holding an ordinary value —
-- `{"attempt": 1}` — made the recorder throw "jsonpath item method .keyvalue()
-- can only be applied to an object" (measured in production, 25 Sep 2026).
-- Every caller in the repository passes such metadata, so login telemetry,
-- outbox delivery, audit-chain failures and malware detection (the last two
-- alert-raising) could not be recorded at all.
--
-- The screen is now ONE function, applied to objects only:
--
--     $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex …)
--
-- It still visits every object at every depth, inside arrays and mixed
-- arrays, so every key phase 14 refused is still refused wherever it sits —
-- the only change is that a scalar is no longer an error. The recorder has no
-- handler around it: a failure of the screen refuses the event rather than
-- recording it unscreened (fail-closed).
--
-- And the screen is now also the TABLE's: a BEFORE INSERT/UPDATE trigger
-- applies the same function, so a direct write — by any role, including the
-- SQL functions that insert events themselves — cannot go round it.
--
-- The recorder's signature, grants, alert rule and every other line are
-- phase 14's verbatim.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.portal_operational_metadata_is_forbidden(_metadata jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT jsonb_path_exists(
    COALESCE(_metadata, '{}'::jsonb),
    '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "(?i)^(internal_notes|risk_notes|contract_text|raw_content|income|expenses|assets|liabilities|borrowing_capacity|smr|aml_restricted)$")'
  )
$fn$;

REVOKE ALL ON FUNCTION public.portal_operational_metadata_is_forbidden(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_operational_metadata_is_forbidden(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.record_portal_operational_event(_event_name text,_severity text,_correlation_id uuid,_request_id text,_actor_type text,_actor_id uuid,_portal text,_case_id uuid,_matter_id uuid,_firm_id uuid,_duration_ms integer,_success boolean,_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE e public.portal_operational_events%ROWTYPE; alert_name text; BEGIN
 IF _correlation_id IS NULL OR NULLIF(trim(_event_name),'') IS NULL OR NULLIF(trim(_actor_type),'') IS NULL OR NULLIF(trim(_portal),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='OBSERVABILITY_DIMENSIONS_REQUIRED'; END IF;
 IF _severity NOT IN ('info','warning','high','critical') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_EVENT_SEVERITY'; END IF;
 IF public.portal_operational_metadata_is_forbidden(_metadata) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SENSITIVE_TELEMETRY_FIELD_FORBIDDEN'; END IF;
 INSERT INTO public.portal_operational_events(event_name,severity,correlation_id,request_id,actor_type,actor_id,portal,case_id,matter_id,firm_id,duration_ms,success,metadata)
 VALUES(left(_event_name,120),_severity,_correlation_id,left(_request_id,200),left(_actor_type,80),_actor_id,left(_portal,80),_case_id,_matter_id,_firm_id,_duration_ms,_success,COALESCE(_metadata,'{}')) RETURNING * INTO e;
 alert_name:=CASE WHEN _event_name IN ('cross_firm_access_attempt','audit_chain_failure','mandatory_audit_write_failure','dead_lettered_settlement_event','document_malware_detected','client_projection_privacy_violation','cross_client_case_link_attempt','excessive_authentication_failures') THEN _event_name END;
 IF alert_name IS NOT NULL THEN INSERT INTO public.portal_operational_alerts(event_id,alert_type,severity,summary) VALUES(e.id,alert_name,CASE WHEN _severity='critical' THEN 'critical' ELSE 'high' END,left(replace(alert_name,'_',' '),240)); END IF;
 RETURN e.id;
END $$;

REVOKE ALL ON FUNCTION public.record_portal_operational_event(text,text,uuid,text,text,uuid,text,uuid,uuid,uuid,integer,boolean,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_portal_operational_event(text,text,uuid,text,text,uuid,text,uuid,uuid,uuid,integer,boolean,jsonb) TO service_role;

-- The same screen on the table, so a direct write cannot go round it.
CREATE OR REPLACE FUNCTION public.portal_operational_events_screen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF public.portal_operational_metadata_is_forbidden(NEW.metadata) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SENSITIVE_TELEMETRY_FIELD_FORBIDDEN';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.portal_operational_events_screen() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_portal_operational_events_screen ON public.portal_operational_events;
CREATE TRIGGER trg_portal_operational_events_screen
  BEFORE INSERT OR UPDATE OF metadata ON public.portal_operational_events
  FOR EACH ROW EXECUTE FUNCTION public.portal_operational_events_screen();

-- Asserted by effect, inside the transaction that ships it.
DO $$
DECLARE
  v_id uuid;
BEGIN
  -- Ordinary metadata records (this is exactly what failed before).
  IF public.portal_operational_metadata_is_forbidden('{"attempt": 1, "ok": true, "x": null, "list": [1, "a", {"b": 2}]}'::jsonb) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: harmless metadata is refused';
  END IF;
  -- A sensitive key is refused at depth, inside an array, in any case.
  IF NOT public.portal_operational_metadata_is_forbidden('{"a": [1, {"b": {"Internal_Notes": 1}}]}'::jsonb) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: a nested sensitive key is not refused';
  END IF;
  IF has_function_privilege('authenticated', 'public.record_portal_operational_event(text,text,uuid,text,text,uuid,text,uuid,uuid,uuid,integer,boolean,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.record_portal_operational_event(text,text,uuid,text,text,uuid,text,uuid,uuid,uuid,integer,boolean,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the recorder is executable by a browser role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_portal_operational_events_screen' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the table screen is not installed';
  END IF;
END $$;

COMMIT;

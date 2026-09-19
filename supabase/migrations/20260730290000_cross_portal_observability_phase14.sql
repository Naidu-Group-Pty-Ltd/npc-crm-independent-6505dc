-- Phase 14: privacy-safe, correlated operational observability.
CREATE TABLE IF NOT EXISTS public.portal_operational_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_name text NOT NULL, severity text NOT NULL CHECK(severity IN ('info','warning','high','critical')),
 correlation_id uuid NOT NULL, request_id text, actor_type text NOT NULL, actor_id uuid, portal text NOT NULL,
 case_id uuid REFERENCES public.transaction_cases(id), matter_id uuid REFERENCES public.legal_matters(id), firm_id uuid REFERENCES public.solicitor_firms(id),
 duration_ms integer CHECK(duration_ms IS NULL OR duration_ms>=0), success boolean, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_events_name_time ON public.portal_operational_events(event_name,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_events_correlation ON public.portal_operational_events(correlation_id,occurred_at,id);
CREATE INDEX IF NOT EXISTS idx_portal_events_case ON public.portal_operational_events(case_id,occurred_at DESC) WHERE case_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.portal_operational_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL UNIQUE REFERENCES public.portal_operational_events(id), alert_type text NOT NULL,
 severity text NOT NULL CHECK(severity IN ('high','critical')), status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
 summary text NOT NULL, acknowledged_by uuid, acknowledged_at timestamptz, resolved_by uuid, resolved_at timestamptz, resolution_notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_alerts_open ON public.portal_operational_alerts(severity,created_at DESC) WHERE status='open';

CREATE OR REPLACE FUNCTION public.record_portal_operational_event(_event_name text,_severity text,_correlation_id uuid,_request_id text,_actor_type text,_actor_id uuid,_portal text,_case_id uuid,_matter_id uuid,_firm_id uuid,_duration_ms integer,_success boolean,_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE e public.portal_operational_events%ROWTYPE; alert_name text; BEGIN
 IF _correlation_id IS NULL OR NULLIF(trim(_event_name),'') IS NULL OR NULLIF(trim(_actor_type),'') IS NULL OR NULLIF(trim(_portal),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='OBSERVABILITY_DIMENSIONS_REQUIRED'; END IF;
 IF _severity NOT IN ('info','warning','high','critical') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_EVENT_SEVERITY'; END IF;
 IF jsonb_path_exists(COALESCE(_metadata,'{}'), '$.**.keyvalue() ? (@.key like_regex "(?i)^(internal_notes|risk_notes|contract_text|raw_content|income|expenses|assets|liabilities|borrowing_capacity|smr|aml_restricted)$")') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SENSITIVE_TELEMETRY_FIELD_FORBIDDEN'; END IF;
 INSERT INTO public.portal_operational_events(event_name,severity,correlation_id,request_id,actor_type,actor_id,portal,case_id,matter_id,firm_id,duration_ms,success,metadata)
 VALUES(left(_event_name,120),_severity,_correlation_id,left(_request_id,200),left(_actor_type,80),_actor_id,left(_portal,80),_case_id,_matter_id,_firm_id,_duration_ms,_success,COALESCE(_metadata,'{}')) RETURNING * INTO e;
 alert_name:=CASE WHEN _event_name IN ('cross_firm_access_attempt','audit_chain_failure','mandatory_audit_write_failure','dead_lettered_settlement_event','document_malware_detected','client_projection_privacy_violation','cross_client_case_link_attempt','excessive_authentication_failures') THEN _event_name END;
 IF alert_name IS NOT NULL THEN INSERT INTO public.portal_operational_alerts(event_id,alert_type,severity,summary) VALUES(e.id,alert_name,CASE WHEN _severity='critical' THEN 'critical' ELSE 'high' END,left(replace(alert_name,'_',' '),240)); END IF;
 RETURN e.id;
END $$;

CREATE OR REPLACE FUNCTION public.get_portal_operational_health(_hours integer DEFAULT 24)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 WITH e AS (SELECT * FROM public.portal_operational_events WHERE occurred_at>=now()-make_interval(hours=>LEAST(GREATEST(_hours,1),720)))
 SELECT jsonb_build_object('window_hours',LEAST(GREATEST(_hours,1),720),'metrics',jsonb_build_object(
 'solicitor_login_success_rate',COALESCE((SELECT round(100.0*count(*) FILTER(WHERE success)/NULLIF(count(*),0),2) FROM e WHERE event_name IN ('solicitor_login_success','solicitor_login_failure')),100),
 'solicitor_login_lockouts',(SELECT count(*) FROM e WHERE event_name='solicitor_login_lockout'),
 'matter_access_denials',(SELECT count(*) FROM e WHERE event_name='matter_access_denial'),
 'cross_firm_access_attempts',(SELECT count(*) FROM e WHERE event_name='cross_firm_access_attempt'),
 'outbox_failure_rate',COALESCE((SELECT round(100.0*count(*) FILTER(WHERE success=false)/NULLIF(count(*),0),2) FROM e WHERE event_name='outbox_delivery'),0),
 'outbox_delivery_latency_ms',COALESCE((SELECT round(avg(duration_ms),0) FROM e WHERE event_name='outbox_delivery' AND success),0),
 'projection_staleness',(SELECT count(*) FROM e WHERE event_name='projection_stale'),
 'conversation_delivery_failures',(SELECT count(*) FROM e WHERE event_name='conversation_delivery_failure'),
 'document_scan_failures',(SELECT count(*) FROM e WHERE event_name IN ('document_scan_failure','document_malware_detected')),
 'audit_chain_failures',(SELECT count(*) FROM e WHERE event_name='audit_chain_failure'),
 'case_link_mismatches',(SELECT count(*) FROM e WHERE event_name IN ('case_link_mismatch','cross_client_case_link_attempt')),
 'status_conflicts',(SELECT count(*) FROM e WHERE event_name='status_conflict'),
 'stale_write_conflicts',(SELECT count(*) FROM e WHERE event_name='stale_write_conflict'),
 'ai_run_failure_rate',COALESCE((SELECT round(100.0*count(*) FILTER(WHERE success=false)/NULLIF(count(*),0),2) FROM e WHERE event_name='ai_analysis_run'),0),
 'ai_cost_by_firm',COALESCE((SELECT jsonb_object_agg(firm_id,total) FROM (SELECT firm_id::text firm_id,round(sum(COALESCE((metadata->>'cost_usd')::numeric,0)),4) total FROM e WHERE event_name='ai_analysis_run' AND firm_id IS NOT NULL GROUP BY firm_id)x),'{}'::jsonb)),
 'open_alerts',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM (SELECT a.id,a.alert_type,a.severity,a.status,a.summary,a.created_at,e.correlation_id,e.portal,e.case_id,e.matter_id FROM public.portal_operational_alerts a JOIN public.portal_operational_events e ON e.id=a.event_id WHERE a.status='open' LIMIT 100)a),'[]'::jsonb),
 'recent_failures',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.occurred_at DESC) FROM (SELECT id,event_name,severity,correlation_id,portal,case_id,matter_id,duration_ms,metadata,occurred_at FROM e WHERE success=false ORDER BY occurred_at DESC LIMIT 100)x),'[]'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_portal_operational_alert(_alert_id uuid,_actor_id uuid,_resolution boolean DEFAULT false,_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE a public.portal_operational_alerts%ROWTYPE; BEGIN UPDATE public.portal_operational_alerts SET status=CASE WHEN _resolution THEN 'resolved' ELSE 'acknowledged' END,acknowledged_by=COALESCE(acknowledged_by,_actor_id),acknowledged_at=COALESCE(acknowledged_at,now()),resolved_by=CASE WHEN _resolution THEN _actor_id ELSE resolved_by END,resolved_at=CASE WHEN _resolution THEN now() ELSE resolved_at END,resolution_notes=CASE WHEN _resolution THEN left(_notes,2000) ELSE resolution_notes END WHERE id=_alert_id RETURNING * INTO a;IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ALERT_NOT_FOUND';END IF;RETURN to_jsonb(a);END $$;

GRANT ALL ON public.portal_operational_events,public.portal_operational_alerts TO service_role;REVOKE ALL ON public.portal_operational_events,public.portal_operational_alerts FROM anon,authenticated;
ALTER TABLE public.portal_operational_events ENABLE ROW LEVEL SECURITY;ALTER TABLE public.portal_operational_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY portal_operational_events_service ON public.portal_operational_events FOR ALL TO service_role USING(true) WITH CHECK(true);CREATE POLICY portal_operational_alerts_service ON public.portal_operational_alerts FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON FUNCTION public.record_portal_operational_event(text,text,uuid,text,text,uuid,text,uuid,uuid,uuid,integer,boolean,jsonb),public.get_portal_operational_health(integer),public.acknowledge_portal_operational_alert(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_portal_operational_event(text,text,uuid,text,text,uuid,text,uuid,uuid,uuid,integer,boolean,jsonb),public.get_portal_operational_health(integer),public.acknowledge_portal_operational_alert(uuid,uuid,boolean,text) TO service_role;

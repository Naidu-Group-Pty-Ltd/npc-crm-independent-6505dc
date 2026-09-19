-- Phase 15: expand-and-contract cutover control plane. No legacy object is dropped here.
CREATE TABLE IF NOT EXISTS public.cross_portal_feature_definitions (
 feature_key text PRIMARY KEY, description text NOT NULL, default_mode text NOT NULL CHECK(default_mode IN ('off','shadow','dual_read','dual_write','cutover','rollback')),
 legacy_removal_target text NOT NULL, minimum_stable_days integer NOT NULL DEFAULT 7 CHECK(minimum_stable_days BETWEEN 1 AND 90), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cross_portal_firm_rollouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), firm_id uuid NOT NULL REFERENCES public.solicitor_firms(id) ON DELETE CASCADE,
 feature_key text NOT NULL REFERENCES public.cross_portal_feature_definitions(feature_key), mode text NOT NULL CHECK(mode IN ('off','shadow','dual_read','dual_write','cutover','rollback')),
 reason text NOT NULL, changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now(), stable_since timestamptz, UNIQUE(firm_id,feature_key)
);
CREATE TABLE IF NOT EXISTS public.cross_portal_rollout_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), firm_id uuid NOT NULL REFERENCES public.solicitor_firms(id), feature_key text NOT NULL,
 from_mode text, to_mode text NOT NULL, reason text NOT NULL, changed_by uuid, readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rollout_history_firm ON public.cross_portal_rollout_history(firm_id,feature_key,changed_at DESC);
CREATE TABLE IF NOT EXISTS public.cross_portal_dual_read_comparisons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), firm_id uuid NOT NULL REFERENCES public.solicitor_firms(id), feature_key text NOT NULL,
 subject_type text NOT NULL, subject_id uuid, legacy_hash text NOT NULL CHECK(legacy_hash ~ '^[0-9a-f]{64}$'), target_hash text NOT NULL CHECK(target_hash ~ '^[0-9a-f]{64}$'),
 matches boolean NOT NULL, mismatch_fields text[] NOT NULL DEFAULT '{}', correlation_id uuid NOT NULL, compared_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(feature_key,firm_id,subject_type,subject_id,correlation_id)
);
CREATE INDEX IF NOT EXISTS idx_dual_read_mismatch ON public.cross_portal_dual_read_comparisons(firm_id,feature_key,compared_at DESC) WHERE matches=false;
CREATE TABLE IF NOT EXISTS public.cross_portal_cutover_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), firm_id uuid NOT NULL REFERENCES public.solicitor_firms(id), feature_key text NOT NULL,
 approved_by uuid NOT NULL, approval_type text NOT NULL CHECK(approval_type IN ('technical','security','operations','business_owner')),
 evidence_reference text NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, UNIQUE(firm_id,feature_key,approval_type)
);
CREATE TABLE IF NOT EXISTS public.cross_portal_reconciliation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), firm_id uuid REFERENCES public.solicitor_firms(id), feature_key text, status text NOT NULL CHECK(status IN ('running','passed','failed')),
 counters jsonb NOT NULL DEFAULT '{}'::jsonb, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, initiated_by uuid
);

INSERT INTO public.cross_portal_feature_definitions(feature_key,description,default_mode,legacy_removal_target) VALUES
 ('solicitor_matter_access_v2','Explicit matter-scoped authorization','cutover','Client-level Solicitor authorization and OR-merged permissions'),
 ('solicitor_cookie_sessions_v2','Hashed cookie-only Solicitor sessions','cutover','Plaintext Solicitor session columns'),
 ('transaction_case_backbone','Canonical cross-domain case identity','cutover','One-sided link mutation paths'),
 ('case_milestones_v2','Unified case milestones and tasks','cutover','Duplicate shared settlement task tables'),
 ('canonical_conversations_v2','Participant-based canonical conversations','cutover','Direct legal message mirrors'),
 ('immutable_documents_v2','Immutable scanned document versions','shadow','Mutable replacement document objects'),
 ('client_legal_workspace','Governed Client Legal Workspace','shadow','Direct visibility flags without projections'),
 ('ai_governance_v2','Firm-governed legal AI','shadow','Ungoverned contract analysis rows')
ON CONFLICT(feature_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.resolve_cross_portal_feature_mode(_firm_id uuid,_feature_key text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$ SELECT COALESCE((SELECT mode FROM public.cross_portal_firm_rollouts WHERE firm_id=_firm_id AND feature_key=_feature_key),(SELECT default_mode FROM public.cross_portal_feature_definitions WHERE feature_key=_feature_key),'off'); $$;

CREATE OR REPLACE FUNCTION public.record_cross_portal_dual_read(_firm_id uuid,_feature_key text,_subject_type text,_subject_id uuid,_legacy jsonb,_target jsonb,_mismatch_fields text[],_correlation_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE result_id uuid; legacy_digest text;target_digest text;BEGIN
 legacy_digest:=encode(digest(COALESCE(_legacy,'null'::jsonb)::text,'sha256'),'hex');target_digest:=encode(digest(COALESCE(_target,'null'::jsonb)::text,'sha256'),'hex');
 INSERT INTO public.cross_portal_dual_read_comparisons(firm_id,feature_key,subject_type,subject_id,legacy_hash,target_hash,matches,mismatch_fields,correlation_id)
 VALUES(_firm_id,_feature_key,left(_subject_type,80),_subject_id,legacy_digest,target_digest,legacy_digest=target_digest,COALESCE(_mismatch_fields,'{}'),_correlation_id) ON CONFLICT DO NOTHING RETURNING id INTO result_id;RETURN result_id;
END $$;

CREATE OR REPLACE FUNCTION public.get_cross_portal_cutover_readiness(_firm_id uuid,_feature_key text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 WITH definition AS (SELECT * FROM public.cross_portal_feature_definitions WHERE feature_key=_feature_key), checks AS (
 SELECT
 (SELECT count(*) FROM public.cross_portal_dual_read_comparisons WHERE firm_id=_firm_id AND feature_key=_feature_key AND matches=false AND compared_at>=now()-interval '7 days') mismatch_count,
 (SELECT count(*) FROM public.integration_dead_letters WHERE replayed_at IS NULL) dead_letter_count,
 (SELECT count(*) FROM public.portal_operational_alerts WHERE status='open' AND severity='critical') critical_alert_count,
 (SELECT count(*) FROM public.transaction_case_reconciliation_issues WHERE status='open') case_issue_count,
 (SELECT count(*) FROM public.solicitor_matter_access_migration_exceptions WHERE resolved_at IS NULL) access_exception_count,
 (SELECT count(*) FROM public.solicitor_portal_users WHERE session_token IS NOT NULL OR session_expires_at IS NOT NULL) plaintext_session_count,
 (SELECT count(*) FROM public.document_versions WHERE lifecycle_status IN ('available','reviewed','retained','legal_hold') AND malware_scan_status<>'clean') unsafe_document_count,
 (SELECT count(DISTINCT approval_type) FROM public.cross_portal_cutover_approvals WHERE firm_id=_firm_id AND feature_key=_feature_key AND revoked_at IS NULL) approval_count,
 (SELECT max(changed_at) FROM public.cross_portal_rollout_history WHERE firm_id=_firm_id AND feature_key=_feature_key AND to_mode IN ('dual_read','dual_write','cutover')) stable_since)
 SELECT jsonb_build_object('ready',mismatch_count=0 AND dead_letter_count=0 AND critical_alert_count=0 AND case_issue_count=0 AND access_exception_count=0 AND plaintext_session_count=0 AND unsafe_document_count=0 AND approval_count=4 AND stable_since<=now()-make_interval(days=definition.minimum_stable_days),
 'feature_key',_feature_key,'minimum_stable_days',definition.minimum_stable_days,'checks',to_jsonb(checks),'evaluated_at',now()) FROM checks CROSS JOIN definition;
$$;

CREATE OR REPLACE FUNCTION public.set_cross_portal_firm_rollout(_firm_id uuid,_feature_key text,_to_mode text,_reason text,_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE current_mode text; readiness jsonb; allowed boolean;BEGIN
 IF NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CUTOVER_REASON_REQUIRED';END IF;
 current_mode:=public.resolve_cross_portal_feature_mode(_firm_id,_feature_key);readiness:=public.get_cross_portal_cutover_readiness(_firm_id,_feature_key);
 allowed:=_to_mode='rollback' OR
  (current_mode='off' AND _to_mode='shadow') OR
  (current_mode='shadow' AND _to_mode='dual_read') OR
  (current_mode='dual_read' AND _to_mode='dual_write') OR
  (current_mode='dual_write' AND _to_mode='cutover') OR
  (current_mode='rollback' AND _to_mode='dual_read');
 IF NOT allowed THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_CUTOVER_TRANSITION';END IF;
 IF _to_mode='cutover' AND COALESCE((readiness->>'ready')::boolean,false)<>true THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CUTOVER_READINESS_FAILED';END IF;
 INSERT INTO public.cross_portal_firm_rollouts(firm_id,feature_key,mode,reason,changed_by,stable_since) VALUES(_firm_id,_feature_key,_to_mode,left(trim(_reason),2000),_actor_id,CASE WHEN _to_mode IN ('dual_read','dual_write','cutover') THEN now() END) ON CONFLICT(firm_id,feature_key) DO UPDATE SET mode=excluded.mode,reason=excluded.reason,changed_by=excluded.changed_by,changed_at=now(),stable_since=CASE WHEN excluded.mode IN ('dual_read','dual_write','cutover') THEN COALESCE(cross_portal_firm_rollouts.stable_since,now()) END;
 INSERT INTO public.cross_portal_rollout_history(firm_id,feature_key,from_mode,to_mode,reason,changed_by,readiness_snapshot) VALUES(_firm_id,_feature_key,current_mode,_to_mode,left(trim(_reason),2000),_actor_id,readiness);
 RETURN jsonb_build_object('firm_id',_firm_id,'feature_key',_feature_key,'from_mode',current_mode,'mode',_to_mode,'readiness',readiness);
END $$;

GRANT ALL ON public.cross_portal_feature_definitions,public.cross_portal_firm_rollouts,public.cross_portal_rollout_history,public.cross_portal_dual_read_comparisons,public.cross_portal_cutover_approvals,public.cross_portal_reconciliation_runs TO service_role;
REVOKE ALL ON public.cross_portal_feature_definitions,public.cross_portal_firm_rollouts,public.cross_portal_rollout_history,public.cross_portal_dual_read_comparisons,public.cross_portal_cutover_approvals,public.cross_portal_reconciliation_runs FROM anon,authenticated;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['cross_portal_feature_definitions','cross_portal_firm_rollouts','cross_portal_rollout_history','cross_portal_dual_read_comparisons','cross_portal_cutover_approvals','cross_portal_reconciliation_runs'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING(true) WITH CHECK(true)',t||'_service',t);END LOOP;END$$;
REVOKE ALL ON FUNCTION public.resolve_cross_portal_feature_mode(uuid,text),public.record_cross_portal_dual_read(uuid,text,text,uuid,jsonb,jsonb,text[],uuid),public.get_cross_portal_cutover_readiness(uuid,text),public.set_cross_portal_firm_rollout(uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_cross_portal_feature_mode(uuid,text),public.record_cross_portal_dual_read(uuid,text,text,uuid,jsonb,jsonb,text[],uuid),public.get_cross_portal_cutover_readiness(uuid,text),public.set_cross_portal_firm_rollout(uuid,text,text,text,uuid) TO service_role;

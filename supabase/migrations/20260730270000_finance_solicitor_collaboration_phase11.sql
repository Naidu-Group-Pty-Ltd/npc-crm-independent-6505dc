-- Phase 11: governed Finance–Solicitor collaboration through transaction cases.
ALTER TABLE public.finance_case_read_model
 ADD COLUMN IF NOT EXISTS legal_matter_id uuid REFERENCES public.legal_matters(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS purchase_file_id uuid REFERENCES public.purchase_files(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS matter_reference text,
 ADD COLUMN IF NOT EXISTS practice_name text,
 ADD COLUMN IF NOT EXISTS practice_email text,
 ADD COLUMN IF NOT EXISTS practice_phone text,
 ADD COLUMN IF NOT EXISTS solicitor_user_id uuid REFERENCES public.solicitor_portal_users(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS solicitor_email text,
 ADD COLUMN IF NOT EXISTS finance_clause_date date,
 ADD COLUMN IF NOT EXISTS finance_clause_state text,
 ADD COLUMN IF NOT EXISTS legal_source_version bigint,
 ADD COLUMN IF NOT EXISTS legal_updated_at timestamptz,
 ADD COLUMN IF NOT EXISTS link_health text NOT NULL DEFAULT 'partial';

ALTER TABLE public.solicitor_case_read_model
 ADD COLUMN IF NOT EXISTS purchase_file_id uuid REFERENCES public.purchase_files(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS finance_clause_date date,
 ADD COLUMN IF NOT EXISTS finance_clause_state text,
 ADD COLUMN IF NOT EXISTS finance_contact_name text,
 ADD COLUMN IF NOT EXISTS finance_contact_email text,
 ADD COLUMN IF NOT EXISTS finance_source_version bigint,
 ADD COLUMN IF NOT EXISTS finance_updated_at timestamptz,
 ADD COLUMN IF NOT EXISTS link_health text NOT NULL DEFAULT 'partial';

CREATE INDEX IF NOT EXISTS idx_finance_case_read_model_file ON public.finance_case_read_model(purchase_file_id);
CREATE INDEX IF NOT EXISTS idx_solicitor_case_read_model_file ON public.solicitor_case_read_model(purchase_file_id);

CREATE TABLE IF NOT EXISTS public.transaction_case_operational_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
 event_type text NOT NULL, actor_user_id uuid, reason text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transaction_case_operational_events_case ON public.transaction_case_operational_events(case_id,occurred_at DESC,id);

CREATE OR REPLACE FUNCTION public.get_finance_solicitor_collaboration_health(_stale_minutes integer DEFAULT 15)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'unlinked',jsonb_build_object(
   'legal_matters',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT m.id,m.matter_reference,m.title,m.client_id,m.updated_at FROM public.legal_matters m WHERE NOT EXISTS(SELECT 1 FROM public.transaction_case_links l WHERE l.legal_matter_id=m.id) ORDER BY m.updated_at DESC LIMIT 100)x),'[]'::jsonb),
   'purchase_files',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT p.id,p.title,p.client_id,p.finance_status,p.updated_at FROM public.purchase_files p WHERE p.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.transaction_case_links l WHERE l.purchase_file_id=p.id) ORDER BY p.updated_at DESC LIMIT 100)x),'[]'::jsonb),
   'client_deals',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT d.id,d.client_id,d.current_stage,d.updated_at FROM public.client_deals d WHERE NOT EXISTS(SELECT 1 FROM public.transaction_case_links l WHERE l.client_deal_id=d.id) ORDER BY d.updated_at DESC LIMIT 100)x),'[]'::jsonb)),
  'issues',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,issue_type,legal_matter_id,purchase_file_id,client_deal_id,expected_client_id,actual_client_id,detected_at FROM public.transaction_case_reconciliation_issues WHERE status='open' ORDER BY detected_at DESC LIMIT 200)x),'[]'::jsonb),
  'stale_projections',jsonb_build_object(
   'finance',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT case_id,updated_at,link_health FROM public.finance_case_read_model WHERE updated_at<now()-make_interval(mins=>LEAST(GREATEST(_stale_minutes,1),1440)) ORDER BY updated_at LIMIT 100)x),'[]'::jsonb),
   'solicitor',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT case_id,updated_at,link_health FROM public.solicitor_case_read_model WHERE updated_at<now()-make_interval(mins=>LEAST(GREATEST(_stale_minutes,1),1440)) ORDER BY updated_at LIMIT 100)x),'[]'::jsonb)),
  'stale_after_minutes',LEAST(GREATEST(_stale_minutes,1),1440));
$$;

CREATE OR REPLACE FUNCTION public.request_case_projection_refresh(_case_id uuid,_actor_user_id uuid,_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.transaction_cases%ROWTYPE; event_id uuid; BEGIN
 IF NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='REASON_REQUIRED'; END IF;
 SELECT * INTO c FROM public.transaction_cases WHERE id=_case_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='TRANSACTION_CASE_NOT_FOUND'; END IF;
 event_id:=public.enqueue_integration_event('transaction_case',c.id,'transaction_case.projection_refresh_requested',1,jsonb_build_object('case_id',c.id,'client_id',c.client_id,'row_version',c.row_version,'reason',left(trim(_reason),1000),'requested_by',_actor_user_id),'transaction_case:'||c.id||':projection_refresh:'||c.row_version||':'||extract(epoch from date_trunc('minute',now())),NULL);
 INSERT INTO public.transaction_case_operational_events(case_id,event_type,actor_user_id,reason,metadata)
 VALUES(c.id,'projection_refresh_requested',_actor_user_id,left(trim(_reason),1000),jsonb_build_object('outbox_id',event_id,'row_version',c.row_version));
 RETURN event_id;
END $$;

-- Safe deterministic backfill through exact case links only.
UPDATE public.finance_case_read_model p SET
 legal_matter_id=l.legal_matter_id,purchase_file_id=l.purchase_file_id,matter_reference=m.matter_reference,
 practice_name=COALESCE(f.trading_name,f.name),practice_email=f.contact_email,practice_phone=f.contact_phone,
 solicitor_user_id=u.id,solicitor_name=u.name,solicitor_email=u.email,
 finance_clause_date=pf.finance_clause_date,finance_clause_state=CASE WHEN pf.finance_clause_date IS NULL THEN 'not_recorded' WHEN pf.finance_clause_date<current_date AND pf.finance_status NOT IN ('unconditional_approval','ready_for_settlement','settled') THEN 'overdue' WHEN pf.finance_status IN ('unconditional_approval','ready_for_settlement','settled') THEN 'satisfied' ELSE 'pending' END,
 legal_source_version=m.row_version,legal_updated_at=m.updated_at,
 link_health=CASE WHEN l.legal_matter_id IS NOT NULL AND l.purchase_file_id IS NOT NULL AND l.client_deal_id IS NOT NULL THEN 'complete' ELSE 'partial' END
FROM public.transaction_case_links l
LEFT JOIN public.legal_matters m ON m.id=l.legal_matter_id
LEFT JOIN public.solicitor_firms f ON f.id=m.firm_id AND f.is_active=true
LEFT JOIN public.solicitor_portal_users u ON u.id=m.assigned_solicitor_user_id AND u.is_active=true
LEFT JOIN public.purchase_files pf ON pf.id=l.purchase_file_id
WHERE p.case_id=l.case_id;

UPDATE public.solicitor_case_read_model p SET
 purchase_file_id=l.purchase_file_id,finance_clause_date=pf.finance_clause_date,
 finance_clause_state=CASE WHEN pf.finance_clause_date IS NULL THEN 'not_recorded' WHEN pf.finance_clause_date<current_date AND pf.finance_status NOT IN ('unconditional_approval','ready_for_settlement','settled') THEN 'overdue' WHEN pf.finance_status IN ('unconditional_approval','ready_for_settlement','settled') THEN 'satisfied' ELSE 'pending' END,
 finance_contact_name=fc.name,finance_contact_email=fu.email,finance_source_version=extract(epoch from pf.updated_at)::bigint,finance_updated_at=pf.updated_at,
 link_health=CASE WHEN l.legal_matter_id IS NOT NULL AND l.purchase_file_id IS NOT NULL AND l.client_deal_id IS NOT NULL THEN 'complete' ELSE 'partial' END
FROM public.transaction_case_links l
LEFT JOIN public.purchase_files pf ON pf.id=l.purchase_file_id
LEFT JOIN public.finance_portal_users fu ON fu.id=pf.assigned_finance_user_id AND fu.is_active=true AND fu.revoked_at IS NULL
LEFT JOIN public.finance_agent_contacts fc ON fc.id=fu.finance_contact_id
WHERE p.case_id=l.case_id;

GRANT ALL ON public.transaction_case_operational_events TO service_role;
REVOKE ALL ON public.transaction_case_operational_events FROM anon,authenticated;
ALTER TABLE public.transaction_case_operational_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transaction_case_operational_events_service ON public.transaction_case_operational_events;
CREATE POLICY transaction_case_operational_events_service ON public.transaction_case_operational_events FOR ALL TO service_role USING(true) WITH CHECK(true);

REVOKE ALL ON FUNCTION public.get_finance_solicitor_collaboration_health(integer),public.request_case_projection_refresh(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_finance_solicitor_collaboration_health(integer),public.request_case_projection_refresh(uuid,uuid,text) TO service_role;

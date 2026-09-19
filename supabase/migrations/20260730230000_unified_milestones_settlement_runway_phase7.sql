-- Phase 7: one case-level milestone and settlement runway without removing domain records.
CREATE TABLE IF NOT EXISTS public.case_milestones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
 milestone_type text NOT NULL, title text NOT NULL, source_domain text NOT NULL CHECK(source_domain IN ('legal','finance','command_centre','system')),
 source_record_id uuid NOT NULL, authority text NOT NULL CHECK(authority IN ('legal','finance','command_centre','system','unresolved')),
 due_at timestamptz NOT NULL, status text NOT NULL CHECK(status IN ('pending','on_track','due_soon','overdue','completed','cancelled')),
 visibility text NOT NULL CHECK(visibility IN ('shared','client','legal_private','finance_private','command_private')),
 owner_type text, owner_id uuid, visible_to_client boolean NOT NULL DEFAULT false, notes text,
 source_created_at timestamptz, source_updated_at timestamptz, row_version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_domain,source_record_id)
);
CREATE INDEX IF NOT EXISTS idx_case_milestones_runway ON public.case_milestones(case_id,due_at,id);

CREATE TABLE IF NOT EXISTS public.case_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
 task_key text NOT NULL, label text NOT NULL, description text, status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','in_progress','blocked','completed','not_applicable')),
 owner_domain text NOT NULL CHECK(owner_domain IN ('legal','finance','client','command_centre','shared')),
 visibility text NOT NULL CHECK(visibility IN ('shared','client','legal_private','finance_private','command_private')),
 visible_to_client boolean NOT NULL DEFAULT false, is_required boolean NOT NULL DEFAULT true, due_at timestamptz,
 completed_at timestamptz, completion_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 source_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(source_refs)='array'), notes text, sequence integer NOT NULL DEFAULT 100,
 row_version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(case_id,task_key)
);
CREATE INDEX IF NOT EXISTS idx_case_tasks_runway ON public.case_tasks(case_id,sequence,id);

CREATE TABLE IF NOT EXISTS public.case_task_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES public.case_tasks(id) ON DELETE CASCADE,
 assignee_type text NOT NULL CHECK(assignee_type IN ('solicitor_user','finance_user','command_user','client','team')),
 assignee_id uuid NOT NULL, assigned_by uuid, assigned_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 UNIQUE(task_id,assignee_type,assignee_id)
);
CREATE TABLE IF NOT EXISTS public.case_task_status_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES public.case_tasks(id) ON DELETE CASCADE,
 from_status text, to_status text NOT NULL, actor_type text NOT NULL, actor_id uuid, reason text NOT NULL,
 completion_evidence jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_task_history ON public.case_task_status_history(task_id,occurred_at DESC,id);

CREATE TABLE IF NOT EXISTS public.case_milestone_conflicts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
 milestone_type text NOT NULL, conflict_type text NOT NULL CHECK(conflict_type IN ('due_at','status','task_status')),
 left_source jsonb NOT NULL, right_source jsonb NOT NULL, authoritative_milestone_id uuid REFERENCES public.case_milestones(id),
 resolution_status text NOT NULL DEFAULT 'open' CHECK(resolution_status IN ('open','authority_applied','resolved','dismissed')),
 requires_confirmation boolean NOT NULL DEFAULT true, resolution_reason text, resolved_by uuid, resolved_at timestamptz,
 conflict_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_milestone_conflicts_open ON public.case_milestone_conflicts(case_id,created_at DESC) WHERE resolution_status='open';

-- Critical-date backfill uses only explicit transaction-case links. No address matching.
INSERT INTO public.case_milestones(case_id,milestone_type,title,source_domain,source_record_id,authority,due_at,status,visibility,owner_type,owner_id,visible_to_client,notes,source_created_at,source_updated_at)
SELECT l.case_id,
 CASE d.date_type::text WHEN 'exchange' THEN 'contract_exchange' WHEN 'settlement' THEN 'contractual_settlement' WHEN 'finance_approval' THEN 'finance_approval_due' ELSE 'legal_'||d.date_type::text END,
 d.label,'legal',d.id,CASE WHEN d.date_type::text IN ('exchange','settlement') THEN 'legal' WHEN d.date_type::text='finance_approval' THEN 'finance' ELSE 'legal' END,
 (d.due_date::timestamp + COALESCE(d.due_time,time '00:00'))::timestamptz,
 CASE d.status::text WHEN 'satisfied' THEN 'completed' WHEN 'missed' THEN 'overdue' WHEN 'at_risk' THEN 'due_soon' WHEN 'waived' THEN 'cancelled' WHEN 'not_applicable' THEN 'cancelled' ELSE 'pending' END,
 CASE WHEN d.visible_to_client THEN 'client' WHEN d.date_type::text IN ('settlement','exchange','finance_approval') THEN 'shared' ELSE 'legal_private' END,
 d.owner,NULL,d.visible_to_client,d.notes,d.created_at,d.updated_at
FROM public.legal_matter_critical_dates d JOIN public.transaction_case_links l ON l.legal_matter_id=d.legal_matter_id WHERE d.due_date IS NOT NULL
ON CONFLICT(source_domain,source_record_id) DO NOTHING;

INSERT INTO public.case_milestones(case_id,milestone_type,title,source_domain,source_record_id,authority,due_at,status,visibility,visible_to_client,notes,source_created_at,source_updated_at)
SELECT l.case_id,
 CASE d.date_type::text WHEN 'settlement' THEN 'contractual_settlement' WHEN 'finance_clause_expiry' THEN 'finance_approval_due' WHEN 'loan_approval_target' THEN 'finance_approval_due' ELSE 'finance_'||d.date_type::text END,
 initcap(replace(d.date_type::text,'_',' ')),'finance',d.id,CASE WHEN d.date_type::text IN ('finance_clause_expiry','loan_approval_target') THEN 'finance' WHEN d.date_type::text='settlement' THEN 'legal' ELSE 'finance' END,
 d.due_date::timestamptz,CASE d.status::text WHEN 'completed' THEN 'completed' ELSE d.status::text END,
 CASE WHEN d.date_type::text IN ('settlement','finance_clause_expiry','loan_approval_target') THEN 'shared' ELSE 'finance_private' END,false,d.notes,d.created_at,d.updated_at
FROM public.purchase_file_critical_dates d JOIN public.transaction_case_links l ON l.purchase_file_id=d.purchase_file_id
ON CONFLICT(source_domain,source_record_id) DO NOTHING;

-- Preserve all task provenance while converging equivalent keys to one aggregate state.
INSERT INTO public.case_tasks(case_id,task_key,label,status,owner_domain,visibility,visible_to_client,due_at,completed_at,completion_evidence,source_refs,notes,sequence,created_at,updated_at)
SELECT l.case_id,CASE t.task_key::text WHEN 'funds_confirmed' THEN 'settlement_funds_ready' WHEN 'settlement_booked' THEN 'settlement_booking' WHEN 'final_inspection' THEN 'final_inspection' ELSE 'legal_'||t.task_key::text END,t.label,CASE t.status::text WHEN 'not_started' THEN 'pending' WHEN 'complete' THEN 'completed' ELSE t.status::text END,
 CASE WHEN t.owner='client' THEN 'client' WHEN t.task_key::text IN ('funds_confirmed','settlement_booked','final_inspection') THEN 'shared' ELSE 'legal' END,
 CASE WHEN t.owner='client' THEN 'client' WHEN t.task_key::text IN ('funds_confirmed','settlement_booked','final_inspection') THEN 'shared' ELSE 'legal_private' END,
 t.owner='client',t.due_date::timestamptz,t.completed_at,
 jsonb_build_object('completed_by_type',t.completed_by_type,'completed_by_solicitor_user_id',t.completed_by_solicitor_user_id),
 jsonb_build_array(jsonb_build_object('domain','legal','record_id',t.id,'status',t.status,'owner',t.owner,'created_at',t.created_at,'updated_at',t.updated_at)),t.notes,t.sequence,t.created_at,t.updated_at
FROM public.legal_matter_settlement_tasks t JOIN public.transaction_case_links l ON l.legal_matter_id=t.legal_matter_id
ON CONFLICT(case_id,task_key) DO NOTHING;

INSERT INTO public.case_tasks(case_id,task_key,label,description,status,owner_domain,visibility,visible_to_client,is_required,due_at,completed_at,completion_evidence,source_refs,notes,sequence,created_at,updated_at)
SELECT l.case_id,CASE t.task_key::text WHEN 'settlement_funds_ready' THEN 'settlement_funds_ready' WHEN 'lender_funder_booked' THEN 'settlement_booking' WHEN 'final_inspection' THEN 'final_inspection' WHEN 'settlement_attended' THEN 'settlement_complete' ELSE 'finance_'||t.task_key::text END,t.label,t.description,CASE WHEN t.status::text='completed' THEN 'completed' ELSE t.status::text END,
 CASE WHEN t.owner::text='client' THEN 'client' WHEN t.task_key::text IN ('settlement_funds_ready','lender_funder_booked','final_inspection','settlement_attended') THEN 'shared' ELSE 'finance' END,
 CASE WHEN t.owner::text='client' THEN 'client' WHEN t.task_key::text IN ('settlement_funds_ready','lender_funder_booked','final_inspection','settlement_attended') THEN 'shared' ELSE 'finance_private' END,
 t.owner::text='client',t.is_required,t.due_date::timestamptz,t.completed_at,
 jsonb_build_object('completed_by_finance_user_id',t.completed_by_finance_user_id,'completed_by_team_user_id',t.completed_by_team_user_id),
 jsonb_build_array(jsonb_build_object('domain','finance','record_id',t.id,'status',t.status,'owner',t.owner,'created_at',t.created_at,'updated_at',t.updated_at)),t.notes,t.sort_order,t.created_at,t.updated_at
FROM public.purchase_file_settlement_tasks t JOIN public.transaction_case_links l ON l.purchase_file_id=t.purchase_file_id
ON CONFLICT(case_id,task_key) DO UPDATE SET
 source_refs=public.case_tasks.source_refs||EXCLUDED.source_refs,
 visibility=CASE WHEN public.case_tasks.visibility='shared' OR EXCLUDED.visibility='shared' THEN 'shared' ELSE public.case_tasks.visibility END,
 owner_domain=CASE WHEN public.case_tasks.visibility='shared' OR EXCLUDED.visibility='shared' THEN 'shared' ELSE public.case_tasks.owner_domain END,
 status=CASE WHEN public.case_tasks.status='completed' AND EXCLUDED.status='completed' THEN 'completed' WHEN public.case_tasks.status='blocked' OR EXCLUDED.status='blocked' THEN 'blocked' WHEN public.case_tasks.status='in_progress' OR EXCLUDED.status='in_progress' THEN 'in_progress' ELSE 'pending' END,
 completed_at=CASE WHEN public.case_tasks.status='completed' AND EXCLUDED.status='completed' THEN GREATEST(public.case_tasks.completed_at,EXCLUDED.completed_at) END,
 completion_evidence=public.case_tasks.completion_evidence||EXCLUDED.completion_evidence,
 updated_at=GREATEST(public.case_tasks.updated_at,EXCLUDED.updated_at);

INSERT INTO public.case_task_status_history(task_id,from_status,to_status,actor_type,reason,completion_evidence,occurred_at)
SELECT id,NULL,status,'system','Phase 7 deterministic legacy backfill',completion_evidence,created_at FROM public.case_tasks
WHERE NOT EXISTS(SELECT 1 FROM public.case_task_status_history h WHERE h.task_id=case_tasks.id);

-- Divergent same-case milestones are visible reconciliation items; legal settlement authority is applied, never silently overwritten.
INSERT INTO public.case_milestone_conflicts(case_id,milestone_type,conflict_type,left_source,right_source,authoritative_milestone_id,resolution_status,requires_confirmation,conflict_key)
SELECT a.case_id,a.milestone_type,'due_at',jsonb_build_object('id',a.id,'domain',a.source_domain,'due_at',a.due_at,'source_record_id',a.source_record_id),
 jsonb_build_object('id',b.id,'domain',b.source_domain,'due_at',b.due_at,'source_record_id',b.source_record_id),
 CASE WHEN a.authority='legal' THEN a.id WHEN b.authority='legal' THEN b.id END,
 CASE WHEN a.authority='legal' OR b.authority='legal' THEN 'authority_applied' ELSE 'open' END,
 NOT (a.authority='legal' OR b.authority='legal'),
 'milestone:'||a.case_id||':'||a.milestone_type||':'||LEAST(a.id,b.id)||':'||GREATEST(a.id,b.id)
FROM public.case_milestones a JOIN public.case_milestones b ON b.case_id=a.case_id AND b.milestone_type=a.milestone_type AND b.id>a.id
WHERE a.due_at IS DISTINCT FROM b.due_at ON CONFLICT(conflict_key) DO NOTHING;

SELECT public.enqueue_integration_event('transaction_case',c.id,'case.runway.backfilled',1,
 jsonb_build_object('case_id',c.id,'milestone_count',(SELECT count(*) FROM public.case_milestones m WHERE m.case_id=c.id),'task_count',(SELECT count(*) FROM public.case_tasks t WHERE t.case_id=c.id)),
 'transaction_case:'||c.id||':phase7_runway_backfill',NULL)
FROM public.transaction_cases c WHERE EXISTS(SELECT 1 FROM public.case_milestones m WHERE m.case_id=c.id) OR EXISTS(SELECT 1 FROM public.case_tasks t WHERE t.case_id=c.id);

CREATE OR REPLACE FUNCTION public.get_case_runway(_case_id uuid,_audience text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'case_id',_case_id,
  'milestones',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.due_at,m.id) FROM public.case_milestones m WHERE m.case_id=_case_id AND
    CASE _audience WHEN 'solicitor' THEN m.visibility IN ('shared','client','legal_private') WHEN 'finance' THEN m.visibility IN ('shared','client','finance_private') WHEN 'client' THEN m.visible_to_client OR m.visibility='client' WHEN 'command_centre' THEN m.visibility IN ('shared','client','command_private') ELSE false END),'[]'::jsonb),
  'tasks',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sequence,t.id) FROM public.case_tasks t WHERE t.case_id=_case_id AND
    CASE _audience WHEN 'solicitor' THEN t.visibility IN ('shared','client','legal_private') WHEN 'finance' THEN t.visibility IN ('shared','client','finance_private') WHEN 'client' THEN t.visible_to_client OR t.visibility='client' WHEN 'command_centre' THEN t.visibility IN ('shared','client','command_private') ELSE false END),'[]'::jsonb),
  'conflicts',CASE WHEN _audience='command_centre' THEN COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC) FROM public.case_milestone_conflicts c WHERE c.case_id=_case_id AND c.resolution_status IN ('open','authority_applied')),'[]'::jsonb) ELSE '[]'::jsonb END
 );
$$;

CREATE OR REPLACE FUNCTION public.update_case_task_status(_task_id uuid,_expected_version bigint,_status text,_actor_type text,_actor_id uuid,_reason text,_completion_evidence jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.case_tasks%ROWTYPE; old_status text; ref jsonb; BEGIN
 IF NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='REASON_REQUIRED'; END IF;
 IF _status NOT IN ('pending','in_progress','blocked','completed','not_applicable') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_TASK_STATUS'; END IF;
 SELECT * INTO t FROM public.case_tasks WHERE id=_task_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='TASK_NOT_FOUND'; END IF;
 IF t.row_version<>_expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF;
 IF (_actor_type='solicitor_user' AND t.owner_domain NOT IN ('legal','shared','client')) OR (_actor_type='finance_user' AND t.owner_domain NOT IN ('finance','shared','client')) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='TASK_DOMAIN_FORBIDDEN'; END IF;
 old_status:=t.status;
 UPDATE public.case_tasks SET status=_status,row_version=row_version+1,completed_at=CASE WHEN _status='completed' THEN now() END,
  completion_evidence=CASE WHEN _status='completed' THEN COALESCE(_completion_evidence,'{}'::jsonb) ELSE '{}'::jsonb END,updated_at=now() WHERE id=t.id RETURNING * INTO t;
 INSERT INTO public.case_task_status_history(task_id,from_status,to_status,actor_type,actor_id,reason,completion_evidence) VALUES(t.id,old_status,_status,_actor_type,_actor_id,left(trim(_reason),1000),COALESCE(_completion_evidence,'{}'::jsonb));
 FOR ref IN SELECT value FROM jsonb_array_elements(t.source_refs) LOOP
  IF ref->>'domain'='legal' THEN UPDATE public.legal_matter_settlement_tasks SET status=(CASE _status WHEN 'pending' THEN 'not_started' WHEN 'completed' THEN 'complete' ELSE _status END)::public.legal_settlement_task_status,completed_at=CASE WHEN _status='completed' THEN t.completed_at END,updated_at=now() WHERE id=(ref->>'record_id')::uuid;
  ELSIF ref->>'domain'='finance' THEN UPDATE public.purchase_file_settlement_tasks SET status=_status::public.pf_settlement_task_status,completed_at=CASE WHEN _status='completed' THEN t.completed_at END,updated_at=now() WHERE id=(ref->>'record_id')::uuid; END IF;
 END LOOP;
 PERFORM public.enqueue_integration_event('transaction_case',t.case_id,'case.task.changed',1,jsonb_build_object('case_id',t.case_id,'task_id',t.id,'row_version',t.row_version),'case_task:'||t.id||':changed:'||t.row_version,NULL);
 RETURN to_jsonb(t);
END $$;

GRANT ALL ON public.case_milestones,public.case_tasks,public.case_task_assignments,public.case_task_status_history,public.case_milestone_conflicts TO service_role;
REVOKE ALL ON public.case_milestones,public.case_tasks,public.case_task_assignments,public.case_task_status_history,public.case_milestone_conflicts FROM anon,authenticated;
ALTER TABLE public.case_milestones ENABLE ROW LEVEL SECURITY; ALTER TABLE public.case_tasks ENABLE ROW LEVEL SECURITY; ALTER TABLE public.case_task_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.case_task_status_history ENABLE ROW LEVEL SECURITY; ALTER TABLE public.case_milestone_conflicts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY case_milestones_service ON public.case_milestones FOR ALL TO service_role USING(true) WITH CHECK(true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY case_tasks_service ON public.case_tasks FOR ALL TO service_role USING(true) WITH CHECK(true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY case_task_assignments_service ON public.case_task_assignments FOR ALL TO service_role USING(true) WITH CHECK(true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY case_task_history_service ON public.case_task_status_history FOR ALL TO service_role USING(true) WITH CHECK(true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY case_milestone_conflicts_service ON public.case_milestone_conflicts FOR ALL TO service_role USING(true) WITH CHECK(true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
REVOKE ALL ON FUNCTION public.get_case_runway(uuid,text),public.update_case_task_status(uuid,bigint,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_case_runway(uuid,text),public.update_case_task_status(uuid,bigint,text,text,uuid,text,jsonb) TO service_role;

ALTER TABLE public.legal_matters ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_legal_matters_id_row_version ON public.legal_matters(id, row_version);

CREATE OR REPLACE FUNCTION public.guard_legal_matter_ownership_and_links() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE linked_client uuid; assignee_firm uuid; assignee_active boolean; BEGIN
 IF NEW.assigned_solicitor_user_id IS NOT NULL THEN
  SELECT firm_id,is_active INTO assignee_firm,assignee_active FROM public.solicitor_portal_users WHERE id=NEW.assigned_solicitor_user_id;
  IF NOT COALESCE(assignee_active,false) OR NEW.firm_id IS NULL OR assignee_firm IS DISTINCT FROM NEW.firm_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ASSIGNEE_FIRM_MISMATCH'; END IF;
 END IF;
 IF NEW.purchase_file_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.purchase_file_id IS DISTINCT FROM OLD.purchase_file_id) THEN
  SELECT client_id INTO linked_client FROM public.purchase_files WHERE id=NEW.purchase_file_id;
  IF linked_client IS DISTINCT FROM NEW.client_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CROSS_CLIENT_LINK'; END IF;
  IF EXISTS(SELECT 1 FROM public.legal_matters WHERE purchase_file_id=NEW.purchase_file_id AND id<>NEW.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECORD_ALREADY_LINKED'; END IF;
 END IF;
 IF NEW.client_deal_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.client_deal_id IS DISTINCT FROM OLD.client_deal_id) THEN
  SELECT client_id INTO linked_client FROM public.client_deals WHERE id=NEW.client_deal_id;
  IF linked_client IS DISTINCT FROM NEW.client_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CROSS_CLIENT_LINK'; END IF;
  IF EXISTS(SELECT 1 FROM public.legal_matters WHERE client_deal_id=NEW.client_deal_id AND id<>NEW.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECORD_ALREADY_LINKED'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_legal_matter_ownership_and_links ON public.legal_matters;
CREATE TRIGGER trg_guard_legal_matter_ownership_and_links BEFORE INSERT OR UPDATE OF firm_id,assigned_solicitor_user_id,purchase_file_id,client_deal_id,client_id ON public.legal_matters
FOR EACH ROW EXECUTE FUNCTION public.guard_legal_matter_ownership_and_links();

CREATE OR REPLACE FUNCTION public.is_legal_matter_transition_allowed(_from public.legal_matter_status, _to public.legal_matter_status)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT _from = _to OR (_from, _to) IN (
  ('instructed','contract_review'), ('instructed','on_hold'), ('instructed','terminated'),
  ('contract_review','exchanged'), ('contract_review','cooling_off'), ('contract_review','conditions'), ('contract_review','on_hold'), ('contract_review','terminated'),
  ('exchanged','cooling_off'), ('exchanged','conditions'), ('exchanged','unconditional'), ('exchanged','on_hold'), ('exchanged','terminated'),
  ('cooling_off','conditions'), ('cooling_off','unconditional'), ('cooling_off','on_hold'), ('cooling_off','terminated'),
  ('conditions','unconditional'), ('conditions','on_hold'), ('conditions','terminated'),
  ('unconditional','pre_settlement'), ('unconditional','on_hold'), ('unconditional','terminated'),
  ('pre_settlement','settled'), ('pre_settlement','on_hold'), ('pre_settlement','terminated'),
  ('settled','post_settlement'), ('post_settlement','on_hold'),
  ('on_hold','instructed'), ('on_hold','contract_review'), ('on_hold','exchanged'), ('on_hold','cooling_off'), ('on_hold','conditions'), ('on_hold','unconditional'), ('on_hold','pre_settlement'), ('on_hold','post_settlement'), ('on_hold','terminated')
 );
$$;

CREATE OR REPLACE FUNCTION public.guard_legal_matter_state_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.closure_status IS DISTINCT FROM OLD.closure_status)
    AND COALESCE(current_setting('app.legal_command', true),'') = '' THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='LEGAL_COMMAND_REQUIRED';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_legal_matter_state_write ON public.legal_matters;
CREATE TRIGGER trg_guard_legal_matter_state_write BEFORE UPDATE OF status,closure_status ON public.legal_matters
FOR EACH ROW EXECUTE FUNCTION public.guard_legal_matter_state_write();

CREATE OR REPLACE FUNCTION public.log_legal_matter_status_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.legal_matter_status_history(legal_matter_id,from_status,to_status,changed_by_type,reason)
  VALUES(NEW.id,NULL,NEW.status,'system','Matter opened');
 ELSIF NEW.status IS DISTINCT FROM OLD.status AND COALESCE(current_setting('app.legal_command',true),'') <> 'transition' THEN
  INSERT INTO public.legal_matter_status_history(legal_matter_id,from_status,to_status,changed_by_type)
  VALUES(NEW.id,OLD.status,NEW.status,'system');
 END IF; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.transition_legal_matter(
 _matter_id uuid, _expected_version bigint, _from public.legal_matter_status, _to public.legal_matter_status,
 _reason text, _actor_type text, _actor_solicitor_user_id uuid DEFAULT NULL, _actor_staff_user_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.legal_matters%ROWTYPE; h_id uuid; BEGIN
 IF NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='REASON_REQUIRED'; END IF;
 SELECT * INTO m FROM public.legal_matters WHERE id=_matter_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='MATTER_NOT_FOUND'; END IF;
 IF m.row_version <> _expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF;
 IF m.status <> _from THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_STATUS'; END IF;
 IF NOT public.is_legal_matter_transition_allowed(_from,_to) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_TRANSITION'; END IF;
 PERFORM set_config('app.legal_command','transition',true);
 UPDATE public.legal_matters SET status=_to, row_version=row_version+1,
  actual_settlement_date=CASE WHEN _to='settled' THEN COALESCE(actual_settlement_date,current_date) ELSE actual_settlement_date END,
  updated_at=now() WHERE id=_matter_id RETURNING * INTO m;
 INSERT INTO public.legal_matter_status_history(legal_matter_id,from_status,to_status,changed_by_type,changed_by_solicitor_user_id,changed_by_user_id,reason,metadata)
 VALUES(_matter_id,_from,_to,_actor_type,_actor_solicitor_user_id,_actor_staff_user_id,left(trim(_reason),1000),jsonb_build_object('row_version',m.row_version)) RETURNING id INTO h_id;
 INSERT INTO public.legal_matter_audit_events(legal_matter_id,client_id,firm_id,actor_type,actor_solicitor_user_id,actor_staff_user_id,severity,category,action,description,metadata)
 VALUES(m.id,m.client_id,m.firm_id,_actor_type,_actor_solicitor_user_id,_actor_staff_user_id,'notice','matter','matter_status_transitioned',left(trim(_reason),1000),jsonb_build_object('from',_from,'to',_to,'row_version',m.row_version,'history_id',h_id));
 RETURN to_jsonb(m);
END $$;

CREATE OR REPLACE FUNCTION public.close_legal_matter(
 _matter_id uuid,_expected_version bigint,_retention_class text,_reason text,_actor_solicitor_user_id uuid,
 _actor_staff_user_id uuid DEFAULT NULL,_override_authorized boolean DEFAULT false,_override_category text DEFAULT NULL,
 _override_step_up_verified_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.legal_matters%ROWTYPE; blockers jsonb; blocker_count integer; BEGIN
 IF NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='REASON_REQUIRED'; END IF;
 IF _retention_class NOT IN ('standard_7y','extended_15y','permanent','legal_hold') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_RETENTION_CLASS'; END IF;
 SELECT * INTO m FROM public.legal_matters WHERE id=_matter_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='MATTER_NOT_FOUND'; END IF;
 IF m.row_version <> _expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF;
 SELECT jsonb_build_object(
  'critical_dates',(SELECT count(*) FROM public.legal_matter_critical_dates WHERE legal_matter_id=m.id AND status<>'satisfied'),
  'settlement_tasks',(SELECT count(*) FROM public.legal_matter_settlement_tasks WHERE legal_matter_id=m.id AND status<>'complete'),
  'disbursements',(SELECT count(*) FROM public.legal_matter_disbursements WHERE legal_matter_id=m.id AND status<>'paid'),
  'requisitions',(SELECT count(*) FROM public.legal_matter_requisitions WHERE legal_matter_id=m.id AND status<>'answered'),
  'conflict_check',CASE WHEN m.conflict_check_status IN ('clear','waived') THEN 0 ELSE 1 END
 ) INTO blockers;
 SELECT sum((value::text)::int) INTO blocker_count FROM jsonb_each(blockers);
 IF blocker_count>0 AND NOT (_override_authorized AND _actor_staff_user_id IS NOT NULL AND NULLIF(trim(_override_category),'') IS NOT NULL AND _override_step_up_verified_at >= now()-interval '15 minutes') THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CLOSURE_BLOCKED',DETAIL=blockers::text;
 END IF;
 IF m.status NOT IN ('settled','post_settlement','terminated') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_CLOSURE_STATUS'; END IF;
 PERFORM set_config('app.legal_command','closure',true);
 UPDATE public.legal_matters SET closure_status='closed',closure_reason=left(trim(_reason),1000),closed_at=now(),closed_by_type=CASE WHEN _actor_staff_user_id IS NULL THEN 'solicitor_user' ELSE 'staff' END,closed_by_solicitor_user_id=_actor_solicitor_user_id,retention_class=_retention_class,retention_until=CASE WHEN _retention_class='standard_7y' THEN current_date+interval '7 years' WHEN _retention_class='extended_15y' THEN current_date+interval '15 years' ELSE NULL END,row_version=row_version+1,updated_at=now() WHERE id=m.id RETURNING * INTO m;
 INSERT INTO public.legal_matter_audit_events(legal_matter_id,client_id,firm_id,actor_type,actor_solicitor_user_id,actor_staff_user_id,severity,category,action,description,metadata)
 VALUES(m.id,m.client_id,m.firm_id,CASE WHEN _actor_staff_user_id IS NULL THEN 'solicitor_user' ELSE 'staff' END,_actor_solicitor_user_id,_actor_staff_user_id,CASE WHEN blocker_count>0 THEN 'critical' ELSE 'notice' END,'closure','matter_closed',left(trim(_reason),1000),jsonb_build_object('blockers',blockers,'override_category',_override_category,'row_version',m.row_version));
 RETURN to_jsonb(m);
END $$;

CREATE OR REPLACE FUNCTION public.reopen_legal_matter(_matter_id uuid,_expected_version bigint,_target_status public.legal_matter_status,_reason text,_actor_solicitor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.legal_matters%ROWTYPE; old_status public.legal_matter_status; BEGIN
 IF _target_status IN ('settled','post_settlement','terminated') OR NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_REOPEN'; END IF;
 SELECT * INTO m FROM public.legal_matters WHERE id=_matter_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='MATTER_NOT_FOUND'; END IF;
 IF m.row_version<>_expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF; old_status:=m.status;
 IF m.closure_status NOT IN ('closed','archived') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='MATTER_NOT_CLOSED'; END IF;
 PERFORM set_config('app.legal_command','transition',true);
 UPDATE public.legal_matters SET status=_target_status,closure_status='open',closure_reason=left(trim(_reason),1000),closed_at=NULL,closed_by_type=NULL,closed_by_solicitor_user_id=NULL,archived_at=NULL,row_version=row_version+1,updated_at=now() WHERE id=m.id RETURNING * INTO m;
 INSERT INTO public.legal_matter_status_history(legal_matter_id,from_status,to_status,changed_by_type,changed_by_solicitor_user_id,reason,metadata) VALUES(m.id,old_status,_target_status,'solicitor_user',_actor_solicitor_user_id,left(trim(_reason),1000),jsonb_build_object('reopened',true,'row_version',m.row_version));
 INSERT INTO public.legal_matter_audit_events(legal_matter_id,client_id,firm_id,actor_type,actor_solicitor_user_id,severity,category,action,description,metadata) VALUES(m.id,m.client_id,m.firm_id,'solicitor_user',_actor_solicitor_user_id,'notice','closure','matter_reopened',left(trim(_reason),1000),jsonb_build_object('from',old_status,'to',_target_status,'row_version',m.row_version));
 RETURN to_jsonb(m);
END $$;

CREATE OR REPLACE FUNCTION public.link_legal_matter_record(_matter_id uuid,_expected_version bigint,_record_type text,_record_id uuid,_actor_staff_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.legal_matters%ROWTYPE; record_client uuid; BEGIN
 SELECT * INTO m FROM public.legal_matters WHERE id=_matter_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='MATTER_NOT_FOUND'; END IF;
 IF m.row_version<>_expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF;
 IF _record_type='purchase_file' THEN SELECT client_id INTO record_client FROM public.purchase_files WHERE id=_record_id FOR UPDATE; ELSIF _record_type='client_deal' THEN SELECT client_id INTO record_client FROM public.client_deals WHERE id=_record_id FOR UPDATE; ELSE RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_RECORD_TYPE'; END IF;
 IF record_client IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECORD_NOT_FOUND'; END IF;
 IF record_client IS DISTINCT FROM m.client_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CROSS_CLIENT_LINK'; END IF;
 IF _record_type='purchase_file' AND EXISTS(SELECT 1 FROM public.legal_matters WHERE purchase_file_id=_record_id AND id<>m.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECORD_ALREADY_LINKED'; END IF;
 IF _record_type='client_deal' AND EXISTS(SELECT 1 FROM public.legal_matters WHERE client_deal_id=_record_id AND id<>m.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECORD_ALREADY_LINKED'; END IF;
 UPDATE public.legal_matters SET purchase_file_id=CASE WHEN _record_type='purchase_file' THEN _record_id ELSE purchase_file_id END,client_deal_id=CASE WHEN _record_type='client_deal' THEN _record_id ELSE client_deal_id END,row_version=row_version+1,updated_at=now() WHERE id=m.id RETURNING * INTO m;
 INSERT INTO public.legal_matter_audit_events(legal_matter_id,client_id,firm_id,actor_type,actor_staff_user_id,severity,category,action,target_type,target_id,metadata) VALUES(m.id,m.client_id,m.firm_id,'staff',_actor_staff_user_id,'notice','admin','matter_record_linked',_record_type,_record_id,jsonb_build_object('row_version',m.row_version)); RETURN to_jsonb(m);
END $$;

CREATE OR REPLACE FUNCTION public.unlink_legal_matter_record(_matter_id uuid,_expected_version bigint,_record_type text,_actor_staff_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.legal_matters%ROWTYPE; old_id uuid; BEGIN
 SELECT * INTO m FROM public.legal_matters WHERE id=_matter_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='MATTER_NOT_FOUND'; END IF;
 IF m.row_version<>_expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF;
 IF _record_type='purchase_file' THEN old_id:=m.purchase_file_id; UPDATE public.legal_matters SET purchase_file_id=NULL,row_version=row_version+1,updated_at=now() WHERE id=m.id RETURNING * INTO m;
 ELSIF _record_type='client_deal' THEN old_id:=m.client_deal_id; UPDATE public.legal_matters SET client_deal_id=NULL,row_version=row_version+1,updated_at=now() WHERE id=m.id RETURNING * INTO m;
 ELSE RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_RECORD_TYPE'; END IF;
 INSERT INTO public.legal_matter_audit_events(legal_matter_id,client_id,firm_id,actor_type,actor_staff_user_id,severity,category,action,target_type,target_id,metadata)
 VALUES(m.id,m.client_id,m.firm_id,'staff',_actor_staff_user_id,'notice','admin','matter_record_unlinked',_record_type,old_id,jsonb_build_object('row_version',m.row_version)); RETURN to_jsonb(m);
END $$;

REVOKE ALL ON FUNCTION public.transition_legal_matter(uuid,bigint,public.legal_matter_status,public.legal_matter_status,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.close_legal_matter(uuid,bigint,text,text,uuid,uuid,boolean,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reopen_legal_matter(uuid,bigint,public.legal_matter_status,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.link_legal_matter_record(uuid,bigint,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.unlink_legal_matter_record(uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transition_legal_matter(uuid,bigint,public.legal_matter_status,public.legal_matter_status,text,text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_legal_matter(uuid,bigint,text,text,uuid,uuid,boolean,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_legal_matter(uuid,bigint,public.legal_matter_status,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_legal_matter_record(uuid,bigint,text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlink_legal_matter_record(uuid,bigint,text,uuid) TO service_role;
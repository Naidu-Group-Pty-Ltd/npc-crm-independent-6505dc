-- Phase 8: canonical participant-based conversations and durable notification delivery.
CREATE TABLE IF NOT EXISTS public.conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
 scope text NOT NULL CHECK(scope IN ('npc_solicitor','client_solicitor','finance_solicitor','case_all_parties','firm_internal','npc_internal')),
 subject text NOT NULL, firm_id uuid REFERENCES public.solicitor_firms(id) ON DELETE SET NULL,
 created_by_type text NOT NULL, created_by_id uuid, is_archived boolean NOT NULL DEFAULT false,
 row_version bigint NOT NULL DEFAULT 1, last_message_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE NULLS NOT DISTINCT(case_id,scope,firm_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_case ON public.conversations(case_id,last_message_at DESC,id);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 participant_type text NOT NULL CHECK(participant_type IN ('solicitor_user','command_user','client_user','finance_user','firm','system')),
 participant_id uuid NOT NULL, role text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member','observer')),
 can_post boolean NOT NULL DEFAULT true, joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz,
 added_by_type text NOT NULL DEFAULT 'system', added_by_id uuid,
 UNIQUE(conversation_id,participant_type,participant_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_participant_lookup ON public.conversation_participants(participant_type,participant_id,conversation_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS public.messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 sender_participant_id uuid NOT NULL REFERENCES public.conversation_participants(id), sender_type text NOT NULL,
 sender_id uuid, sender_name text, body text NOT NULL CHECK(length(body) BETWEEN 1 AND 8000),
 reply_to_message_id uuid REFERENCES public.messages(id), idempotency_key text NOT NULL UNIQUE,
 legacy_sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(legacy_sources)='array'),
 migration_status text NOT NULL DEFAULT 'canonical' CHECK(migration_status IN ('canonical','migrated','matched_mirror','uncertain_duplicate')),
 migration_duplicate_group_id uuid, correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz, deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id,created_at,id);

CREATE TABLE IF NOT EXISTS public.message_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
 storage_path text NOT NULL, filename text NOT NULL, declared_mime_type text, declared_size_bytes bigint,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(message_id,storage_path)
);

CREATE TABLE IF NOT EXISTS public.message_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
 participant_id uuid NOT NULL REFERENCES public.conversation_participants(id) ON DELETE CASCADE,
 delivered_at timestamptz, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(message_id,participant_id)
);
CREATE INDEX IF NOT EXISTS idx_message_receipts_unread ON public.message_receipts(participant_id,created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), participant_type text NOT NULL, participant_id uuid NOT NULL,
 event_type text NOT NULL, channel text NOT NULL CHECK(channel IN ('in_app','email','push')),
 enabled boolean NOT NULL DEFAULT true, quiet_hours_start time, quiet_hours_end time,
 timezone text NOT NULL DEFAULT 'Australia/Sydney', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(participant_type,participant_id,event_type,channel)
);

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
 participant_id uuid NOT NULL REFERENCES public.conversation_participants(id) ON DELETE CASCADE,
 event_type text NOT NULL, channel text NOT NULL CHECK(channel IN ('in_app','email','push')),
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','processing','delivered','failed','suppressed','dead_lettered')),
 scheduled_for timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz, locked_by text, delivered_at timestamptz, last_error text,
 idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due ON public.notification_deliveries(available_at,scheduled_for,created_at) WHERE status IN ('scheduled','failed');

CREATE TABLE IF NOT EXISTS public.conversation_migration_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issue_type text NOT NULL,
 source_table text NOT NULL, source_id uuid NOT NULL, candidate_message_id uuid REFERENCES public.messages(id),
 details jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
 detected_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 UNIQUE(source_table,source_id,issue_type)
);

ALTER TABLE public.legal_matter_messages ADD COLUMN IF NOT EXISTS canonical_message_id uuid REFERENCES public.messages(id);
ALTER TABLE public.client_portal_messages ADD COLUMN IF NOT EXISTS canonical_message_id uuid REFERENCES public.messages(id);
ALTER TABLE public.finance_portal_messages ADD COLUMN IF NOT EXISTS canonical_message_id uuid REFERENCES public.messages(id);
CREATE INDEX IF NOT EXISTS idx_legal_messages_canonical ON public.legal_matter_messages(canonical_message_id) WHERE canonical_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_messages_canonical ON public.client_portal_messages(canonical_message_id) WHERE canonical_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_messages_canonical ON public.finance_portal_messages(canonical_message_id) WHERE canonical_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_conversation_participant_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$ DECLARE s text; BEGIN
 SELECT scope INTO s FROM public.conversations WHERE id=NEW.conversation_id;
 IF s='firm_internal' AND NEW.participant_type NOT IN ('solicitor_user','firm','system') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FIRM_INTERNAL_PARTICIPANT_FORBIDDEN'; END IF;
 IF s='npc_internal' AND NEW.participant_type NOT IN ('command_user','system') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='NPC_INTERNAL_PARTICIPANT_FORBIDDEN'; END IF;
 IF s='client_solicitor' AND NEW.participant_type NOT IN ('client_user','solicitor_user','system') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CLIENT_SOLICITOR_PARTICIPANT_FORBIDDEN'; END IF;
 IF s='finance_solicitor' AND NEW.participant_type NOT IN ('finance_user','solicitor_user','system') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_SOLICITOR_PARTICIPANT_FORBIDDEN'; END IF;
 IF s='npc_solicitor' AND NEW.participant_type NOT IN ('command_user','solicitor_user','system') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='NPC_SOLICITOR_PARTICIPANT_FORBIDDEN'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_conversation_participant_scope ON public.conversation_participants;
CREATE TRIGGER trg_guard_conversation_participant_scope BEFORE INSERT OR UPDATE ON public.conversation_participants FOR EACH ROW EXECUTE FUNCTION public.guard_conversation_participant_scope();

CREATE OR REPLACE FUNCTION public.next_notification_delivery_time(_start time,_end time,_timezone text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=public AS $$ DECLARE local_now timestamp; target_date date; within boolean; BEGIN
 IF _start IS NULL OR _end IS NULL OR _start=_end THEN RETURN now(); END IF;
 BEGIN local_now:=now() AT TIME ZONE COALESCE(NULLIF(_timezone,''),'Australia/Sydney'); EXCEPTION WHEN invalid_parameter_value THEN local_now:=now() AT TIME ZONE 'Australia/Sydney'; _timezone:='Australia/Sydney'; END;
 within:=CASE WHEN _start<_end THEN local_now::time>=_start AND local_now::time<_end ELSE local_now::time>=_start OR local_now::time<_end END;
 IF NOT within THEN RETURN now(); END IF;
 target_date:=local_now::date+CASE WHEN _start>_end AND local_now::time>=_start THEN 1 ELSE 0 END;
 RETURN (target_date+_end+interval '1 minute') AT TIME ZONE COALESCE(NULLIF(_timezone,''),'Australia/Sydney');
END $$;

CREATE OR REPLACE FUNCTION public.ensure_case_conversation(_case_id uuid,_scope text,_actor_type text,_actor_id uuid,_subject text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.conversations%ROWTYPE; l public.transaction_case_links%ROWTYPE; case_client uuid; matter_firm uuid; finance_assignee uuid; actor_allowed boolean:=false; BEGIN
 IF _scope NOT IN ('npc_solicitor','client_solicitor','finance_solicitor','case_all_parties','firm_internal','npc_internal') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_CONVERSATION_SCOPE'; END IF;
 SELECT client_id INTO case_client FROM public.transaction_cases WHERE id=_case_id; IF case_client IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CASE_NOT_FOUND'; END IF;
 SELECT * INTO l FROM public.transaction_case_links WHERE case_id=_case_id;
 SELECT firm_id INTO matter_firm FROM public.legal_matters WHERE id=l.legal_matter_id;
 SELECT assigned_finance_user_id INTO finance_assignee FROM public.purchase_files WHERE id=l.purchase_file_id;
 actor_allowed:=CASE _actor_type
  WHEN 'solicitor_user' THEN EXISTS(SELECT 1 FROM public.solicitor_matter_access a WHERE a.solicitor_user_id=_actor_id AND a.legal_matter_id=l.legal_matter_id AND a.firm_id=matter_firm AND a.revoked_at IS NULL AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now()))
  WHEN 'finance_user' THEN finance_assignee=_actor_id
  WHEN 'client_user' THEN EXISTS(SELECT 1 FROM public.client_portal_users u WHERE u.id=_actor_id AND u.client_id=case_client AND u.status='active')
  WHEN 'command_user' THEN EXISTS(SELECT 1 FROM public.custom_users u WHERE u.id=_actor_id)
  ELSE false END;
 IF NOT actor_allowed THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CONVERSATION_ACCESS_DENIED'; END IF;
 IF _scope='firm_internal' AND _actor_type<>'solicitor_user' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CONVERSATION_ACCESS_DENIED'; END IF;
 IF _scope='npc_internal' AND _actor_type<>'command_user' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CONVERSATION_ACCESS_DENIED'; END IF;
 INSERT INTO public.conversations(case_id,scope,subject,firm_id,created_by_type,created_by_id)
 VALUES(_case_id,_scope,COALESCE(NULLIF(trim(_subject),''),initcap(replace(_scope,'_',' '))),CASE WHEN _scope IN ('firm_internal','client_solicitor','finance_solicitor','npc_solicitor') THEN matter_firm END,_actor_type,_actor_id)
 ON CONFLICT(case_id,scope,firm_id) DO UPDATE SET updated_at=public.conversations.updated_at RETURNING * INTO c;
 -- Exact case participants; Finance never falls back to a client-level or first assignment.
 IF _scope IN ('client_solicitor','finance_solicitor','npc_solicitor','case_all_parties','firm_internal') THEN
  INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,added_by_type,added_by_id)
  SELECT c.id,'solicitor_user',a.solicitor_user_id,'system',_actor_id FROM public.solicitor_matter_access a
  JOIN public.solicitor_portal_users u ON u.id=a.solicitor_user_id AND u.is_active=true
  WHERE a.legal_matter_id=l.legal_matter_id AND a.firm_id=matter_firm AND a.revoked_at IS NULL AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())
  ON CONFLICT(conversation_id,participant_type,participant_id) DO UPDATE SET left_at=NULL;
 END IF;
 IF _scope IN ('client_solicitor','case_all_parties') THEN
  INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,added_by_type,added_by_id)
  SELECT c.id,'client_user',u.id,'system',_actor_id FROM public.client_portal_users u WHERE u.client_id=case_client AND u.status='active'
  ON CONFLICT(conversation_id,participant_type,participant_id) DO UPDATE SET left_at=NULL;
 END IF;
 IF _scope IN ('finance_solicitor','case_all_parties') AND finance_assignee IS NOT NULL THEN
  INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,added_by_type,added_by_id)
  SELECT c.id,'finance_user',u.id,'system',_actor_id FROM public.finance_portal_users u WHERE u.id=finance_assignee AND u.is_active=true AND u.revoked_at IS NULL
  ON CONFLICT(conversation_id,participant_type,participant_id) DO UPDATE SET left_at=NULL;
 END IF;
 IF _scope IN ('npc_solicitor','case_all_parties') THEN
  INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,added_by_type,added_by_id)
  SELECT c.id,'command_user',cl.assigned_team_user_id,'system',_actor_id FROM public.clients cl WHERE cl.id=case_client AND cl.assigned_team_user_id IS NOT NULL
  ON CONFLICT(conversation_id,participant_type,participant_id) DO UPDATE SET left_at=NULL;
 END IF;
 INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,role,can_post,added_by_type,added_by_id)
 VALUES(c.id,_actor_type,_actor_id,'member',true,'authenticated_command',_actor_id)
 ON CONFLICT(conversation_id,participant_type,participant_id) DO UPDATE SET left_at=NULL,can_post=true;
 RETURN jsonb_build_object('conversation',to_jsonb(c),'participants',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.conversation_participants p WHERE p.conversation_id=c.id AND p.left_at IS NULL),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.queue_message_notifications() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE p record; ch text; pref record; schedule_at timestamptz; participant_current boolean; BEGIN
 INSERT INTO public.message_receipts(message_id,participant_id,delivered_at,read_at)
 SELECT NEW.id,p.id,CASE WHEN p.id=NEW.sender_participant_id THEN NEW.created_at END,CASE WHEN p.id=NEW.sender_participant_id THEN NEW.created_at END
 FROM public.conversation_participants p WHERE p.conversation_id=NEW.conversation_id AND (p.left_at IS NULL OR p.id=NEW.sender_participant_id) ON CONFLICT DO NOTHING;
 IF NEW.migration_status<>'canonical' THEN
  UPDATE public.conversations SET last_message_at=GREATEST(COALESCE(last_message_at,NEW.created_at),NEW.created_at),updated_at=now() WHERE id=NEW.conversation_id;
  RETURN NEW;
 END IF;
 FOR p IN SELECT * FROM public.conversation_participants WHERE conversation_id=NEW.conversation_id AND left_at IS NULL AND id<>NEW.sender_participant_id LOOP
  SELECT CASE p.participant_type
   WHEN 'solicitor_user' THEN EXISTS(SELECT 1 FROM public.conversations c JOIN public.transaction_case_links l ON l.case_id=c.case_id JOIN public.solicitor_matter_access a ON a.legal_matter_id=l.legal_matter_id WHERE c.id=NEW.conversation_id AND a.solicitor_user_id=p.participant_id AND a.revoked_at IS NULL AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now()))
   WHEN 'finance_user' THEN EXISTS(SELECT 1 FROM public.conversations c JOIN public.transaction_case_links l ON l.case_id=c.case_id JOIN public.purchase_files f ON f.id=l.purchase_file_id WHERE c.id=NEW.conversation_id AND f.assigned_finance_user_id=p.participant_id)
   WHEN 'client_user' THEN EXISTS(SELECT 1 FROM public.conversations c JOIN public.transaction_cases tc ON tc.id=c.case_id JOIN public.client_portal_users u ON u.client_id=tc.client_id WHERE c.id=NEW.conversation_id AND u.id=p.participant_id AND u.status='active')
   ELSE true END INTO participant_current;
  IF NOT participant_current THEN CONTINUE; END IF;
  FOREACH ch IN ARRAY ARRAY['in_app','email','push'] LOOP
   SELECT * INTO pref FROM public.notification_preferences WHERE participant_type=p.participant_type AND participant_id=p.participant_id AND event_type='conversation_message' AND channel=ch;
   IF ch<>'in_app' AND NOT FOUND THEN CONTINUE; END IF;
   IF FOUND AND NOT pref.enabled THEN
    INSERT INTO public.notification_deliveries(message_id,participant_id,event_type,channel,status,idempotency_key) VALUES(NEW.id,p.id,'conversation_message',ch,'suppressed','message:'||NEW.id||':participant:'||p.id||':'||ch) ON CONFLICT DO NOTHING; CONTINUE;
   END IF;
   schedule_at:=CASE WHEN FOUND THEN public.next_notification_delivery_time(pref.quiet_hours_start,pref.quiet_hours_end,pref.timezone) ELSE now() END;
   INSERT INTO public.notification_deliveries(message_id,participant_id,event_type,channel,status,scheduled_for,available_at,idempotency_key)
   VALUES(NEW.id,p.id,'conversation_message',ch,'scheduled',schedule_at,schedule_at,'message:'||NEW.id||':participant:'||p.id||':'||ch) ON CONFLICT DO NOTHING;
  END LOOP;
 END LOOP;
 UPDATE public.conversations SET last_message_at=NEW.created_at,row_version=row_version+1,updated_at=now() WHERE id=NEW.conversation_id;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_queue_message_notifications ON public.messages;
CREATE TRIGGER trg_queue_message_notifications AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.queue_message_notifications();

CREATE OR REPLACE FUNCTION public.sync_finance_conversation_participant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE case_uuid uuid; BEGIN
 SELECT case_id INTO case_uuid FROM public.transaction_case_links WHERE purchase_file_id=NEW.id;
 IF case_uuid IS NULL OR NEW.assigned_finance_user_id IS NOT DISTINCT FROM OLD.assigned_finance_user_id THEN RETURN NEW; END IF;
 IF OLD.assigned_finance_user_id IS NOT NULL THEN UPDATE public.conversation_participants p SET left_at=now(),can_post=false FROM public.conversations c WHERE p.conversation_id=c.id AND c.case_id=case_uuid AND c.scope IN ('finance_solicitor','case_all_parties') AND p.participant_type='finance_user' AND p.participant_id=OLD.assigned_finance_user_id AND p.left_at IS NULL; END IF;
 IF NEW.assigned_finance_user_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.finance_portal_users u WHERE u.id=NEW.assigned_finance_user_id AND u.is_active AND u.revoked_at IS NULL) THEN INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,added_by_type) SELECT c.id,'finance_user',NEW.assigned_finance_user_id,'assignment_sync' FROM public.conversations c WHERE c.case_id=case_uuid AND c.scope IN ('finance_solicitor','case_all_parties') ON CONFLICT(conversation_id,participant_type,participant_id) DO UPDATE SET left_at=NULL,can_post=true; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_finance_conversation_participant ON public.purchase_files;
CREATE TRIGGER trg_sync_finance_conversation_participant AFTER UPDATE OF assigned_finance_user_id ON public.purchase_files FOR EACH ROW EXECUTE FUNCTION public.sync_finance_conversation_participant();

CREATE OR REPLACE FUNCTION public.sync_solicitor_conversation_participant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE case_uuid uuid; active_grant boolean; BEGIN
 SELECT case_id INTO case_uuid FROM public.transaction_case_links WHERE legal_matter_id=NEW.legal_matter_id; IF case_uuid IS NULL THEN RETURN NEW; END IF;
 active_grant:=NEW.revoked_at IS NULL AND NEW.valid_from<=now() AND (NEW.valid_until IS NULL OR NEW.valid_until>now());
 IF active_grant THEN INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,added_by_type) SELECT c.id,'solicitor_user',NEW.solicitor_user_id,'matter_access_sync' FROM public.conversations c WHERE c.case_id=case_uuid AND c.scope IN ('npc_solicitor','client_solicitor','finance_solicitor','case_all_parties','firm_internal') ON CONFLICT(conversation_id,participant_type,participant_id) DO UPDATE SET left_at=NULL,can_post=true;
 ELSE UPDATE public.conversation_participants p SET left_at=now(),can_post=false FROM public.conversations c WHERE p.conversation_id=c.id AND c.case_id=case_uuid AND p.participant_type='solicitor_user' AND p.participant_id=NEW.solicitor_user_id AND p.left_at IS NULL; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_solicitor_conversation_participant ON public.solicitor_matter_access;
CREATE TRIGGER trg_sync_solicitor_conversation_participant AFTER INSERT OR UPDATE ON public.solicitor_matter_access FOR EACH ROW EXECUTE FUNCTION public.sync_solicitor_conversation_participant();

CREATE OR REPLACE FUNCTION public.post_conversation_message(_conversation_id uuid,_actor_type text,_actor_id uuid,_body text,_idempotency_key text,_sender_name text DEFAULT NULL,_reply_to uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE p public.conversation_participants%ROWTYPE; m public.messages%ROWTYPE; BEGIN
 SELECT * INTO p FROM public.conversation_participants WHERE conversation_id=_conversation_id AND participant_type=_actor_type AND participant_id=_actor_id AND left_at IS NULL AND can_post=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CONVERSATION_ACCESS_DENIED'; END IF;
 IF NULLIF(trim(_body),'') IS NULL OR length(trim(_body))>8000 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_MESSAGE_BODY'; END IF;
 IF _reply_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.messages WHERE id=_reply_to AND conversation_id=_conversation_id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_REPLY_TARGET'; END IF;
 INSERT INTO public.messages(conversation_id,sender_participant_id,sender_type,sender_id,sender_name,body,reply_to_message_id,idempotency_key)
 VALUES(_conversation_id,p.id,_actor_type,_actor_id,_sender_name,trim(_body),_reply_to,_idempotency_key)
 ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING * INTO m;
 PERFORM public.enqueue_integration_event('conversation',_conversation_id,'conversation.message.created',1,jsonb_build_object('conversation_id',_conversation_id,'message_id',m.id),'conversation_message:'||m.id,NULL);
 RETURN to_jsonb(m);
END $$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conversation_id uuid,_actor_type text,_actor_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE participant uuid; affected integer; BEGIN
 SELECT id INTO participant FROM public.conversation_participants WHERE conversation_id=_conversation_id AND participant_type=_actor_type AND participant_id=_actor_id AND left_at IS NULL;
 IF participant IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CONVERSATION_ACCESS_DENIED'; END IF;
 UPDATE public.message_receipts r SET delivered_at=COALESCE(r.delivered_at,now()),read_at=now() FROM public.messages m WHERE r.message_id=m.id AND m.conversation_id=_conversation_id AND r.participant_id=participant AND r.read_at IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
END $$;

CREATE OR REPLACE FUNCTION public.attach_conversation_message(_message_id uuid,_actor_type text,_actor_id uuid,_storage_path text,_filename text,_declared_mime text,_declared_size bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE a public.message_attachments%ROWTYPE; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.messages m JOIN public.conversation_participants p ON p.conversation_id=m.conversation_id WHERE m.id=_message_id AND p.participant_type=_actor_type AND p.participant_id=_actor_id AND p.left_at IS NULL AND p.can_post) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CONVERSATION_ACCESS_DENIED'; END IF;
 IF NULLIF(trim(_storage_path),'') IS NULL OR NULLIF(trim(_filename),'') IS NULL OR _declared_size<0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_ATTACHMENT_METADATA'; END IF;
 INSERT INTO public.message_attachments(message_id,storage_path,filename,declared_mime_type,declared_size_bytes) VALUES(_message_id,_storage_path,left(_filename,255),left(_declared_mime,255),_declared_size) RETURNING * INTO a; RETURN to_jsonb(a);
END $$;

CREATE OR REPLACE FUNCTION public.get_participant_conversations(_participant_type text,_participant_id uuid,_case_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('conversation',to_jsonb(c),'participant',to_jsonb(p),'unread_count',(SELECT count(*) FROM public.message_receipts r JOIN public.messages m ON m.id=r.message_id WHERE m.conversation_id=c.id AND r.participant_id=p.id AND r.read_at IS NULL)) ORDER BY c.last_message_at DESC NULLS LAST,c.created_at DESC),'[]'::jsonb)
 FROM public.conversation_participants p JOIN public.conversations c ON c.id=p.conversation_id
 WHERE p.participant_type=_participant_type AND p.participant_id=_participant_id AND p.left_at IS NULL AND (_case_id IS NULL OR c.case_id=_case_id);
$$;

CREATE OR REPLACE FUNCTION public.get_conversation_messages(_conversation_id uuid,_participant_type text,_participant_id uuid,_limit integer DEFAULT 100,_before timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.conversation_participants p WHERE p.conversation_id=_conversation_id AND p.participant_type=_participant_type AND p.participant_id=_participant_id AND p.left_at IS NULL)
 THEN COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at,x.id) FROM (SELECT m.* FROM public.messages m WHERE m.conversation_id=_conversation_id AND m.deleted_at IS NULL AND (_before IS NULL OR m.created_at<_before) ORDER BY m.created_at DESC,m.id DESC LIMIT LEAST(GREATEST(_limit,1),200)) x),'[]'::jsonb)
 ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION public.get_participant_notifications(_participant_type text,_participant_id uuid,_limit integer DEFAULT 50,_unread_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb) FROM (
  SELECT d.id,m.id message_id,m.conversation_id,d.event_type notification_type,'New conversation message' title,left(m.body,240) body,NULL::text link_path,jsonb_build_object('scope',c.scope,'case_id',c.case_id) metadata,r.read_at IS NOT NULL is_read,r.read_at,d.created_at,d.status delivery_status
  FROM public.conversation_participants p JOIN public.notification_deliveries d ON d.participant_id=p.id AND d.channel='in_app'
  JOIN public.messages m ON m.id=d.message_id JOIN public.conversations c ON c.id=m.conversation_id JOIN public.message_receipts r ON r.message_id=m.id AND r.participant_id=p.id
  WHERE p.participant_type=_participant_type AND p.participant_id=_participant_id AND p.left_at IS NULL AND (NOT _unread_only OR r.read_at IS NULL)
  ORDER BY d.created_at DESC LIMIT LEAST(GREATEST(_limit,1),200)
 ) x;
$$;

CREATE OR REPLACE FUNCTION public.mark_message_read(_message_id uuid,_participant_type text,_participant_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE participant uuid; BEGIN
 SELECT p.id INTO participant FROM public.conversation_participants p JOIN public.messages m ON m.conversation_id=p.conversation_id WHERE m.id=_message_id AND p.participant_type=_participant_type AND p.participant_id=_participant_id AND p.left_at IS NULL;
 IF participant IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CONVERSATION_ACCESS_DENIED'; END IF;
 UPDATE public.message_receipts SET delivered_at=COALESCE(delivered_at,now()),read_at=now() WHERE message_id=_message_id AND participant_id=participant; RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.claim_notification_deliveries(_worker_id text,_limit integer DEFAULT 50)
RETURNS SETOF public.notification_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 RETURN QUERY WITH due AS (SELECT id FROM public.notification_deliveries WHERE status IN ('scheduled','failed') AND available_at<=now() AND scheduled_for<=now() AND (locked_at IS NULL OR locked_at<now()-interval '5 minutes') ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(_limit,1),200))
 UPDATE public.notification_deliveries d SET status='processing',attempts=d.attempts+1,locked_at=now(),locked_by=_worker_id,updated_at=now() FROM due WHERE d.id=due.id RETURNING d.*;
END $$;

-- Deterministic legal-thread backfill retains canonical IDs and known mirror provenance.
INSERT INTO public.conversations(id,case_id,scope,subject,firm_id,created_by_type,created_by_id,is_archived,last_message_at,created_at,updated_at)
SELECT t.id,l.case_id,CASE t.scope::text WHEN 'solicitor_npc' THEN 'npc_solicitor' WHEN 'solicitor_client' THEN 'client_solicitor' WHEN 'solicitor_finance' THEN 'finance_solicitor' ELSE 'firm_internal' END,t.subject,t.firm_id,'system',t.created_by,t.is_archived,t.last_message_at,t.created_at,t.updated_at
FROM public.legal_matter_threads t JOIN public.transaction_case_links l ON l.legal_matter_id=t.legal_matter_id ON CONFLICT(id) DO NOTHING;

INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,role,can_post,added_by_type)
SELECT DISTINCT c.id,'solicitor_user',a.solicitor_user_id,'member',true,'migration' FROM public.conversations c JOIN public.transaction_case_links l ON l.case_id=c.case_id JOIN public.solicitor_matter_access a ON a.legal_matter_id=l.legal_matter_id WHERE a.revoked_at IS NULL ON CONFLICT DO NOTHING;
INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,role,can_post,added_by_type)
SELECT DISTINCT c.id,'client_user',u.id,'member',true,'migration' FROM public.conversations c JOIN public.transaction_cases tc ON tc.id=c.case_id JOIN public.client_portal_users u ON u.client_id=tc.client_id AND u.status='active' WHERE c.scope IN ('client_solicitor','case_all_parties') ON CONFLICT DO NOTHING;
INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,role,can_post,added_by_type)
SELECT DISTINCT c.id,'finance_user',p.assigned_finance_user_id,'member',true,'migration' FROM public.conversations c JOIN public.transaction_case_links l ON l.case_id=c.case_id JOIN public.purchase_files p ON p.id=l.purchase_file_id WHERE c.scope IN ('finance_solicitor','case_all_parties') AND p.assigned_finance_user_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,role,can_post,added_by_type)
SELECT DISTINCT c.id,'command_user',cl.assigned_team_user_id,'member',true,'migration' FROM public.conversations c JOIN public.transaction_cases tc ON tc.id=c.case_id JOIN public.clients cl ON cl.id=tc.client_id WHERE c.scope IN ('npc_solicitor','case_all_parties') AND cl.assigned_team_user_id IS NOT NULL ON CONFLICT DO NOTHING;

-- Historical senders remain attributable even when they are no longer active participants.
INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,role,can_post,left_at,added_by_type)
SELECT DISTINCT m.thread_id,'solicitor_user',m.sender_solicitor_user_id,'observer',false,now(),'migration' FROM public.legal_matter_messages m JOIN public.conversations c ON c.id=m.thread_id WHERE m.sender_solicitor_user_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,role,can_post,left_at,added_by_type)
SELECT DISTINCT m.thread_id,'command_user',m.sender_staff_user_id,'observer',false,now(),'migration' FROM public.legal_matter_messages m JOIN public.conversations c ON c.id=m.thread_id WHERE m.sender_staff_user_id IS NOT NULL AND c.scope IN ('npc_solicitor','case_all_parties') ON CONFLICT DO NOTHING;
INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,role,can_post,left_at,added_by_type)
SELECT DISTINCT m.thread_id,'client_user',m.sender_client_portal_user_id,'observer',false,now(),'migration' FROM public.legal_matter_messages m JOIN public.conversations c ON c.id=m.thread_id WHERE m.sender_client_portal_user_id IS NOT NULL AND c.scope IN ('client_solicitor','case_all_parties') ON CONFLICT DO NOTHING;
INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,role,can_post,left_at,added_by_type)
SELECT DISTINCT m.thread_id,'finance_user',m.sender_finance_user_id,'observer',false,now(),'migration' FROM public.legal_matter_messages m JOIN public.conversations c ON c.id=m.thread_id WHERE m.sender_finance_user_id IS NOT NULL AND c.scope IN ('finance_solicitor','case_all_parties') ON CONFLICT DO NOTHING;
INSERT INTO public.conversation_participants(conversation_id,participant_type,participant_id,role,can_post,added_by_type)
SELECT c.id,'system',c.id,'observer',false,'migration' FROM public.conversations c ON CONFLICT DO NOTHING;

INSERT INTO public.messages(id,conversation_id,sender_participant_id,sender_type,sender_id,sender_name,body,idempotency_key,legacy_sources,migration_status,created_at)
SELECT m.id,m.thread_id,p.id,p.participant_type,p.participant_id,m.sender_name,m.body,'legacy_legal_message:'||m.id,
 jsonb_strip_nulls(jsonb_build_array(jsonb_build_object('table','legal_matter_messages','id',m.id),CASE WHEN m.mirrored_client_message_id IS NOT NULL THEN jsonb_build_object('table','client_portal_messages','id',m.mirrored_client_message_id) END,CASE WHEN m.mirrored_finance_message_id IS NOT NULL THEN jsonb_build_object('table','finance_portal_messages','id',m.mirrored_finance_message_id) END)),
 CASE WHEN m.mirrored_client_message_id IS NOT NULL OR m.mirrored_finance_message_id IS NOT NULL THEN 'matched_mirror' ELSE 'migrated' END,m.created_at
FROM public.legal_matter_messages m JOIN public.conversations c ON c.id=m.thread_id
JOIN LATERAL (SELECT cp.* FROM public.conversation_participants cp WHERE cp.conversation_id=c.id AND cp.participant_type=CASE m.sender_type::text WHEN 'solicitor_user' THEN 'solicitor_user' WHEN 'staff' THEN 'command_user' WHEN 'client' THEN 'client_user' WHEN 'finance_partner' THEN 'finance_user' ELSE 'system' END AND (CASE m.sender_type::text WHEN 'solicitor_user' THEN m.sender_solicitor_user_id WHEN 'staff' THEN m.sender_staff_user_id WHEN 'client' THEN m.sender_client_portal_user_id WHEN 'finance_partner' THEN m.sender_finance_user_id ELSE cp.participant_id END)=cp.participant_id LIMIT 1) p ON true
ON CONFLICT(id) DO NOTHING;

UPDATE public.legal_matter_messages l SET canonical_message_id=m.id FROM public.messages m WHERE m.id=l.id AND l.canonical_message_id IS DISTINCT FROM m.id;
UPDATE public.client_portal_messages c SET canonical_message_id=l.id FROM public.legal_matter_messages l WHERE l.mirrored_client_message_id=c.id AND l.canonical_message_id=l.id AND c.canonical_message_id IS DISTINCT FROM l.id;
UPDATE public.finance_portal_messages f SET canonical_message_id=l.id FROM public.legal_matter_messages l WHERE l.mirrored_finance_message_id=f.id AND l.canonical_message_id=l.id AND f.canonical_message_id IS DISTINCT FROM l.id;

-- Known mirrors are reconciled; unmatched copies remain untouched and visible to operators.
INSERT INTO public.conversation_migration_issues(issue_type,source_table,source_id,candidate_message_id,details)
SELECT 'uncertain_historical_mirror','client_portal_messages',cp.id,NULL,jsonb_build_object('client_id',cp.client_id,'created_at',cp.created_at,'reason','no explicit legal mirror id') FROM public.client_portal_messages cp
WHERE NOT EXISTS(SELECT 1 FROM public.legal_matter_messages lm WHERE lm.mirrored_client_message_id=cp.id) ON CONFLICT DO NOTHING;
INSERT INTO public.conversation_migration_issues(issue_type,source_table,source_id,candidate_message_id,details)
SELECT 'uncertain_historical_mirror','finance_portal_messages',fp.id,NULL,jsonb_build_object('client_id',fp.client_id,'thread_id',fp.thread_id,'created_at',fp.created_at,'reason','no explicit legal mirror id') FROM public.finance_portal_messages fp
WHERE NOT EXISTS(SELECT 1 FROM public.legal_matter_messages lm WHERE lm.mirrored_finance_message_id=fp.id) ON CONFLICT DO NOTHING;

INSERT INTO public.notification_preferences(participant_type,participant_id,event_type,channel,enabled,quiet_hours_start,quiet_hours_end,timezone)
SELECT 'solicitor_user',p.solicitor_user_id,p.event_type,ch,p.is_enabled,p.quiet_hours_start,p.quiet_hours_end,p.timezone
FROM public.solicitor_notification_prefs p CROSS JOIN LATERAL unnest(p.channels) ch WHERE ch IN ('in_app','email','push') ON CONFLICT DO NOTHING;
INSERT INTO public.notification_preferences(participant_type,participant_id,event_type,channel,enabled,quiet_hours_start,quiet_hours_end,timezone)
SELECT 'finance_user',u.id,p.event_type,ch,p.is_enabled,p.quiet_hours_start,p.quiet_hours_end,p.timezone
FROM public.finance_partner_notification_prefs p JOIN public.finance_portal_users u ON u.finance_contact_id=p.finance_contact_id
CROSS JOIN LATERAL unnest(p.channels) ch WHERE ch IN ('in_app','email','push') ON CONFLICT DO NOTHING;

GRANT ALL ON public.conversations,public.conversation_participants,public.messages,public.message_attachments,public.message_receipts,public.notification_deliveries,public.notification_preferences,public.conversation_migration_issues TO service_role;
REVOKE ALL ON public.conversations,public.conversation_participants,public.messages,public.message_attachments,public.message_receipts,public.notification_deliveries,public.notification_preferences,public.conversation_migration_issues FROM anon,authenticated;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY; ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY; ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY; ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.message_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY; ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY; ALTER TABLE public.conversation_migration_issues ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['conversations','conversation_participants','messages','message_attachments','message_receipts','notification_deliveries','notification_preferences','conversation_migration_issues'] LOOP EXECUTE format('CREATE POLICY %I_service_role_only ON public.%I FOR ALL TO service_role USING(true) WITH CHECK(true)',table_name,table_name); END LOOP; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
REVOKE ALL ON FUNCTION public.next_notification_delivery_time(time,time,text),public.ensure_case_conversation(uuid,text,text,uuid,text),public.post_conversation_message(uuid,text,uuid,text,text,text,uuid),public.mark_conversation_read(uuid,text,uuid),public.mark_message_read(uuid,text,uuid),public.attach_conversation_message(uuid,text,uuid,text,text,text,bigint),public.get_participant_conversations(text,uuid,uuid),public.get_conversation_messages(uuid,text,uuid,integer,timestamptz),public.get_participant_notifications(text,uuid,integer,boolean),public.claim_notification_deliveries(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.next_notification_delivery_time(time,time,text),public.ensure_case_conversation(uuid,text,text,uuid,text),public.post_conversation_message(uuid,text,uuid,text,text,text,uuid),public.mark_conversation_read(uuid,text,uuid),public.mark_message_read(uuid,text,uuid),public.attach_conversation_message(uuid,text,uuid,text,text,text,bigint),public.get_participant_conversations(text,uuid,uuid),public.get_conversation_messages(uuid,text,uuid,integer,timestamptz),public.get_participant_notifications(text,uuid,integer,boolean),public.claim_notification_deliveries(text,integer) TO service_role;

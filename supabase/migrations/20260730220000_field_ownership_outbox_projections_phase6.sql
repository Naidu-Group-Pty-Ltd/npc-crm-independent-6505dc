-- Phase 6: durable integration events and audience-specific case projections.
CREATE TABLE IF NOT EXISTS public.integration_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aggregate_type text NOT NULL, aggregate_id uuid NOT NULL,
 event_type text NOT NULL, event_version integer NOT NULL DEFAULT 1, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 idempotency_key text NOT NULL UNIQUE, correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
 occurred_at timestamptz NOT NULL DEFAULT now(), available_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz, locked_at timestamptz, locked_by text, attempts integer NOT NULL DEFAULT 0,
 last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integration_outbox_pending ON public.integration_outbox(available_at,occurred_at) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.integration_dead_letters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), outbox_id uuid NOT NULL UNIQUE REFERENCES public.integration_outbox(id),
 aggregate_type text NOT NULL, aggregate_id uuid NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL,
 attempts integer NOT NULL, last_error text NOT NULL, failed_at timestamptz NOT NULL DEFAULT now(),
 replayed_at timestamptz, replayed_by uuid
);
CREATE TABLE IF NOT EXISTS public.projection_checkpoints (
 consumer_name text PRIMARY KEY, last_event_id uuid, last_occurred_at timestamptz, processed_count bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.integration_delivery_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), outbox_id uuid NOT NULL REFERENCES public.integration_outbox(id),
 consumer_name text NOT NULL, attempt_number integer NOT NULL, status text NOT NULL CHECK(status IN ('started','succeeded','failed','deduplicated')),
 error text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(outbox_id,consumer_name,attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_integration_delivery_outbox ON public.integration_delivery_attempts(outbox_id,consumer_name);
CREATE TABLE IF NOT EXISTS public.legal_audit_verification_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id),
 verified boolean NOT NULL, checked integer NOT NULL, broken_at uuid, failure_reason text,
 verified_at timestamptz NOT NULL DEFAULT now(), alerted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_legal_audit_verification_failures ON public.legal_audit_verification_runs(verified_at DESC) WHERE verified=false;

CREATE TABLE IF NOT EXISTS public.client_case_read_model (
 case_id uuid PRIMARY KEY REFERENCES public.transaction_cases(id) ON DELETE CASCADE, client_id uuid NOT NULL,
 friendly_status text NOT NULL, shared_summary text, property_address text, settlement_date date,
 next_client_action text, source_version bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_case_read_model (
 case_id uuid PRIMARY KEY REFERENCES public.transaction_cases(id) ON DELETE CASCADE, client_id uuid NOT NULL,
 finance_status text, lender text, legal_status text, contractual_settlement_date date,
 solicitor_name text, source_version bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.solicitor_case_read_model (
 case_id uuid PRIMARY KEY REFERENCES public.transaction_cases(id) ON DELETE CASCADE, client_id uuid NOT NULL,
 legal_status text, matter_reference text, internal_notes text, finance_status text, lender text,
 source_version bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.command_case_health_read_model (
 case_id uuid PRIMARY KEY REFERENCES public.transaction_cases(id) ON DELETE CASCADE, client_id uuid NOT NULL,
 shared_lifecycle_status text NOT NULL, legal_status text, finance_status text, deal_stage text,
 link_health text NOT NULL, open_issue_count integer NOT NULL DEFAULT 0,
 source_version bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_portal_messages ADD COLUMN IF NOT EXISTS integration_event_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_portal_messages_integration_event ON public.client_portal_messages(integration_event_id) WHERE integration_event_id IS NOT NULL;
ALTER TABLE public.finance_portal_messages ADD COLUMN IF NOT EXISTS integration_event_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_portal_messages_integration_event ON public.finance_portal_messages(integration_event_id) WHERE integration_event_id IS NOT NULL;
ALTER TABLE public.client_portal_notifications ADD COLUMN IF NOT EXISTS integration_event_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_portal_notifications_integration_event ON public.client_portal_notifications(integration_event_id) WHERE integration_event_id IS NOT NULL;
ALTER TABLE public.finance_portal_notifications ADD COLUMN IF NOT EXISTS integration_event_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_portal_notifications_integration_event ON public.finance_portal_notifications(integration_event_id) WHERE integration_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enqueue_integration_event(_aggregate_type text,_aggregate_id uuid,_event_type text,_event_version integer,_payload jsonb,_idempotency_key text,_correlation_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE event_id uuid; BEGIN
 INSERT INTO public.integration_outbox(aggregate_type,aggregate_id,event_type,event_version,payload,idempotency_key,correlation_id)
 VALUES(_aggregate_type,_aggregate_id,_event_type,_event_version,COALESCE(_payload,'{}'::jsonb),_idempotency_key,COALESCE(_correlation_id,gen_random_uuid()))
 ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id INTO event_id; RETURN event_id; END $$;

CREATE OR REPLACE FUNCTION public.enqueue_case_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM public.enqueue_integration_event('transaction_case',NEW.id,'transaction_case.changed',1,jsonb_build_object('case_id',NEW.id,'client_id',NEW.client_id,'row_version',NEW.row_version),'transaction_case:'||NEW.id||':changed:'||NEW.row_version,NULL); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_transaction_case_outbox ON public.transaction_cases;
CREATE TRIGGER trg_transaction_case_outbox AFTER INSERT OR UPDATE ON public.transaction_cases FOR EACH ROW EXECUTE FUNCTION public.enqueue_case_change();

CREATE OR REPLACE FUNCTION public.enqueue_case_link_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM public.enqueue_integration_event('transaction_case',NEW.case_id,'transaction_case.link_changed',1,jsonb_build_object('case_id',NEW.case_id,'history_id',NEW.id,'domain_type',NEW.domain_type,'action',NEW.action),'transaction_case_link:'||NEW.id,NULL); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_transaction_case_link_outbox ON public.transaction_case_link_history;
CREATE TRIGGER trg_transaction_case_link_outbox AFTER INSERT ON public.transaction_case_link_history FOR EACH ROW EXECUTE FUNCTION public.enqueue_case_link_change();

CREATE OR REPLACE FUNCTION public.enqueue_domain_case_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE case_id uuid; record_id uuid; version_key text; BEGIN
 record_id:=NEW.id;
 IF TG_TABLE_NAME='legal_matters' THEN SELECT l.case_id INTO case_id FROM public.transaction_case_links l WHERE l.legal_matter_id=record_id; version_key:=NEW.row_version::text;
 ELSIF TG_TABLE_NAME='purchase_files' THEN SELECT l.case_id INTO case_id FROM public.transaction_case_links l WHERE l.purchase_file_id=record_id; version_key:=extract(epoch from NEW.updated_at)::text;
 ELSIF TG_TABLE_NAME='client_deals' THEN SELECT l.case_id INTO case_id FROM public.transaction_case_links l WHERE l.client_deal_id=record_id; version_key:=extract(epoch from NEW.updated_at)::text; END IF;
 IF case_id IS NOT NULL THEN PERFORM public.enqueue_integration_event('transaction_case',case_id,'transaction_case.domain_changed',1,jsonb_build_object('case_id',case_id,'source_domain',TG_TABLE_NAME,'source_record_id',record_id),TG_TABLE_NAME||':'||record_id||':changed:'||version_key,NULL); END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_legal_matter_case_outbox ON public.legal_matters;
CREATE TRIGGER trg_legal_matter_case_outbox AFTER UPDATE ON public.legal_matters FOR EACH ROW EXECUTE FUNCTION public.enqueue_domain_case_change();
DROP TRIGGER IF EXISTS trg_purchase_file_case_outbox ON public.purchase_files;
CREATE TRIGGER trg_purchase_file_case_outbox AFTER UPDATE ON public.purchase_files FOR EACH ROW EXECUTE FUNCTION public.enqueue_domain_case_change();
DROP TRIGGER IF EXISTS trg_client_deal_case_outbox ON public.client_deals;
CREATE TRIGGER trg_client_deal_case_outbox AFTER UPDATE ON public.client_deals FOR EACH ROW EXECUTE FUNCTION public.enqueue_domain_case_change();

CREATE OR REPLACE FUNCTION public.enqueue_legal_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE case_id uuid; BEGIN
 IF NEW.is_internal OR NEW.scope::text NOT IN ('solicitor_client','solicitor_finance') THEN RETURN NEW; END IF;
 SELECT l.case_id INTO case_id FROM public.transaction_case_links l WHERE l.legal_matter_id=NEW.legal_matter_id;
 IF case_id IS NULL THEN RETURN NEW; END IF;
 PERFORM public.enqueue_integration_event('legal_message',NEW.id,'legal.message.created',1,jsonb_build_object('message_id',NEW.id,'case_id',case_id,'scope',NEW.scope,'client_id',NEW.client_id),'legal_message:'||NEW.id||':created',NULL); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_legal_message_outbox ON public.legal_matter_messages;
CREATE TRIGGER trg_legal_message_outbox AFTER INSERT ON public.legal_matter_messages FOR EACH ROW EXECUTE FUNCTION public.enqueue_legal_message();

INSERT INTO public.integration_outbox(aggregate_type,aggregate_id,event_type,event_version,payload,idempotency_key)
SELECT 'transaction_case',id,'transaction_case.changed',1,jsonb_build_object('case_id',id,'client_id',client_id,'row_version',row_version),'transaction_case:'||id||':phase6_initial:'||row_version
FROM public.transaction_cases ON CONFLICT(idempotency_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_integration_outbox(_worker_id text,_limit integer DEFAULT 25)
RETURNS SETOF public.integration_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 RETURN QUERY WITH claim AS (SELECT id FROM public.integration_outbox WHERE processed_at IS NULL AND available_at<=now() AND (locked_at IS NULL OR locked_at<now()-interval '5 minutes') ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(_limit,1),100))
 UPDATE public.integration_outbox o SET locked_at=now(),locked_by=_worker_id,attempts=o.attempts+1 FROM claim WHERE o.id=claim.id RETURNING o.*; END $$;

CREATE OR REPLACE FUNCTION public.replay_integration_dead_letter(_dead_letter_id uuid,_actor_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE event_id uuid; BEGIN
 SELECT outbox_id INTO event_id FROM public.integration_dead_letters WHERE id=_dead_letter_id FOR UPDATE;
 IF event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DEAD_LETTER_NOT_FOUND'; END IF;
 UPDATE public.integration_outbox SET processed_at=NULL,available_at=now(),locked_at=NULL,locked_by=NULL,last_error=NULL,attempts=0 WHERE id=event_id;
 UPDATE public.integration_dead_letters SET replayed_at=now(),replayed_by=_actor_user_id WHERE id=_dead_letter_id; RETURN event_id; END $$;

CREATE OR REPLACE FUNCTION public.verify_legal_audit_chain_strict(_matter_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$ DECLARE r record; expected_prev text:=NULL; expected_hash text; checked integer:=0; BEGIN
 FOR r IN SELECT * FROM public.legal_matter_audit_events WHERE legal_matter_id=_matter_id ORDER BY created_at,id LOOP
  checked:=checked+1; IF r.prev_hash IS DISTINCT FROM expected_prev THEN RETURN jsonb_build_object('verified',false,'checked',checked,'broken_at',r.id,'reason','prev_hash_mismatch'); END IF;
  expected_hash:=public.compute_legal_audit_row_hash(expected_prev,r.legal_matter_id,r.actor_type,COALESCE(r.actor_solicitor_user_id,r.actor_staff_user_id,r.actor_client_portal_user_id),r.category,r.action,r.target_type,r.target_id,COALESCE(r.metadata,'{}'::jsonb),r.created_at);
  IF r.row_hash IS DISTINCT FROM expected_hash THEN RETURN jsonb_build_object('verified',false,'checked',checked,'broken_at',r.id,'reason','row_hash_mismatch'); END IF; expected_prev:=r.row_hash;
 END LOOP; RETURN jsonb_build_object('verified',true,'checked',checked,'broken_at',NULL,'reason',NULL); END $$;

CREATE OR REPLACE FUNCTION public.legal_audit_chain_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$ DECLARE last_hash text; BEGIN
 NEW.created_at:=COALESCE(NEW.created_at,now());
 PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW.legal_matter_id::text,'global'),0));
 SELECT row_hash INTO last_hash FROM public.legal_matter_audit_events WHERE legal_matter_id IS NOT DISTINCT FROM NEW.legal_matter_id ORDER BY created_at DESC,id DESC LIMIT 1;
 NEW.prev_hash:=last_hash;
 NEW.row_hash:=public.compute_legal_audit_row_hash(last_hash,NEW.legal_matter_id,NEW.actor_type,COALESCE(NEW.actor_solicitor_user_id,NEW.actor_staff_user_id,NEW.actor_client_portal_user_id),NEW.category,NEW.action,NEW.target_type,NEW.target_id,COALESCE(NEW.metadata,'{}'::jsonb),NEW.created_at); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.record_legal_audit_verification(_matter_id uuid,_result jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE run_id uuid; BEGIN
 INSERT INTO public.legal_audit_verification_runs(legal_matter_id,verified,checked,broken_at,failure_reason)
 VALUES(_matter_id,COALESCE((_result->>'verified')::boolean,false),COALESCE((_result->>'checked')::integer,0),NULLIF(_result->>'broken_at','')::uuid,_result->>'reason') RETURNING id INTO run_id;
 IF NOT COALESCE((_result->>'verified')::boolean,false) THEN PERFORM public.enqueue_integration_event('legal_matter',_matter_id,'legal.audit_chain.failed',1,jsonb_build_object('legal_matter_id',_matter_id,'verification_run_id',run_id),'legal_audit_failure:'||run_id,NULL); END IF; RETURN run_id; END $$;

GRANT ALL ON public.integration_outbox,public.integration_dead_letters,public.projection_checkpoints,public.integration_delivery_attempts,public.legal_audit_verification_runs,public.client_case_read_model,public.finance_case_read_model,public.solicitor_case_read_model,public.command_case_health_read_model TO service_role;
REVOKE ALL ON public.integration_outbox,public.integration_dead_letters,public.projection_checkpoints,public.integration_delivery_attempts,public.legal_audit_verification_runs,public.client_case_read_model,public.finance_case_read_model,public.solicitor_case_read_model,public.command_case_health_read_model FROM anon,authenticated;
ALTER TABLE public.integration_outbox ENABLE ROW LEVEL SECURITY; ALTER TABLE public.integration_dead_letters ENABLE ROW LEVEL SECURITY; ALTER TABLE public.projection_checkpoints ENABLE ROW LEVEL SECURITY; ALTER TABLE public.integration_delivery_attempts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.legal_audit_verification_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE public.client_case_read_model ENABLE ROW LEVEL SECURITY; ALTER TABLE public.finance_case_read_model ENABLE ROW LEVEL SECURITY; ALTER TABLE public.solicitor_case_read_model ENABLE ROW LEVEL SECURITY; ALTER TABLE public.command_case_health_read_model ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['integration_outbox','integration_dead_letters','projection_checkpoints','integration_delivery_attempts','legal_audit_verification_runs','client_case_read_model','finance_case_read_model','solicitor_case_read_model','command_case_health_read_model'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_service',t); EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING(true) WITH CHECK(true)',t||'_service',t); END LOOP; END $$;
REVOKE ALL ON FUNCTION public.enqueue_integration_event(text,uuid,text,integer,jsonb,text,uuid),public.claim_integration_outbox(text,integer),public.replay_integration_dead_letter(uuid,uuid),public.verify_legal_audit_chain_strict(uuid),public.record_legal_audit_verification(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_integration_event(text,uuid,text,integer,jsonb,text,uuid),public.claim_integration_outbox(text,integer),public.replay_integration_dead_letter(uuid,uuid),public.verify_legal_audit_chain_strict(uuid),public.record_legal_audit_verification(uuid,jsonb) TO service_role;

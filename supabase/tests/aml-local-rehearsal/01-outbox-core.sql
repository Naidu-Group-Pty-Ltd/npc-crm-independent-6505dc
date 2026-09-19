-- Platform-outbox dependency, VERBATIM table/RPC definitions extracted from
-- supabase/migrations/20260730220000_field_ownership_outbox_projections_phase6.sql.
-- The full platform migration also builds portal read models/triggers that
-- are outside AML scope and depend on dozens of portal tables; the AML
-- domain depends only on these objects.
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
CREATE OR REPLACE FUNCTION public.enqueue_integration_event(_aggregate_type text,_aggregate_id uuid,_event_type text,_event_version integer,_payload jsonb,_idempotency_key text,_correlation_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE event_id uuid; BEGIN
 INSERT INTO public.integration_outbox(aggregate_type,aggregate_id,event_type,event_version,payload,idempotency_key,correlation_id)
 VALUES(_aggregate_type,_aggregate_id,_event_type,_event_version,COALESCE(_payload,'{}'::jsonb),_idempotency_key,COALESCE(_correlation_id,gen_random_uuid()))
 ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id INTO event_id; RETURN event_id; END $$;
CREATE OR REPLACE FUNCTION public.claim_integration_outbox(_worker_id text,_limit integer DEFAULT 25)
RETURNS SETOF public.integration_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 RETURN QUERY WITH claim AS (SELECT id FROM public.integration_outbox WHERE processed_at IS NULL AND available_at<=now() AND (locked_at IS NULL OR locked_at<now()-interval '5 minutes') ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(_limit,1),100))
 UPDATE public.integration_outbox o SET locked_at=now(),locked_by=_worker_id,attempts=o.attempts+1 FROM claim WHERE o.id=claim.id RETURNING o.*; END $$;
CREATE OR REPLACE FUNCTION public.replay_integration_dead_letter(_dead_letter_id uuid,_actor_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE event_id uuid; BEGIN
 SELECT outbox_id INTO event_id FROM public.integration_dead_letters WHERE id=_dead_letter_id FOR UPDATE;
 IF event_id IS NULL THEN RAISE EXCEPTION 'dead letter not found'; END IF;
 UPDATE public.integration_outbox SET processed_at=NULL,available_at=now(),locked_at=NULL,locked_by=NULL,last_error=NULL,attempts=0 WHERE id=event_id;
 UPDATE public.integration_dead_letters SET replayed_at=now(),replayed_by=_actor_user_id WHERE id=_dead_letter_id; RETURN event_id; END $$;
GRANT ALL ON public.integration_outbox,public.integration_dead_letters,public.projection_checkpoints,public.integration_delivery_attempts TO service_role;
ALTER TABLE public.integration_outbox ENABLE ROW LEVEL SECURITY; ALTER TABLE public.integration_dead_letters ENABLE ROW LEVEL SECURITY; ALTER TABLE public.projection_checkpoints ENABLE ROW LEVEL SECURITY; ALTER TABLE public.integration_delivery_attempts ENABLE ROW LEVEL SECURITY;

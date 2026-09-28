-- The platform objects the builder-network migrations reference, and nothing more.
-- Used only by the behavioural SQL specs; never applied to a real database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ select 'service_role' $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ select null::uuid $$;
CREATE TABLE public.feature_flags (key text PRIMARY KEY, value jsonb, description text, updated_at timestamptz default now());
CREATE TABLE public.custom_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text, email text, first_name text, last_name text, phone text, role text, is_active boolean NOT NULL DEFAULT true, deleted_at timestamptz);
CREATE TABLE public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), primary_first_name text, primary_surname text, primary_email text);
CREATE TABLE public.portal_operational_events_log (id bigserial, name text, severity text, meta jsonb);
CREATE OR REPLACE FUNCTION public.record_portal_operational_event(
  p_event_name text, p_severity text, p_request_id uuid, p_ref text, p_actor_type text,
  p_a text, p_b text, p_c text, p_d text, p_e text, p_f text, p_success boolean, p_meta jsonb)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.portal_operational_events_log(name,severity,meta) VALUES (p_event_name,p_severity,p_meta) $$;
-- Step 6 (docs/builder-portal/52): the module permission an invitation is
-- decided by, the bell, and the existing transactional outbox — each shaped
-- as the platform defines it, with only the columns the specs read.
CREATE TABLE public.dashboard_modules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module_key text NOT NULL UNIQUE, module_name text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'core', is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.user_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, module_id uuid NOT NULL, can_view boolean NOT NULL DEFAULT false, can_edit boolean NOT NULL DEFAULT false, can_delete boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role text NOT NULL);
CREATE OR REPLACE FUNCTION public.has_module_access(_user_id uuid, _module_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_permissions up JOIN public.dashboard_modules dm ON up.module_id = dm.id
                  WHERE up.user_id = _user_id AND dm.module_key = _module_key AND up.can_view = true)
      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.role = 'superadmin') $$;
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL, title text NOT NULL, message text NOT NULL, link text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, entity_id text, target_user_id uuid, created_by uuid, read boolean NOT NULL DEFAULT false, "timestamp" timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.integration_outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aggregate_type text NOT NULL, aggregate_id uuid NOT NULL, event_type text NOT NULL, event_version integer NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, idempotency_key text NOT NULL UNIQUE, correlation_id uuid NOT NULL DEFAULT gen_random_uuid(), attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.enqueue_integration_event(_aggregate_type text,_aggregate_id uuid,_event_type text,_event_version integer,_payload jsonb,_idempotency_key text,_correlation_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE event_id uuid; BEGIN
 INSERT INTO public.integration_outbox(aggregate_type,aggregate_id,event_type,event_version,payload,idempotency_key,correlation_id)
 VALUES(_aggregate_type,_aggregate_id,_event_type,_event_version,COALESCE(_payload,'{}'::jsonb),_idempotency_key,COALESCE(_correlation_id,gen_random_uuid()))
 ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id INTO event_id; RETURN event_id; END $$;

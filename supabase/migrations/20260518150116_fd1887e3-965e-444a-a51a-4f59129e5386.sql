
CREATE TABLE IF NOT EXISTS public.token_usage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  agency_ref text NOT NULL,
  function_name text NOT NULL,
  kind text NOT NULL,
  idempotency_key text NOT NULL,
  estimated_tokens integer NOT NULL DEFAULT 0,
  reserved_tokens integer NOT NULL DEFAULT 0,
  actual_tokens integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  error_message text,
  request_payload jsonb,
  job_id text
);
CREATE INDEX IF NOT EXISTS idx_tuh_user_created ON public.token_usage_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tuh_agency_created ON public.token_usage_history (agency_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tuh_idem ON public.token_usage_history (idempotency_key);
ALTER TABLE public.token_usage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_tuh" ON public.token_usage_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.token_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL,
  user_id uuid,
  agency_ref text NOT NULL,
  function_name text,
  kind text,
  idempotency_key text NOT NULL,
  job_id text,
  requested_tokens integer NOT NULL DEFAULT 0,
  reserved_tokens integer NOT NULL DEFAULT 0,
  used_tokens integer NOT NULL DEFAULT 0,
  available_tokens integer NOT NULL DEFAULT 0,
  status text,
  reason text,
  error_message text,
  request_payload jsonb
);
CREATE INDEX IF NOT EXISTS idx_tal_agency_created ON public.token_audit_log (agency_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tal_user_created ON public.token_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tal_idem ON public.token_audit_log (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_tal_event ON public.token_audit_log (event);
ALTER TABLE public.token_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_tal" ON public.token_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

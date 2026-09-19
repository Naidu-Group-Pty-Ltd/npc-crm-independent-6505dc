-- Repair the shared rate-limit and provider-circuit primitives.
--
-- Both were written months ago and never reached production:
--
--   20260723140000_security_rate_limit_primitive.sql      → security_consume_rate_limit
--   20260724000000_shared_provider_circuit_breakers.sql   → provider_circuit_*
--
-- Neither version appears in supabase_migrations.schema_migrations, and neither
-- object exists in the database. Because both files carry timestamps EARLIER
-- than migrations that have since been applied, a deploy that only considers
-- newer files will keep skipping them — which is presumably how they stayed
-- missing for six weeks. Re-declaring them under a current timestamp is what
-- actually gets them applied.
--
-- What their absence broke: every edge function using the shared abuse controls
-- called security_consume_rate_limit, got an RPC error, and treated that as
-- "over quota". Street View therefore answered 429 to every request on the
-- Listings map and the panel reported that Google had no imagery for the
-- address. google-places-autocomplete and resolve-listing-coordinates take the
-- same path, so address autocomplete and geocoding were failing the same way.
--
-- Everything here is idempotent (CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE
-- FUNCTION) and byte-for-byte equivalent to the originals, so applying this on
-- an environment where they DID land is a no-op rather than a change.

BEGIN;

-- ── Rate-limit primitive (from 20260723140000) ──────────────────────────────
-- Depends on public.auth_rate_limits(bucket_key, window_start, count,
-- updated_at), which exists in production already.

CREATE OR REPLACE FUNCTION public.security_consume_rate_limit(
  p_key text, p_max integer, p_window_seconds integer
) RETURNS TABLE(allowed boolean, count integer, remaining integer, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
  v_window_start timestamptz;
BEGIN
  IF p_key !~ '^[a-z0-9:_./-]{1,200}$' OR p_max < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate-limit parameters' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.auth_rate_limits AS limits (bucket_key, window_start, count, updated_at)
  VALUES (p_key, now(), 1, now())
  ON CONFLICT (bucket_key) DO UPDATE SET
    count = CASE WHEN limits.window_start <= now() - make_interval(secs => p_window_seconds) THEN 1 ELSE limits.count + 1 END,
    window_start = CASE WHEN limits.window_start <= now() - make_interval(secs => p_window_seconds) THEN now() ELSE limits.window_start END,
    updated_at = now()
  RETURNING limits.count, limits.window_start INTO v_count, v_window_start;
  RETURN QUERY SELECT v_count <= p_max, v_count, GREATEST(p_max - v_count, 0),
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_window_start + make_interval(secs => p_window_seconds) - now())))::integer);
END;
$$;
REVOKE ALL ON FUNCTION public.security_consume_rate_limit(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_consume_rate_limit(text,integer,integer) TO service_role;

-- ── Provider circuit breakers (from 20260724000000) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.provider_circuit_state (
  scope text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  opened_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.provider_circuit_state TO service_role;
REVOKE ALL ON public.provider_circuit_state FROM anon, authenticated;
ALTER TABLE public.provider_circuit_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.provider_circuit_record_failure(p_scope text, p_threshold integer, p_open_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_failures integer; v_opened timestamptz;
BEGIN
  INSERT INTO public.provider_circuit_state(scope, failures, updated_at) VALUES (p_scope, 1, now())
  ON CONFLICT (scope) DO UPDATE SET failures = public.provider_circuit_state.failures + 1, updated_at = now()
  RETURNING failures, opened_until INTO v_failures, v_opened;
  IF v_failures >= p_threshold THEN
    UPDATE public.provider_circuit_state SET opened_until = now() + make_interval(secs => p_open_seconds), failures = 0 WHERE scope = p_scope;
    RETURN true;
  END IF;
  RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.provider_circuit_is_open(p_scope text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT opened_until > now() FROM public.provider_circuit_state WHERE scope = p_scope), false);
$$;

CREATE OR REPLACE FUNCTION public.provider_circuit_record_success(p_scope text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.provider_circuit_state WHERE scope = p_scope;
$$;

REVOKE ALL ON FUNCTION public.provider_circuit_record_failure(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_circuit_is_open(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_circuit_record_success(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_circuit_record_failure(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_circuit_is_open(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_circuit_record_success(text) TO service_role;

COMMIT;

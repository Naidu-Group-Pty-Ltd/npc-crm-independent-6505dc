-- P1 WP-10: shared provider circuit state. Service-role Edge Functions only.
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
REVOKE ALL ON FUNCTION public.provider_circuit_record_failure(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_circuit_is_open(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_circuit_record_success(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provider_circuit_record_failure(text, integer, integer), public.provider_circuit_is_open(text), public.provider_circuit_record_success(text) TO service_role;

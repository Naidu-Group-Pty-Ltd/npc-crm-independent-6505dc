-- WP-01: reusable atomic rate-limit primitive for Edge Functions.
-- Additive migration; no existing migration is modified.
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

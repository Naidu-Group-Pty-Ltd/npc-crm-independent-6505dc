-- Bound the service-role rate-limit store reached by public auth endpoints.
-- Handler ordering prevents arbitrary email buckets; these database-side
-- controls additionally reject oversized keys and incrementally expire stale
-- buckets so the table cannot grow forever.

DELETE FROM public.auth_rate_limits
WHERE char_length(bucket_key) > 200;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.auth_rate_limits'::regclass
      AND conname = 'auth_rate_limits_bucket_key_length'
  ) THEN
    ALTER TABLE public.auth_rate_limits
      ADD CONSTRAINT auth_rate_limits_bucket_key_length
      CHECK (char_length(bucket_key) BETWEEN 1 AND 200);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.check_and_bump_rate_limit(
  p_key text, p_max integer, p_window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF char_length(p_key) NOT BETWEEN 1 AND 200
     OR p_max < 1
     OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate-limit parameters' USING ERRCODE = '22023';
  END IF;

  -- Amortized bounded cleanup avoids a full-table delete on a public request.
  DELETE FROM public.auth_rate_limits
  WHERE ctid IN (
    SELECT ctid
    FROM public.auth_rate_limits
    WHERE updated_at < now() - interval '24 hours'
    ORDER BY updated_at
    LIMIT 100
  );

  INSERT INTO public.auth_rate_limits AS limits (bucket_key, window_start, count, updated_at)
    VALUES (p_key, now(), 1, now())
  ON CONFLICT (bucket_key) DO UPDATE
    SET count = CASE WHEN limits.window_start < now() - make_interval(secs => p_window_seconds)
                     THEN 1 ELSE limits.count + 1 END,
        window_start = CASE WHEN limits.window_start < now() - make_interval(secs => p_window_seconds)
                     THEN now() ELSE limits.window_start END,
        updated_at = now()
  RETURNING limits.count INTO v_count;

  RETURN v_count <= p_max;
END
$$;

REVOKE EXECUTE ON FUNCTION public.check_and_bump_rate_limit(text,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_bump_rate_limit(text,integer,integer)
  TO service_role;

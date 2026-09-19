ALTER TABLE public.api_usage_log
  ADD COLUMN IF NOT EXISTS mc_reported_at   timestamptz,
  ADD COLUMN IF NOT EXISTS mc_attempts      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mc_last_error    text,
  ADD COLUMN IF NOT EXISTS mc_billing_reason text;

CREATE INDEX IF NOT EXISTS idx_api_usage_log_mc_pending
  ON public.api_usage_log (created_at)
  WHERE mc_reported_at IS NULL AND mc_attempts < 5;

CREATE INDEX IF NOT EXISTS idx_api_usage_log_mc_stuck
  ON public.api_usage_log (created_at DESC)
  WHERE mc_reported_at IS NULL AND mc_attempts >= 5;

COMMENT ON COLUMN public.api_usage_log.mc_reported_at IS
  'When this call was accepted by Mission Control metering. NULL = still queued.';
COMMENT ON COLUMN public.api_usage_log.mc_attempts IS
  'Delivery attempts. At 5 the row leaves the queue and needs an operator.';
COMMENT ON COLUMN public.api_usage_log.mc_billing_reason IS
  'Mission Control''s rating outcome: inherited (billed), byok, no_key, unknown_secret, not_billable, error_call, rate_missing.';

CREATE OR REPLACE FUNCTION public.claim_api_usage_for_forwarding(_limit integer DEFAULT 200)
RETURNS TABLE (
  id uuid,
  service_name text,
  endpoint text,
  tokens_used integer,
  request_count integer,
  model_used text,
  status text,
  created_at timestamptz,
  metadata jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT l.id, l.service_name, l.endpoint, l.tokens_used, l.request_count,
         l.model_used, l.status, l.created_at, l.metadata
    FROM public.api_usage_log l
   WHERE l.mc_reported_at IS NULL
     AND l.mc_attempts < 5
     AND l.created_at > now() - interval '30 days'
   ORDER BY l.created_at
   LIMIT GREATEST(COALESCE(_limit, 200), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_api_usage_for_forwarding(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_api_usage_for_forwarding(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_api_usage_forwarded(
  _reported jsonb DEFAULT '[]'::jsonb,
  _failed   jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ok_count integer := 0;
  _fail_count integer := 0;
BEGIN
  WITH accepted AS (
    SELECT (e->>'id')::uuid AS id, e->>'reason' AS reason
      FROM jsonb_array_elements(COALESCE(_reported, '[]'::jsonb)) e
     WHERE e ? 'id'
  )
  UPDATE public.api_usage_log l
     SET mc_reported_at = now(),
         mc_billing_reason = a.reason,
         mc_last_error = NULL,
         mc_attempts = l.mc_attempts + 1
    FROM accepted a
   WHERE l.id = a.id AND l.mc_reported_at IS NULL;
  GET DIAGNOSTICS _ok_count = ROW_COUNT;

  WITH rejected AS (
    SELECT (e->>'id')::uuid AS id, LEFT(COALESCE(e->>'error', 'unknown'), 300) AS err
      FROM jsonb_array_elements(COALESCE(_failed, '[]'::jsonb)) e
     WHERE e ? 'id'
  )
  UPDATE public.api_usage_log l
     SET mc_attempts = l.mc_attempts + 1,
         mc_last_error = r.err
    FROM rejected r
   WHERE l.id = r.id AND l.mc_reported_at IS NULL;
  GET DIAGNOSTICS _fail_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'marked', _ok_count, 'failed', _fail_count);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_api_usage_forwarded(jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_api_usage_forwarded(jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.api_usage_forwarding_status()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'pending',   COUNT(*) FILTER (WHERE mc_reported_at IS NULL AND mc_attempts < 5),
    'stuck',     COUNT(*) FILTER (WHERE mc_reported_at IS NULL AND mc_attempts >= 5),
    'reported',  COUNT(*) FILTER (WHERE mc_reported_at IS NOT NULL),
    'billed',    COUNT(*) FILTER (WHERE mc_billing_reason = 'inherited'),
    'own_key',   COUNT(*) FILTER (WHERE mc_billing_reason = 'byok'),
    'unbillable',COUNT(*) FILTER (WHERE mc_billing_reason IN ('unknown_secret','rate_missing')),
    'oldest_pending', MIN(created_at) FILTER (WHERE mc_reported_at IS NULL AND mc_attempts < 5)
  )
  FROM public.api_usage_log
  WHERE created_at > now() - interval '30 days';
$$;

GRANT EXECUTE ON FUNCTION public.api_usage_forwarding_status() TO service_role;

CREATE OR REPLACE FUNCTION public.api_usage_billing_breakdown(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _since timestamptz := now() - (GREATEST(COALESCE(_days, 30), 1) || ' days')::interval;
  _out jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'since', _since,
    'queue', public.api_usage_forwarding_status(),
    'by_service', COALESCE((
      SELECT jsonb_agg(x ORDER BY calls DESC)
      FROM (
        SELECT l.service_name,
               COUNT(*) AS calls,
               jsonb_build_object(
                 'service_name', l.service_name,
                 'secret_name', MAX(l.metadata->>'secret_name'),
                 'calls', COUNT(*),
                 'tokens', COALESCE(SUM(l.tokens_used), 0),
                 'errors', COUNT(*) FILTER (WHERE l.status = 'error'),
                 'estimated_usd', ROUND(COALESCE(SUM(l.cost_estimate_usd), 0)::numeric, 4),
                 'billed', COUNT(*) FILTER (WHERE l.mc_billing_reason = 'inherited'),
                 'own_key', COUNT(*) FILTER (WHERE l.mc_billing_reason = 'byok'),
                 'unbillable', COUNT(*) FILTER (WHERE l.mc_billing_reason IN ('unknown_secret','rate_missing')),
                 'not_reported', COUNT(*) FILTER (WHERE l.mc_reported_at IS NULL)
               ) AS x
          FROM public.api_usage_log l
         WHERE l.created_at >= _since
         GROUP BY l.service_name
      ) s
    ), '[]'::jsonb),
    'by_reason', COALESCE((
      SELECT jsonb_object_agg(reason, n)
      FROM (
        SELECT COALESCE(mc_billing_reason, 'not_reported') AS reason, COUNT(*) AS n
          FROM public.api_usage_log
         WHERE created_at >= _since
         GROUP BY 1
      ) r
    ), '{}'::jsonb),
    'unmapped_services', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('service_name', service_name, 'calls', n) ORDER BY n DESC)
      FROM (
        SELECT service_name, COUNT(*) AS n
          FROM public.api_usage_log
         WHERE created_at >= _since
           AND mc_last_error LIKE 'unmappable_service:%'
         GROUP BY service_name
      ) u
    ), '[]'::jsonb)
  ) INTO _out;

  RETURN _out;
END;
$$;

REVOKE ALL ON FUNCTION public.api_usage_billing_breakdown(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.api_usage_billing_breakdown(integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.api_usage_forwarding_status() FROM authenticated;
-- ─────────────────────────────────────────────────────────────────────────────
-- Forward third-party API consumption to Mission Control for per-tenant billing.
--
-- This deployment runs on API keys that may not be its own. A workspace
-- provisioned by Mission Control boots with the prime's OpenAI, Resend, Domain,
-- Cotality (and the rest) keys written into its Supabase project, and every
-- call made on one of those is billed to the prime's vendor account. Mission
-- Control recharges that usage — and charges nothing for a key the workspace
-- supplied itself.
--
-- `api_usage_log` already records every metered call. What it lacked was a way
-- to know which rows have been reported. Forwarding on the request path was
-- never an option: a metering hop in front of a client's report would trade a
-- billing nicety for user-visible latency, and would lose the call entirely
-- whenever Mission Control was slow. Instead the rows queue here and a cron-
-- driven worker drains them in batches, so an outage delays revenue rather than
-- destroying it.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.api_usage_log
  ADD COLUMN IF NOT EXISTS mc_reported_at   timestamptz,
  ADD COLUMN IF NOT EXISTS mc_attempts      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mc_last_error    text,
  -- Set when Mission Control accepts the row but declines to bill it (the
  -- workspace's own key, an uncatalogued secret, a failed vendor call). Kept so
  -- the reason a call was free is answerable here, not only in Mission Control.
  ADD COLUMN IF NOT EXISTS mc_billing_reason text;

-- The drain queue. Partial so it stays small as the table grows: reported rows
-- and rows that have exhausted their retries drop straight out of the index.
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
  'Mission Control''s rating outcome: inherited (billed), byok, no_key, '
  'unknown_secret, not_billable, error_call, rate_missing.';

-- The row the forwarder is allowed to see. `api_usage_log` carries request
-- metadata that has no business leaving this project; this narrows the drain to
-- the fields metering needs and nothing else.
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
     -- Rows older than the window Mission Control will accept can never be
     -- metered; leaving them in the queue would retry them forever.
     AND l.created_at > now() - interval '30 days'
   ORDER BY l.created_at
   LIMIT GREATEST(COALESCE(_limit, 200), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_api_usage_for_forwarding(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_api_usage_for_forwarding(integer) TO service_role;

/**
 * Mark a drained batch. Split from the claim so a partial failure marks only
 * what actually landed — an all-or-nothing update would either re-bill the
 * accepted rows or silently drop the rejected ones.
 */
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
  -- Accepted: stamp the time and the reason Mission Control gave, so "why was
  -- this free" is answerable without a round trip.
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

  -- Rejected: count the attempt and keep the error. At five the partial index
  -- drops the row and it surfaces as stuck rather than retrying forever.
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

-- Operator view: what is queued, what is stuck, and what Mission Control said.
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

GRANT EXECUTE ON FUNCTION public.api_usage_forwarding_status() TO service_role, authenticated;

-- ─── Operator read model ─────────────────────────────────────────────────────
--
-- What the dashboard's Billing tab shows. Admin-gated inside the function
-- rather than by RLS: `api_usage_log` is service-role-only by design, so a
-- SECURITY DEFINER reader is the only way to surface it, and a definer that
-- did not check the caller would hand every signed-in user the vendor spend.

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
                 -- Our own estimate, for a sanity check against what Mission
                 -- Control charges. It is not the invoice.
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
    -- Calls this deployment made that no map could attribute. These are the
    -- ones that cost money and can never be recovered, so they are counted
    -- separately rather than folded into a total.
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

-- `api_usage_forwarding_status` is called from the breakdown above (which is
-- already gated) and by the worker. It must not be readable on its own by any
-- signed-in user, so drop the blanket grant the first pass gave it.
REVOKE EXECUTE ON FUNCTION public.api_usage_forwarding_status() FROM authenticated;

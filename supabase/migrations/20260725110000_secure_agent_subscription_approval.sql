-- Approve agent-authored subscription proposals exactly once while enforcing the
-- same active-subscription quota as the direct API.
CREATE OR REPLACE FUNCTION public.approve_agent_subscription(
  p_user_id uuid,
  p_insight_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_insight public.agent_insights_feed%ROWTYPE;
  v_subscription public.market_qa_subscriptions%ROWTYPE;
  v_active_count integer;
  v_question text;
  v_cadence text;
BEGIN
  -- Serialize approvals for a user so concurrent proposals cannot race the cap.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT *
  INTO v_insight
  FROM public.agent_insights_feed
  WHERE id = p_insight_id
    AND user_id = p_user_id
    AND kind = 'proposed_subscription'
    AND source = 'agent-planner'
    AND acted_on_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_or_already_acted');
  END IF;

  SELECT count(*)
  INTO v_active_count
  FROM public.market_qa_subscriptions
  WHERE user_id = p_user_id
    AND is_active = true;

  IF v_active_count >= 20 THEN
    RETURN jsonb_build_object('error', 'subscription_limit_reached');
  END IF;

  v_question := btrim(COALESCE(v_insight.payload->>'question_template', ''));
  v_cadence := CASE WHEN v_insight.payload->>'cadence' = 'daily' THEN 'daily' ELSE 'weekly' END;
  IF length(v_question) < 6 THEN
    RETURN jsonb_build_object('error', 'invalid_proposal');
  END IF;

  INSERT INTO public.market_qa_subscriptions (
    user_id, question_template, cadence, digest_group, channels, next_run_at
  ) VALUES (
    p_user_id,
    v_question,
    v_cadence,
    NULLIF(left(v_insight.payload->>'digest_group', 64), ''),
    ARRAY['in_app']::text[],
    now() + CASE WHEN v_cadence = 'daily' THEN interval '1 day' ELSE interval '7 days' END
  )
  RETURNING * INTO v_subscription;

  UPDATE public.agent_insights_feed
  SET acted_on_at = now(), is_read = true
  WHERE id = p_insight_id;

  RETURN jsonb_build_object('subscription', to_jsonb(v_subscription));
END;
$$;

REVOKE ALL ON FUNCTION public.approve_agent_subscription(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_agent_subscription(uuid, uuid)
  TO service_role;

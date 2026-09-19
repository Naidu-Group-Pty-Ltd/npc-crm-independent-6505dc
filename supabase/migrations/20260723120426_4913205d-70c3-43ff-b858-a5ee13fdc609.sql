
-- ── commission_payouts hardening ────────────────────────────────────────────
ALTER TABLE public.commission_payouts
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_note text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS pdf_hash text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_payouts_idempotency
  ON public.commission_payouts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_payouts_active_period
  ON public.commission_payouts (broker_id, period_start, period_end)
  WHERE status IN ('pending', 'paid');

-- ── Immutable audit trail ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.commission_payout_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES public.commission_payouts(id) ON DELETE RESTRICT,
  event text NOT NULL,
  actor_id uuid,
  approver_id uuid,
  amount_gross numeric,
  amount_net numeric,
  entry_count integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.commission_payout_audit TO service_role;
ALTER TABLE public.commission_payout_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.commission_payout_audit
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Block updates/deletes on audit rows (append-only).
CREATE OR REPLACE FUNCTION public.commission_payout_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'commission_payout_audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_commission_payout_audit_no_update ON public.commission_payout_audit;
CREATE TRIGGER trg_commission_payout_audit_no_update
  BEFORE UPDATE OR DELETE ON public.commission_payout_audit
  FOR EACH ROW EXECUTE FUNCTION public.commission_payout_audit_immutable();

-- ── RPC: generate_commission_payout ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_commission_payout(
  p_broker_id uuid,
  p_broker_name text,
  p_period_start date,
  p_period_end date,
  p_actor_id uuid,
  p_idempotency_key text
)
RETURNS public.commission_payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.commission_payouts;
  v_totals record;
  v_ids uuid[];
  v_payout public.commission_payouts;
BEGIN
  IF p_broker_id IS NULL OR p_period_start IS NULL OR p_period_end IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'invalid_period';
  END IF;

  -- Idempotency short-circuit
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.commission_payouts
     WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  -- Lock eligible ledger rows for update to prevent concurrent double-payout
  SELECT
    COALESCE(SUM(gross_amount), 0)::numeric AS gross,
    COALESCE(SUM(gst_amount), 0)::numeric   AS gst,
    COALESCE(SUM(net_amount), 0)::numeric   AS net,
    COALESCE(array_agg(id ORDER BY received_date, id), ARRAY[]::uuid[]) AS ids,
    COUNT(*)::int AS cnt
  INTO v_totals
  FROM public.commission_ledger
  WHERE broker_id = p_broker_id
    AND status = 'received'
    AND received_date >= p_period_start
    AND received_date <= p_period_end
  FOR UPDATE;

  IF v_totals.cnt = 0 THEN
    RAISE EXCEPTION 'no_eligible_entries';
  END IF;

  v_ids := v_totals.ids;

  INSERT INTO public.commission_payouts(
    broker_id, broker_name, period_start, period_end,
    total_gross, total_gst, total_net,
    ledger_entry_ids, entry_count, status, generated_by, idempotency_key
  ) VALUES (
    p_broker_id, p_broker_name, p_period_start, p_period_end,
    v_totals.gross, v_totals.gst, v_totals.net,
    v_ids, v_totals.cnt, 'pending', p_actor_id, p_idempotency_key
  ) RETURNING * INTO v_payout;

  UPDATE public.commission_ledger
     SET status = 'reconciled',
         reconciled_date = CURRENT_DATE
   WHERE id = ANY(v_ids);

  INSERT INTO public.commission_payout_audit(payout_id, event, actor_id, amount_gross, amount_net, entry_count)
  VALUES (v_payout.id, 'generated', p_actor_id, v_totals.gross, v_totals.net, v_totals.cnt);

  RETURN v_payout;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_commission_payout(uuid, text, date, date, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_commission_payout(uuid, text, date, date, uuid, text) TO service_role;

-- ── RPC: mark_commission_payout_paid (maker/checker) ───────────────────────
CREATE OR REPLACE FUNCTION public.mark_commission_payout_paid(
  p_payout_id uuid,
  p_approver_id uuid,
  p_payment_reference text,
  p_payment_method text,
  p_approval_note text
)
RETURNS public.commission_payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.commission_payouts;
BEGIN
  IF p_payout_id IS NULL OR p_approver_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;

  SELECT * INTO v_payout FROM public.commission_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_payout.status <> 'pending' THEN RAISE EXCEPTION 'invalid_state:%', v_payout.status; END IF;
  IF v_payout.generated_by IS NOT NULL AND v_payout.generated_by = p_approver_id THEN
    RAISE EXCEPTION 'maker_checker_violation';
  END IF;

  UPDATE public.commission_payouts
     SET status = 'paid',
         paid_at = now(),
         payment_reference = p_payment_reference,
         payment_method = p_payment_method,
         approved_by = p_approver_id,
         approved_at = now(),
         approval_note = p_approval_note
   WHERE id = p_payout_id
   RETURNING * INTO v_payout;

  INSERT INTO public.commission_payout_audit(payout_id, event, actor_id, approver_id, amount_gross, amount_net, entry_count, metadata)
  VALUES (v_payout.id, 'paid', v_payout.generated_by, p_approver_id, v_payout.total_gross, v_payout.total_net, v_payout.entry_count,
          jsonb_build_object('payment_reference', p_payment_reference, 'payment_method', p_payment_method));

  RETURN v_payout;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_commission_payout_paid(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_commission_payout_paid(uuid, uuid, text, text, text) TO service_role;

-- ── RPC: cancel_commission_payout (compensating) ───────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_commission_payout(
  p_payout_id uuid,
  p_actor_id uuid,
  p_reason text
)
RETURNS public.commission_payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.commission_payouts;
  v_ids uuid[];
BEGIN
  IF p_payout_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;

  SELECT * INTO v_payout FROM public.commission_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_payout.status = 'cancelled' THEN RETURN v_payout; END IF;
  IF v_payout.status = 'paid' THEN RAISE EXCEPTION 'cannot_cancel_paid'; END IF;

  v_ids := COALESCE(v_payout.ledger_entry_ids, ARRAY[]::uuid[]);

  IF array_length(v_ids, 1) > 0 THEN
    UPDATE public.commission_ledger
       SET status = 'received',
           reconciled_date = NULL
     WHERE id = ANY(v_ids)
       AND status = 'reconciled';
  END IF;

  UPDATE public.commission_payouts
     SET status = 'cancelled',
         cancelled_by = p_actor_id,
         cancelled_at = now(),
         cancel_reason = p_reason
   WHERE id = p_payout_id
   RETURNING * INTO v_payout;

  INSERT INTO public.commission_payout_audit(payout_id, event, actor_id, entry_count, metadata)
  VALUES (v_payout.id, 'cancelled', p_actor_id, v_payout.entry_count, jsonb_build_object('reason', p_reason));

  RETURN v_payout;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_commission_payout(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_commission_payout(uuid, uuid, text) TO service_role;

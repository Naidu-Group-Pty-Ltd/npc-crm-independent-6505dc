-- ============================================================
-- Finance partner commission accrual: fix the client-name lookup
-- and stop accrual faults from failing the operational write.
--
-- Both accrual triggers read
--   CONCAT(first_name, ' ', last_name) FROM public.clients
-- but `clients` has no `last_name` column (names live in
-- `primary_first_name` / `primary_surname`). Postgres raises 42703
-- inside the AFTER trigger, which aborts the statement that fired it:
-- every "mark commission received" click on a build payment whose deal
-- resolves a finance partner — and every settlement stage move on a
-- refinance/existing-property deal with a partner — answered
-- "Failed to update record". The operational write and the accrual are
-- different acts; the accrual is bookkeeping and must never veto the
-- payment update, so alongside the column fix each accrual body is
-- isolated: a fault is logged as a WARNING and the row change proceeds.
-- ============================================================

-- 1. Build payment commission accrual
CREATE OR REPLACE FUNCTION public.fp_accrue_commission_from_build_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner_id UUID;
  v_rate NUMERIC;
  v_gst BOOLEAN;
  v_basis NUMERIC;
  v_gross NUMERIC;
  v_gst_amt NUMERIC;
  v_net NUMERIC;
  v_partner_name TEXT;
  v_partner_company TEXT;
  v_client_name TEXT;
  v_deal_type TEXT;
  v_client_id UUID;
BEGIN
  IF NEW.is_commission_trigger IS NOT TRUE THEN RETURN NEW; END IF;
  IF NEW.commission_received IS NOT TRUE THEN RETURN NEW; END IF;
  IF (TG_OP = 'UPDATE' AND OLD.commission_received IS TRUE) THEN RETURN NEW; END IF;

  BEGIN
    SELECT * INTO v_partner_id, v_rate, v_gst
    FROM public.fp_resolve_partner_for_deal(NEW.deal_id);

    IF v_partner_id IS NULL THEN RETURN NEW; END IF;

    SELECT d.client_id, d.deal_type INTO v_client_id, v_deal_type
    FROM public.client_deals d WHERE d.id = NEW.deal_id;

    SELECT name, company INTO v_partner_name, v_partner_company
    FROM public.finance_agent_contacts WHERE id = v_partner_id;

    SELECT COALESCE(NULLIF(TRIM(CONCAT(primary_first_name, ' ', primary_surname)), ''), 'Client')
      INTO v_client_name FROM public.clients WHERE id = v_client_id;

    v_basis := COALESCE(NEW.amount, 0);
    v_gross := ROUND(v_basis * COALESCE(v_rate, 0) / 100.0, 2);
    v_gst_amt := CASE WHEN v_gst THEN ROUND(v_gross * 0.10, 2) ELSE 0 END;
    v_net := v_gross - v_gst_amt;

    INSERT INTO public.finance_partner_commissions (
      finance_contact_id, client_id, deal_id, build_payment_id,
      partner_name_snapshot, partner_company_snapshot, client_name_snapshot, deal_type_snapshot,
      commission_basis, basis_amount, rate_pct, gross_amount, gst_amount, net_amount,
      trigger_event, status, notes
    ) VALUES (
      v_partner_id, v_client_id, NEW.deal_id, NEW.id,
      v_partner_name, v_partner_company, v_client_name, v_deal_type,
      'build_payment', v_basis, COALESCE(v_rate, 0), v_gross, v_gst_amt, v_net,
      'build_payment_received', 'pending',
      CONCAT('Auto-accrued from build payment: ', NEW.stage_name)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fp_accrue_commission_from_build_payment failed for payment % (deal %): %',
      NEW.id, NEW.deal_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- 2. Deal settlement commission accrual
CREATE OR REPLACE FUNCTION public.fp_accrue_commission_from_deal_settlement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner_id UUID;
  v_rate NUMERIC;
  v_gst BOOLEAN;
  v_basis NUMERIC;
  v_gross NUMERIC;
  v_gst_amt NUMERIC;
  v_net NUMERIC;
  v_partner_name TEXT;
  v_partner_company TEXT;
  v_client_name TEXT;
BEGIN
  IF NEW.deal_type NOT IN ('refinance', 'existing_property') THEN RETURN NEW; END IF;
  IF NEW.current_stage IS NULL THEN RETURN NEW; END IF;
  IF NEW.current_stage !~* '(settled|settlement complete|unconditional)' THEN RETURN NEW; END IF;
  IF (TG_OP = 'UPDATE' AND OLD.current_stage = NEW.current_stage) THEN RETURN NEW; END IF;

  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.finance_partner_commissions
      WHERE deal_id = NEW.id AND trigger_event = 'deal_settled' AND status <> 'void'
    ) THEN RETURN NEW; END IF;

    SELECT * INTO v_partner_id, v_rate, v_gst
    FROM public.fp_resolve_partner_for_deal(NEW.id);

    IF v_partner_id IS NULL THEN RETURN NEW; END IF;

    SELECT name, company INTO v_partner_name, v_partner_company
    FROM public.finance_agent_contacts WHERE id = v_partner_id;

    SELECT COALESCE(NULLIF(TRIM(CONCAT(primary_first_name, ' ', primary_surname)), ''), 'Client')
      INTO v_client_name FROM public.clients WHERE id = NEW.client_id;

    v_basis := COALESCE((to_jsonb(NEW)->>'loan_amount')::NUMERIC, 0);
    v_gross := ROUND(v_basis * COALESCE(v_rate, 0) / 100.0, 2);
    v_gst_amt := CASE WHEN v_gst THEN ROUND(v_gross * 0.10, 2) ELSE 0 END;
    v_net := v_gross - v_gst_amt;

    INSERT INTO public.finance_partner_commissions (
      finance_contact_id, client_id, deal_id,
      partner_name_snapshot, partner_company_snapshot, client_name_snapshot, deal_type_snapshot,
      commission_basis, basis_amount, rate_pct, gross_amount, gst_amount, net_amount,
      trigger_event, status, notes
    ) VALUES (
      v_partner_id, NEW.client_id, NEW.id,
      v_partner_name, v_partner_company, v_client_name, NEW.deal_type,
      'loan_amount', v_basis, COALESCE(v_rate, 0), v_gross, v_gst_amt, v_net,
      'deal_settled', 'pending',
      CONCAT('Auto-accrued on settlement (', NEW.current_stage, ')',
             CASE WHEN v_basis = 0 THEN ' — loan amount required' ELSE '' END)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fp_accrue_commission_from_deal_settlement failed for deal %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

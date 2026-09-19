
-- ── 1. Commission provenance + cleared funds ────────────────────────────────
ALTER TABLE public.finance_partner_commissions
  ADD COLUMN IF NOT EXISTS agreement_id UUID REFERENCES public.partner_agreements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agreement_version INTEGER,
  ADD COLUMN IF NOT EXISTS referral_id UUID REFERENCES public.partner_referrals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rate_source TEXT NOT NULL DEFAULT 'partner_default',
  ADD COLUMN IF NOT EXISTS schedule_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS qualifying_event TEXT,
  ADD COLUMN IF NOT EXISTS gst_treatment TEXT,
  ADD COLUMN IF NOT EXISTS invoice_process TEXT,
  ADD COLUMN IF NOT EXISTS cleared_funds_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cleared_funds_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleared_funds_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_due_date DATE,
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;

DO $$ BEGIN
  ALTER TABLE public.finance_partner_commissions
    ADD CONSTRAINT finance_partner_commissions_rate_source_check
    CHECK (rate_source IN ('agreement_schedule','partner_default','manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_fpc_agreement ON public.finance_partner_commissions(agreement_id);
CREATE INDEX IF NOT EXISTS idx_fpc_referral ON public.finance_partner_commissions(referral_id);
CREATE INDEX IF NOT EXISTS idx_fpc_cleared ON public.finance_partner_commissions(cleared_funds_required, cleared_funds_received_at);

-- ── 2. Statement provenance + dispute window ────────────────────────────────
ALTER TABLE public.finance_partner_statements
  ADD COLUMN IF NOT EXISTS agreement_id UUID REFERENCES public.partner_agreements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agreement_version INTEGER,
  ADD COLUMN IF NOT EXISTS dispute_window_days INTEGER,
  ADD COLUMN IF NOT EXISTS dispute_deadline DATE,
  ADD COLUMN IF NOT EXISTS dispute_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS open_dispute_count INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.finance_partner_statements
    ADD CONSTRAINT finance_partner_statements_dispute_status_check
    CHECK (dispute_status IN ('none','open','resolved','withdrawn'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Statement line provenance ────────────────────────────────────────────
ALTER TABLE public.finance_partner_statement_lines
  ADD COLUMN IF NOT EXISTS agreement_id UUID,
  ADD COLUMN IF NOT EXISTS agreement_version_snapshot INTEGER,
  ADD COLUMN IF NOT EXISTS rate_source_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS gst_treatment_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS qualifying_event_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS basis_amount_snapshot NUMERIC,
  ADD COLUMN IF NOT EXISTS referral_reference_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS cleared_funds_received_at_snapshot TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS adjustment_snapshot NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_reason_snapshot TEXT;

-- ── 4. Disputes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_partner_statement_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID NOT NULL REFERENCES public.finance_partner_statements(id) ON DELETE CASCADE,
  finance_contact_id UUID,
  commission_id UUID REFERENCES public.finance_partner_commissions(id) ON DELETE SET NULL,
  raised_by_type TEXT NOT NULL DEFAULT 'partner',
  raised_by_id UUID,
  raised_by_name TEXT,
  raised_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  within_window BOOLEAN NOT NULL DEFAULT true,
  reason_category TEXT NOT NULL DEFAULT 'other',
  reason TEXT NOT NULL,
  disputed_amount NUMERIC,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_outcome TEXT,
  resolution_notes TEXT,
  adjustment_amount NUMERIC,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolved_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fpsd_status_check CHECK (status IN ('open','under_review','resolved','withdrawn','rejected')),
  CONSTRAINT fpsd_raised_by_type_check CHECK (raised_by_type IN ('partner','staff')),
  CONSTRAINT fpsd_reason_category_check CHECK (reason_category IN ('missing_commission','incorrect_rate','incorrect_basis','gst_treatment','clawback','duplicate','other'))
);

GRANT ALL ON public.finance_partner_statement_disputes TO service_role;
ALTER TABLE public.finance_partner_statement_disputes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "fpsd_service_role_only" ON public.finance_partner_statement_disputes
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_fpsd_statement ON public.finance_partner_statement_disputes(statement_id);
CREATE INDEX IF NOT EXISTS idx_fpsd_status ON public.finance_partner_statement_disputes(status);

DROP TRIGGER IF EXISTS trg_fpsd_updated_at ON public.finance_partner_statement_disputes;
CREATE TRIGGER trg_fpsd_updated_at
  BEFORE UPDATE ON public.finance_partner_statement_disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Keep the parent statement's dispute rollup in sync.
CREATE OR REPLACE FUNCTION public.fp_sync_statement_dispute_rollup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_statement UUID := COALESCE(NEW.statement_id, OLD.statement_id);
  v_open INTEGER;
  v_total INTEGER;
BEGIN
  SELECT COUNT(*) FILTER (WHERE status IN ('open','under_review')), COUNT(*)
    INTO v_open, v_total
  FROM public.finance_partner_statement_disputes
  WHERE statement_id = v_statement;

  UPDATE public.finance_partner_statements
  SET open_dispute_count = COALESCE(v_open, 0),
      dispute_status = CASE
        WHEN COALESCE(v_open, 0) > 0 THEN 'open'
        WHEN COALESCE(v_total, 0) > 0 THEN 'resolved'
        ELSE 'none' END,
      updated_at = now()
  WHERE id = v_statement;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_fpsd_rollup ON public.finance_partner_statement_disputes;
CREATE TRIGGER trg_fpsd_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.finance_partner_statement_disputes
  FOR EACH ROW EXECUTE FUNCTION public.fp_sync_statement_dispute_rollup();

-- ── 5. Agreement-driven commercial terms resolver ───────────────────────────
CREATE OR REPLACE FUNCTION public.fp_resolve_partner_agreement(_finance_contact_id UUID, _direction TEXT DEFAULT 'outbound_finance_referral')
RETURNS TABLE(
  agreement_id UUID,
  agreement_version INTEGER,
  upfront_share_pct NUMERIC,
  trail_share_pct NUMERIC,
  fee_percentage NUMERIC,
  fee_amount NUMERIC,
  fee_model TEXT,
  fee_cap NUMERIC,
  fee_minimum NUMERIC,
  commission_basis TEXT,
  gst_treatment TEXT,
  qualifying_event TEXT,
  invoice_process TEXT,
  payment_business_days INTEGER,
  cleared_funds_required BOOLEAN,
  dispute_window_days INTEGER,
  clawback_treatment TEXT,
  clawback_repayment_days INTEGER
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id, a.version, a.upfront_share_pct, a.trail_share_pct,
         a.fee_percentage, a.fee_amount, a.fee_model, a.fee_cap, a.fee_minimum,
         a.commission_basis, a.gst_treatment, a.qualifying_event, a.invoice_process,
         a.payment_business_days, COALESCE(a.cleared_funds_required, false),
         a.dispute_window_days, a.clawback_treatment, a.clawback_repayment_days
  FROM public.partner_agreements a
  WHERE a.finance_agent_contact_id = _finance_contact_id
    AND a.direction::text = _direction
    AND a.status = 'active'
    AND (a.effective_date IS NULL OR a.effective_date <= CURRENT_DATE)
    AND (a.termination_date IS NULL OR a.termination_date >= CURRENT_DATE)
  ORDER BY a.version DESC, a.created_at DESC
  LIMIT 1;
$$;

-- ── 6. Accrual triggers now prefer the signed schedule ──────────────────────
CREATE OR REPLACE FUNCTION public.fp_accrue_commission_from_deal_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_ag RECORD;
  v_rate_source TEXT := 'partner_default';
  v_gst_treatment TEXT;
BEGIN
  IF NEW.deal_type NOT IN ('refinance','existing_property') THEN RETURN NEW; END IF;
  IF NEW.current_stage IS NULL THEN RETURN NEW; END IF;
  IF NEW.current_stage !~* '(settled|settlement complete|unconditional)' THEN RETURN NEW; END IF;
  IF (TG_OP = 'UPDATE' AND OLD.current_stage = NEW.current_stage) THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.finance_partner_commissions
    WHERE deal_id = NEW.id AND trigger_event = 'deal_settled' AND status <> 'void'
  ) THEN RETURN NEW; END IF;

  SELECT * INTO v_partner_id, v_rate, v_gst
  FROM public.fp_resolve_partner_for_deal(NEW.id);

  IF v_partner_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_ag FROM public.fp_resolve_partner_agreement(v_partner_id, 'outbound_finance_referral');

  IF v_ag.agreement_id IS NOT NULL AND COALESCE(v_ag.upfront_share_pct, 0) > 0 THEN
    v_rate := v_ag.upfront_share_pct;
    v_rate_source := 'agreement_schedule';
  END IF;

  v_gst_treatment := v_ag.gst_treatment;
  IF v_gst_treatment IS NOT NULL THEN
    v_gst := (v_gst_treatment ILIKE '%plus%gst%' OR v_gst_treatment ILIKE '%exclusive%');
  END IF;

  SELECT name, company INTO v_partner_name, v_partner_company
  FROM public.finance_agent_contacts WHERE id = v_partner_id;

  SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name,' ',last_name)),''), 'Client')
    INTO v_client_name FROM public.clients WHERE id = NEW.client_id;

  v_basis := COALESCE((to_jsonb(NEW)->>'loan_amount')::NUMERIC, 0);
  v_gross := ROUND(v_basis * COALESCE(v_rate,0) / 100.0, 2);
  IF v_ag.fee_cap IS NOT NULL AND v_gross > v_ag.fee_cap THEN v_gross := v_ag.fee_cap; END IF;
  IF v_ag.fee_minimum IS NOT NULL AND v_gross > 0 AND v_gross < v_ag.fee_minimum THEN v_gross := v_ag.fee_minimum; END IF;
  v_gst_amt := CASE WHEN v_gst THEN ROUND(v_gross * 0.10, 2) ELSE 0 END;
  v_net := v_gross - v_gst_amt;

  INSERT INTO public.finance_partner_commissions (
    finance_contact_id, client_id, deal_id,
    partner_name_snapshot, partner_company_snapshot, client_name_snapshot, deal_type_snapshot,
    commission_basis, basis_amount, rate_pct, gross_amount, gst_amount, net_amount,
    trigger_event, status, notes,
    agreement_id, agreement_version, rate_source, gst_treatment, qualifying_event,
    invoice_process, cleared_funds_required, payment_due_date, schedule_snapshot
  ) VALUES (
    v_partner_id, NEW.client_id, NEW.id,
    v_partner_name, v_partner_company, v_client_name, NEW.deal_type,
    COALESCE(v_ag.commission_basis, 'loan_amount'), v_basis, COALESCE(v_rate,0), v_gross, v_gst_amt, v_net,
    'deal_settled', 'pending',
    CONCAT('Auto-accrued on settlement (', NEW.current_stage, ')',
           CASE WHEN v_basis = 0 THEN ' — loan amount required' ELSE '' END),
    v_ag.agreement_id, v_ag.agreement_version, v_rate_source, v_gst_treatment, v_ag.qualifying_event,
    v_ag.invoice_process, COALESCE(v_ag.cleared_funds_required, false),
    CASE WHEN v_ag.payment_business_days IS NOT NULL
         THEN (CURRENT_DATE + (v_ag.payment_business_days * INTERVAL '1 day'))::date END,
    COALESCE(to_jsonb(v_ag), '{}'::jsonb)
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fp_accrue_commission_from_build_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_ag RECORD;
  v_rate_source TEXT := 'partner_default';
  v_gst_treatment TEXT;
BEGIN
  IF NEW.is_commission_trigger IS NOT TRUE THEN RETURN NEW; END IF;
  IF NEW.commission_received IS NOT TRUE THEN RETURN NEW; END IF;
  IF (TG_OP = 'UPDATE' AND OLD.commission_received IS TRUE) THEN RETURN NEW; END IF;

  SELECT * INTO v_partner_id, v_rate, v_gst
  FROM public.fp_resolve_partner_for_deal(NEW.deal_id);

  IF v_partner_id IS NULL THEN RETURN NEW; END IF;

  SELECT d.client_id, d.deal_type INTO v_client_id, v_deal_type
  FROM public.client_deals d WHERE d.id = NEW.deal_id;

  SELECT * INTO v_ag FROM public.fp_resolve_partner_agreement(v_partner_id, 'outbound_finance_referral');

  IF v_ag.agreement_id IS NOT NULL AND COALESCE(v_ag.upfront_share_pct, 0) > 0 THEN
    v_rate := v_ag.upfront_share_pct;
    v_rate_source := 'agreement_schedule';
  END IF;

  v_gst_treatment := v_ag.gst_treatment;
  IF v_gst_treatment IS NOT NULL THEN
    v_gst := (v_gst_treatment ILIKE '%plus%gst%' OR v_gst_treatment ILIKE '%exclusive%');
  END IF;

  SELECT name, company INTO v_partner_name, v_partner_company
  FROM public.finance_agent_contacts WHERE id = v_partner_id;

  SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name,' ',last_name)),''), 'Client')
    INTO v_client_name FROM public.clients WHERE id = v_client_id;

  v_basis := COALESCE(NEW.amount, 0);
  v_gross := ROUND(v_basis * COALESCE(v_rate,0) / 100.0, 2);
  IF v_ag.fee_cap IS NOT NULL AND v_gross > v_ag.fee_cap THEN v_gross := v_ag.fee_cap; END IF;
  IF v_ag.fee_minimum IS NOT NULL AND v_gross > 0 AND v_gross < v_ag.fee_minimum THEN v_gross := v_ag.fee_minimum; END IF;
  v_gst_amt := CASE WHEN v_gst THEN ROUND(v_gross * 0.10, 2) ELSE 0 END;
  v_net := v_gross - v_gst_amt;

  INSERT INTO public.finance_partner_commissions (
    finance_contact_id, client_id, deal_id, build_payment_id,
    partner_name_snapshot, partner_company_snapshot, client_name_snapshot, deal_type_snapshot,
    commission_basis, basis_amount, rate_pct, gross_amount, gst_amount, net_amount,
    trigger_event, status, notes,
    agreement_id, agreement_version, rate_source, gst_treatment, qualifying_event,
    invoice_process, cleared_funds_required, payment_due_date, schedule_snapshot
  ) VALUES (
    v_partner_id, v_client_id, NEW.deal_id, NEW.id,
    v_partner_name, v_partner_company, v_client_name, v_deal_type,
    'build_payment', v_basis, COALESCE(v_rate,0), v_gross, v_gst_amt, v_net,
    'build_payment_received', 'pending',
    CONCAT('Auto-accrued from build payment: ', NEW.stage_name),
    v_ag.agreement_id, v_ag.agreement_version, v_rate_source, v_gst_treatment, v_ag.qualifying_event,
    v_ag.invoice_process, COALESCE(v_ag.cleared_funds_required, false),
    CASE WHEN v_ag.payment_business_days IS NOT NULL
         THEN (CURRENT_DATE + (v_ag.payment_business_days * INTERVAL '1 day'))::date END,
    COALESCE(to_jsonb(v_ag), '{}'::jsonb)
  );

  RETURN NEW;
END;
$function$;

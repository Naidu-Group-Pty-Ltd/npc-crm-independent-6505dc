
-- ============================================================
-- Phase 7A: Finance Partner Commission Tracking (corrected refs)
-- Partner identity table = public.finance_agent_contacts
-- Partner login table   = public.finance_portal_users
-- Assignment table uses: finance_user_id, client_id, permissions
-- ============================================================

-- 1. Extend finance_agent_contacts with commission/payout defaults
ALTER TABLE public.finance_agent_contacts
  ADD COLUMN IF NOT EXISTS default_commission_rate_pct NUMERIC(6,3) DEFAULT 0.55,
  ADD COLUMN IF NOT EXISTS default_commission_basis TEXT DEFAULT 'loan_amount',
  ADD COLUMN IF NOT EXISTS gst_registered BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS abn TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'bank_transfer',
  ADD COLUMN IF NOT EXISTS bank_bsb TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name TEXT;

-- 2. finance_partner_commissions
CREATE TABLE IF NOT EXISTS public.finance_partner_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_contact_id UUID NOT NULL REFERENCES public.finance_agent_contacts(id) ON DELETE RESTRICT,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES public.client_deals(id) ON DELETE SET NULL,
  build_payment_id UUID REFERENCES public.build_progress_payments(id) ON DELETE SET NULL,

  partner_name_snapshot TEXT,
  partner_company_snapshot TEXT,
  client_name_snapshot TEXT,
  deal_type_snapshot TEXT,

  commission_basis TEXT NOT NULL DEFAULT 'loan_amount',
  basis_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  rate_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,

  trigger_event TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  invoice_ref TEXT,
  invoice_date DATE,
  paid_at TIMESTAMPTZ,
  statement_id UUID,
  notes TEXT,

  created_by UUID REFERENCES public.custom_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fpc_status_chk CHECK (status IN ('pending','invoiced','paid','clawback','void')),
  CONSTRAINT fpc_basis_chk CHECK (commission_basis IN ('loan_amount','build_payment','fixed','manual'))
);

CREATE INDEX IF NOT EXISTS idx_fpc_partner ON public.finance_partner_commissions(finance_contact_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fpc_deal ON public.finance_partner_commissions(deal_id);
CREATE INDEX IF NOT EXISTS idx_fpc_build_payment ON public.finance_partner_commissions(build_payment_id);
CREATE INDEX IF NOT EXISTS idx_fpc_status ON public.finance_partner_commissions(status);

ALTER TABLE public.finance_partner_commissions ENABLE ROW LEVEL SECURITY;

-- 3. finance_partner_statements
CREATE TABLE IF NOT EXISTS public.finance_partner_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_contact_id UUID NOT NULL REFERENCES public.finance_agent_contacts(id) ON DELETE RESTRICT,
  partner_name_snapshot TEXT,
  partner_company_snapshot TEXT,

  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  total_gross NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_gst NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_net NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_count INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'draft',
  pdf_storage_path TEXT,
  remittance_csv_path TEXT,

  issued_at TIMESTAMPTZ,
  issued_by UUID REFERENCES public.custom_users(id),
  paid_at TIMESTAMPTZ,
  paid_reference TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fps_status_chk CHECK (status IN ('draft','issued','paid','void')),
  CONSTRAINT fps_period_chk CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_fps_partner ON public.finance_partner_statements(finance_contact_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_fps_status ON public.finance_partner_statements(status);

ALTER TABLE public.finance_partner_statements ENABLE ROW LEVEL SECURITY;

-- 4. finance_partner_statement_lines
CREATE TABLE IF NOT EXISTS public.finance_partner_statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID NOT NULL REFERENCES public.finance_partner_statements(id) ON DELETE CASCADE,
  commission_id UUID NOT NULL REFERENCES public.finance_partner_commissions(id) ON DELETE RESTRICT,

  client_name_snapshot TEXT,
  deal_type_snapshot TEXT,
  trigger_event_snapshot TEXT,
  basis_snapshot TEXT,
  rate_pct_snapshot NUMERIC(6,3),
  gross_snapshot NUMERIC(14,2),
  gst_snapshot NUMERIC(14,2),
  net_snapshot NUMERIC(14,2),
  accrual_date DATE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fpsl_statement ON public.finance_partner_statement_lines(statement_id);
CREATE INDEX IF NOT EXISTS idx_fpsl_commission ON public.finance_partner_statement_lines(commission_id);

ALTER TABLE public.finance_partner_statement_lines ENABLE ROW LEVEL SECURITY;

-- 5. updated_at helper + triggers
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at_timestamp') THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
    RETURNS TRIGGER LANGUAGE plpgsql AS $f$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $f$;
  END IF;
END$$;

DROP TRIGGER IF EXISTS trg_fpc_updated_at ON public.finance_partner_commissions;
CREATE TRIGGER trg_fpc_updated_at BEFORE UPDATE ON public.finance_partner_commissions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_fps_updated_at ON public.finance_partner_statements;
CREATE TRIGGER trg_fps_updated_at BEFORE UPDATE ON public.finance_partner_statements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

-- 6. Helper: resolve a deal's finance partner via finance_portal_client_assignments
CREATE OR REPLACE FUNCTION public.fp_resolve_partner_for_deal(_deal_id UUID)
RETURNS TABLE(finance_contact_id UUID, default_rate NUMERIC, gst_registered BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT fc.id, fc.default_commission_rate_pct, fc.gst_registered
  FROM public.client_deals d
  JOIN public.finance_portal_client_assignments a ON a.client_id = d.client_id
  JOIN public.finance_portal_users u ON u.id = a.finance_user_id AND u.is_active = true
  JOIN public.finance_agent_contacts fc ON fc.id = u.finance_contact_id
  WHERE d.id = _deal_id
  ORDER BY a.assigned_at ASC
  LIMIT 1;
$$;

-- 7. Trigger: build payment commission accrual
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

  SELECT * INTO v_partner_id, v_rate, v_gst
  FROM public.fp_resolve_partner_for_deal(NEW.deal_id);

  IF v_partner_id IS NULL THEN RETURN NEW; END IF;

  SELECT d.client_id, d.deal_type INTO v_client_id, v_deal_type
  FROM public.client_deals d WHERE d.id = NEW.deal_id;

  SELECT name, company INTO v_partner_name, v_partner_company
  FROM public.finance_agent_contacts WHERE id = v_partner_id;

  SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name,' ',last_name)),''), 'Client')
    INTO v_client_name FROM public.clients WHERE id = v_client_id;

  v_basis := COALESCE(NEW.amount, 0);
  v_gross := ROUND(v_basis * COALESCE(v_rate,0) / 100.0, 2);
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
    'build_payment', v_basis, COALESCE(v_rate,0), v_gross, v_gst_amt, v_net,
    'build_payment_received', 'pending',
    CONCAT('Auto-accrued from build payment: ', NEW.stage_name)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fp_accrue_build_payment ON public.build_progress_payments;
CREATE TRIGGER trg_fp_accrue_build_payment
AFTER INSERT OR UPDATE OF commission_received ON public.build_progress_payments
FOR EACH ROW EXECUTE FUNCTION public.fp_accrue_commission_from_build_payment();

-- 8. Trigger: deal settlement commission accrual
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

  SELECT name, company INTO v_partner_name, v_partner_company
  FROM public.finance_agent_contacts WHERE id = v_partner_id;

  SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name,' ',last_name)),''), 'Client')
    INTO v_client_name FROM public.clients WHERE id = NEW.client_id;

  v_basis := COALESCE((to_jsonb(NEW)->>'loan_amount')::NUMERIC, 0);
  v_gross := ROUND(v_basis * COALESCE(v_rate,0) / 100.0, 2);
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
    'loan_amount', v_basis, COALESCE(v_rate,0), v_gross, v_gst_amt, v_net,
    'deal_settled', 'pending',
    CONCAT('Auto-accrued on settlement (', NEW.current_stage, ')',
           CASE WHEN v_basis = 0 THEN ' — loan amount required' ELSE '' END)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fp_accrue_deal_settled ON public.client_deals;
CREATE TRIGGER trg_fp_accrue_deal_settled
AFTER UPDATE OF current_stage ON public.client_deals
FOR EACH ROW EXECUTE FUNCTION public.fp_accrue_commission_from_deal_settlement();

-- 9. FK from commissions.statement_id → statements
ALTER TABLE public.finance_partner_commissions
  DROP CONSTRAINT IF EXISTS fpc_statement_fk;
ALTER TABLE public.finance_partner_commissions
  ADD CONSTRAINT fpc_statement_fk
  FOREIGN KEY (statement_id) REFERENCES public.finance_partner_statements(id) ON DELETE SET NULL;

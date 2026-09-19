-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 5 — Clawbacks (§6), RCTI (§7.3), restricted banking verification (§9.3)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Executed clawback register ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_partner_clawbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_contact_id UUID NOT NULL,
  commission_id UUID REFERENCES public.finance_partner_commissions(id) ON DELETE SET NULL,
  deal_id UUID,
  client_id UUID,
  agreement_id UUID REFERENCES public.partner_agreements(id) ON DELETE SET NULL,
  agreement_version INTEGER,
  partner_name_snapshot TEXT,
  partner_company_snapshot TEXT,
  client_name_snapshot TEXT,
  loan_reference TEXT,
  lender_name TEXT,
  settlement_date DATE,
  discharge_date DATE,
  reason_category TEXT NOT NULL DEFAULT 'other',
  reason TEXT NOT NULL,
  clawback_treatment_snapshot TEXT,
  -- §6.3 cap: recovery can never exceed commission actually paid on that loan
  commission_paid_total NUMERIC NOT NULL DEFAULT 0,
  cap_amount NUMERIC NOT NULL DEFAULT 0,
  lender_clawback_amount NUMERIC,
  clawback_amount NUMERIC NOT NULL DEFAULT 0,
  capped BOOLEAN NOT NULL DEFAULT false,
  repayment_days INTEGER,
  repayment_due_date DATE,
  amount_recovered NUMERIC NOT NULL DEFAULT 0,
  recovery_method TEXT,
  offset_statement_id UUID REFERENCES public.finance_partner_statements(id) ON DELETE SET NULL,
  evidence_path TEXT,
  evidence_filename TEXT,
  evidence_uploaded_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  issued_at TIMESTAMPTZ,
  issued_by UUID,
  acknowledged_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  waived_at TIMESTAMPTZ,
  waived_reason TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fpcb_status_check CHECK (status IN ('draft','issued','acknowledged','partially_recovered','recovered','waived','disputed','void')),
  CONSTRAINT fpcb_reason_category_check CHECK (reason_category IN ('early_discharge','refinance_away','loan_reduced','lender_clawback','fraud_or_misconduct','other')),
  CONSTRAINT fpcb_recovery_method_check CHECK (recovery_method IS NULL OR recovery_method IN ('statement_offset','direct_payment','waived','other')),
  CONSTRAINT fpcb_amounts_nonneg CHECK (clawback_amount >= 0 AND amount_recovered >= 0)
);

GRANT ALL ON public.finance_partner_clawbacks TO service_role;
REVOKE ALL ON public.finance_partner_clawbacks FROM anon, authenticated;
ALTER TABLE public.finance_partner_clawbacks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "fpcb_service_role_only" ON public.finance_partner_clawbacks
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_fpcb_partner ON public.finance_partner_clawbacks(finance_contact_id);
CREATE INDEX IF NOT EXISTS idx_fpcb_status ON public.finance_partner_clawbacks(status);
CREATE INDEX IF NOT EXISTS idx_fpcb_commission ON public.finance_partner_clawbacks(commission_id);
CREATE INDEX IF NOT EXISTS idx_fpcb_due ON public.finance_partner_clawbacks(repayment_due_date);

DROP TRIGGER IF EXISTS trg_fpcb_updated_at ON public.finance_partner_clawbacks;
CREATE TRIGGER trg_fpcb_updated_at BEFORE UPDATE ON public.finance_partner_clawbacks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- §6.3 cap enforcement + status derivation
CREATE OR REPLACE FUNCTION public.fp_enforce_clawback_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_paid NUMERIC;
BEGIN
  SELECT COALESCE(SUM(COALESCE(c.net_amount,0) + COALESCE(c.adjustment_amount,0)), 0)
    INTO v_paid
  FROM public.finance_partner_commissions c
  WHERE c.status = 'paid'
    AND c.finance_contact_id = NEW.finance_contact_id
    AND (
      (NEW.commission_id IS NOT NULL AND c.id = NEW.commission_id)
      OR (NEW.deal_id IS NOT NULL AND c.deal_id = NEW.deal_id)
    );

  NEW.commission_paid_total := v_paid;
  NEW.cap_amount := v_paid;

  IF NEW.clawback_amount > v_paid THEN
    NEW.clawback_amount := v_paid;
    NEW.capped := true;
  ELSE
    NEW.capped := false;
  END IF;

  IF NEW.amount_recovered > NEW.clawback_amount THEN
    NEW.amount_recovered := NEW.clawback_amount;
  END IF;

  IF NEW.status NOT IN ('draft','waived','disputed','void') THEN
    IF NEW.amount_recovered >= NEW.clawback_amount AND NEW.clawback_amount > 0 THEN
      NEW.status := 'recovered';
      NEW.settled_at := COALESCE(NEW.settled_at, now());
    ELSIF NEW.amount_recovered > 0 THEN
      NEW.status := 'partially_recovered';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fpcb_cap ON public.finance_partner_clawbacks;
CREATE TRIGGER trg_fpcb_cap BEFORE INSERT OR UPDATE ON public.finance_partner_clawbacks
  FOR EACH ROW EXECUTE FUNCTION public.fp_enforce_clawback_cap();

-- ── 2. RCTI / tax invoice register (§7.3) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_tax_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_contact_id UUID NOT NULL,
  statement_id UUID REFERENCES public.finance_partner_statements(id) ON DELETE CASCADE,
  agreement_id UUID REFERENCES public.partner_agreements(id) ON DELETE SET NULL,
  invoice_mode TEXT NOT NULL DEFAULT 'rcti',
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  supplier_name TEXT,
  supplier_abn TEXT,
  supplier_gst_registered BOOLEAN,
  recipient_name TEXT,
  recipient_abn TEXT,
  subtotal_amount NUMERIC NOT NULL DEFAULT 0,
  gst_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  gst_treatment TEXT,
  storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'issued',
  issued_by UUID,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  cancelled_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pti_mode_check CHECK (invoice_mode IN ('rcti','partner_tax_invoice')),
  CONSTRAINT pti_status_check CHECK (status IN ('draft','issued','paid','cancelled'))
);

GRANT ALL ON public.partner_tax_invoices TO service_role;
REVOKE ALL ON public.partner_tax_invoices FROM anon, authenticated;
ALTER TABLE public.partner_tax_invoices ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "pti_service_role_only" ON public.partner_tax_invoices
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- duplicate-invoice guard
CREATE UNIQUE INDEX IF NOT EXISTS uq_pti_partner_invoice_number
  ON public.partner_tax_invoices(finance_contact_id, lower(invoice_number))
  WHERE status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pti_statement_live
  ON public.partner_tax_invoices(statement_id)
  WHERE status <> 'cancelled' AND statement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pti_partner ON public.partner_tax_invoices(finance_contact_id);

DROP TRIGGER IF EXISTS trg_pti_updated_at ON public.partner_tax_invoices;
CREATE TRIGGER trg_pti_updated_at BEFORE UPDATE ON public.partner_tax_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 3. Restricted banking details (Annexure C / §9.3) ───────────────────────
CREATE TABLE IF NOT EXISTS public.finance_partner_bank_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_contact_id UUID NOT NULL,
  agreement_id UUID REFERENCES public.partner_agreements(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  entity_name TEXT,
  abn TEXT,
  gst_registered BOOLEAN,
  accounts_email TEXT,
  rcti_email TEXT,
  account_name TEXT,
  bsb TEXT,
  account_number_last4 TEXT,
  account_number_masked TEXT,
  status TEXT NOT NULL DEFAULT 'pending_verification',
  independent_verification_date DATE,
  verified_by UUID,
  verified_by_name TEXT,
  verification_method TEXT,
  verification_contact_number TEXT,
  verification_notes TEXT,
  change_reason TEXT,
  superseded_at TIMESTAMPTZ,
  superseded_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fpbd_status_check CHECK (status IN ('pending_verification','verified','rejected','superseded')),
  CONSTRAINT fpbd_method_check CHECK (verification_method IS NULL OR verification_method IN ('callback_known_number','in_person','bank_document','other')),
  CONSTRAINT fpbd_verified_requires_evidence CHECK (
    status <> 'verified' OR (independent_verification_date IS NOT NULL AND verification_method IS NOT NULL)
  )
);

GRANT ALL ON public.finance_partner_bank_details TO service_role;
REVOKE ALL ON public.finance_partner_bank_details FROM anon, authenticated;
ALTER TABLE public.finance_partner_bank_details ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "fpbd_service_role_only" ON public.finance_partner_bank_details
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fpbd_current
  ON public.finance_partner_bank_details(finance_contact_id)
  WHERE status <> 'superseded';
CREATE INDEX IF NOT EXISTS idx_fpbd_partner ON public.finance_partner_bank_details(finance_contact_id);

DROP TRIGGER IF EXISTS trg_fpbd_updated_at ON public.finance_partner_bank_details;
CREATE TRIGGER trg_fpbd_updated_at BEFORE UPDATE ON public.finance_partner_bank_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Any change to the account identity forces re-verification (clause 9.3).
CREATE OR REPLACE FUNCTION public.fp_bank_details_reverify_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
       COALESCE(NEW.bsb,'') IS DISTINCT FROM COALESCE(OLD.bsb,'')
    OR COALESCE(NEW.account_number_last4,'') IS DISTINCT FROM COALESCE(OLD.account_number_last4,'')
    OR COALESCE(NEW.account_name,'') IS DISTINCT FROM COALESCE(OLD.account_name,'')
  ) AND NEW.status = 'verified' AND OLD.status = 'verified' THEN
    NEW.status := 'pending_verification';
    NEW.independent_verification_date := NULL;
    NEW.verified_by := NULL;
    NEW.verified_by_name := NULL;
    NEW.verification_method := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fpbd_reverify ON public.finance_partner_bank_details;
CREATE TRIGGER trg_fpbd_reverify BEFORE UPDATE ON public.finance_partner_bank_details
  FOR EACH ROW EXECUTE FUNCTION public.fp_bank_details_reverify_on_change();

CREATE OR REPLACE FUNCTION public.fp_partner_banking_verified(_finance_contact_id UUID)
RETURNS TABLE(verified BOOLEAN, bank_detail_id UUID, status TEXT, independent_verification_date DATE)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (b.status = 'verified'), b.id, b.status, b.independent_verification_date
  FROM public.finance_partner_bank_details b
  WHERE b.finance_contact_id = _finance_contact_id
    AND b.status <> 'superseded'
  ORDER BY b.version DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fp_partner_banking_verified(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fp_partner_banking_verified(UUID) TO service_role;

-- ── 4. Statement invoicing + clawback offset columns ────────────────────────
ALTER TABLE public.finance_partner_statements
  ADD COLUMN IF NOT EXISTS invoice_mode TEXT,
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.partner_tax_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS clawback_offset_total NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS banking_verified_at_issue BOOLEAN;

DO $$ BEGIN
  ALTER TABLE public.finance_partner_statements
    ADD CONSTRAINT fps_invoice_mode_check CHECK (invoice_mode IS NULL OR invoice_mode IN ('rcti','partner_tax_invoice'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. Agreement invoicing/clawback resolver extension ──────────────────────
DROP FUNCTION IF EXISTS public.fp_resolve_partner_invoicing(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.fp_resolve_partner_invoicing(_finance_contact_id UUID, _direction TEXT DEFAULT 'outbound_finance_referral')
RETURNS TABLE(
  agreement_id UUID,
  agreement_version INTEGER,
  invoice_process TEXT,
  invoice_mode TEXT,
  gst_treatment TEXT,
  clawback_treatment TEXT,
  clawback_repayment_days INTEGER
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id, a.version, a.invoice_process::text,
         CASE WHEN a.invoice_process::text ILIKE '%rcti%' THEN 'rcti' ELSE 'partner_tax_invoice' END,
         a.gst_treatment, a.clawback_treatment, a.clawback_repayment_days
  FROM public.partner_agreements a
  WHERE a.finance_agent_contact_id = _finance_contact_id
    AND a.direction::text = _direction
    AND a.status = 'active'
  ORDER BY a.version DESC, a.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fp_resolve_partner_invoicing(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fp_resolve_partner_invoicing(UUID, TEXT) TO service_role;
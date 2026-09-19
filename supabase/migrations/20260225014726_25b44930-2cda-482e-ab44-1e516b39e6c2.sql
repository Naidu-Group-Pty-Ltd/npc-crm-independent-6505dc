
-- ============================================================
-- DEAL LIFECYCLE TRACKER — DATABASE SCHEMA
-- ============================================================

-- 1. Enum types
CREATE TYPE public.deal_type AS ENUM ('existing_property', 'house_and_land');
CREATE TYPE public.deal_risk_status AS ENUM ('on_track', 'needs_follow_up', 'urgent');
CREATE TYPE public.deal_stage_status AS ENUM ('pending', 'in_progress', 'complete', 'skipped');

-- ============================================================
-- 2. CLIENT DEALS — Master deal record
-- ============================================================
CREATE TABLE public.client_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.client_properties(id) ON DELETE SET NULL,
  deal_type public.deal_type NOT NULL DEFAULT 'existing_property',
  current_stage text NOT NULL DEFAULT 'Exclusive Client Signed',
  current_stage_number integer NOT NULL DEFAULT 1,
  risk_status public.deal_risk_status NOT NULL DEFAULT 'on_track',
  responsible_person text,

  -- Financial Control Fields
  total_contract_price numeric,
  land_price numeric,
  build_price numeric,
  loan_amount numeric,
  valuation_completed boolean DEFAULT false,
  shortfall_required numeric,
  client_contribution_confirmed boolean DEFAULT false,
  lmi_applied boolean DEFAULT false,
  construction_loan_type text, -- 'progress' or 'turnkey'

  -- Critical Dates
  finance_clause_expiry date,
  settlement_date date,
  land_settlement_date date,
  expected_build_start date,
  estimated_completion date,

  -- Metadata
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast client lookups
CREATE INDEX idx_client_deals_client_id ON public.client_deals(client_id);
CREATE INDEX idx_client_deals_risk_status ON public.client_deals(risk_status);
CREATE INDEX idx_client_deals_deal_type ON public.client_deals(deal_type);

-- Auto-update timestamp trigger
CREATE TRIGGER update_client_deals_updated_at
  BEFORE UPDATE ON public.client_deals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.client_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to client_deals for authenticated users"
  ON public.client_deals
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 3. DEAL STAGES — Per-stage progression log
-- ============================================================
CREATE TABLE public.deal_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.client_deals(id) ON DELETE CASCADE,
  stage_number integer NOT NULL,
  stage_name text NOT NULL,
  stage_category text,
  status public.deal_stage_status NOT NULL DEFAULT 'pending',
  client_action text,
  internal_action text,
  responsible text,
  key_date date,
  completed_at timestamptz,
  percentage_or_amount text,
  notes text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deal_stages_deal_id ON public.deal_stages(deal_id);

-- RLS
ALTER TABLE public.deal_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to deal_stages for authenticated users"
  ON public.deal_stages
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 4. BUILD PROGRESS PAYMENTS — H&L construction stages
-- ============================================================
CREATE TABLE public.build_progress_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.client_deals(id) ON DELETE CASCADE,
  stage_number integer NOT NULL,
  stage_name text NOT NULL,
  percentage numeric NOT NULL DEFAULT 0,
  amount numeric,

  -- Builder invoice tracking
  builder_invoice_received boolean DEFAULT false,
  builder_invoice_date date,

  -- Lender submission
  submitted_to_lender boolean DEFAULT false,
  submitted_to_lender_date date,

  -- Funds release
  funds_released boolean DEFAULT false,
  funds_released_date date,

  -- Builder payment
  paid_to_builder boolean DEFAULT false,
  paid_to_builder_date date,

  -- Commission tracking
  is_commission_trigger boolean DEFAULT false,
  commission_received boolean DEFAULT false,
  commission_received_date date,
  commission_amount numeric,

  notes text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_build_progress_deal_id ON public.build_progress_payments(deal_id);

CREATE TRIGGER update_build_progress_updated_at
  BEFORE UPDATE ON public.build_progress_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.build_progress_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to build_progress_payments for authenticated users"
  ON public.build_progress_payments
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 5. BUILDER INVOICES — Audit log for invoices
-- ============================================================
CREATE TABLE public.builder_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.client_deals(id) ON DELETE CASCADE,
  build_payment_id uuid REFERENCES public.build_progress_payments(id) ON DELETE SET NULL,
  client_name text,
  build_stage text,
  invoice_date date,
  invoice_amount numeric,
  submitted_to_lender boolean DEFAULT false,
  submitted_date date,
  funds_released boolean DEFAULT false,
  funds_released_date date,
  paid_to_builder boolean DEFAULT false,
  paid_to_builder_date date,
  commission_received boolean DEFAULT false,
  commission_amount numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_builder_invoices_deal_id ON public.builder_invoices(deal_id);

-- RLS
ALTER TABLE public.builder_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to builder_invoices for authenticated users"
  ON public.builder_invoices
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

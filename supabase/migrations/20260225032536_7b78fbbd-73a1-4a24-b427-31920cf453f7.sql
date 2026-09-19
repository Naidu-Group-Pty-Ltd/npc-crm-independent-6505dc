
-- 1. Add 'refinance' to the deal_type enum
ALTER TYPE public.deal_type ADD VALUE IF NOT EXISTS 'refinance';

-- 2. Add refinance-specific columns to client_deals
ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS existing_loan_amount numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS new_loan_amount numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS equity_released numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cash_out_purpose text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cash_out_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS discharge_authority_date text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lodgement_date text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS valuation_date text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS conditional_approval_date text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS formal_approval_date text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS loan_docs_signed_date text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS commission_estimate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trail_commission numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS clawback_period_months integer DEFAULT 24,
  ADD COLUMN IF NOT EXISTS clawback_expiry_date text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS clawback_risk_active boolean DEFAULT false;

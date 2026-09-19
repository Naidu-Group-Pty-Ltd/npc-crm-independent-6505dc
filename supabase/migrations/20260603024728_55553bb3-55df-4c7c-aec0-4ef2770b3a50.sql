-- Batch 8: Calculator scenarios + lender rate cards

CREATE TABLE IF NOT EXISTS public.purchase_file_calculator_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  finance_user_id uuid,
  calculator_type text NOT NULL CHECK (calculator_type IN (
    'borrowing_capacity','lender_comparison','stamp_duty','lmi','bridging','refinance','rate_change'
  )),
  label text,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pfcalc_file ON public.purchase_file_calculator_scenarios(purchase_file_id);
CREATE INDEX IF NOT EXISTS idx_pfcalc_user ON public.purchase_file_calculator_scenarios(finance_user_id);

GRANT ALL ON public.purchase_file_calculator_scenarios TO service_role;
ALTER TABLE public.purchase_file_calculator_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_calc_scenarios" ON public.purchase_file_calculator_scenarios
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_pfcalc_updated
  BEFORE UPDATE ON public.purchase_file_calculator_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE IF NOT EXISTS public.lender_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_key text NOT NULL,
  product_name text NOT NULL,
  loan_purpose text NOT NULL DEFAULT 'owner_occupier' CHECK (loan_purpose IN ('owner_occupier','investor')),
  repayment_type text NOT NULL DEFAULT 'principal_and_interest' CHECK (repayment_type IN ('principal_and_interest','interest_only')),
  rate_pa numeric(6,4) NOT NULL,
  comparison_rate numeric(6,4),
  max_lvr numeric(5,2) NOT NULL DEFAULT 95.00,
  lmi_waiver_at_lvr numeric(5,2),
  upfront_fees numeric(10,2) NOT NULL DEFAULT 0,
  ongoing_fees_annual numeric(10,2) NOT NULL DEFAULT 0,
  offset_available boolean NOT NULL DEFAULT false,
  redraw_available boolean NOT NULL DEFAULT false,
  fixed_term_months integer,
  min_loan numeric(12,2),
  max_loan numeric(12,2),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lrc_lender ON public.lender_rate_cards(lender_key);
CREATE INDEX IF NOT EXISTS idx_lrc_active ON public.lender_rate_cards(is_active);

GRANT ALL ON public.lender_rate_cards TO service_role;
ALTER TABLE public.lender_rate_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_lender_rate_cards" ON public.lender_rate_cards
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_lrc_updated
  BEFORE UPDATE ON public.lender_rate_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
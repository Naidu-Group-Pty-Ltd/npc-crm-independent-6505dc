-- Create borrowing capacity assessments table
CREATE TABLE public.borrowing_capacity_assessments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  
  -- Income Summary
  gross_annual_income NUMERIC NOT NULL DEFAULT 0,
  shaded_annual_income NUMERIC NOT NULL DEFAULT 0,
  income_breakdown JSONB,
  
  -- Expense Summary  
  living_expenses_monthly NUMERIC NOT NULL DEFAULT 0,
  expense_method TEXT DEFAULT 'hem',
  expense_breakdown JSONB,
  
  -- Liability Summary
  existing_commitments_monthly NUMERIC NOT NULL DEFAULT 0,
  liability_breakdown JSONB,
  
  -- Calculation Parameters
  interest_rate_used NUMERIC DEFAULT 6.50,
  buffer_rate NUMERIC DEFAULT 3.00,
  assessment_rate NUMERIC GENERATED ALWAYS AS (interest_rate_used + buffer_rate) STORED,
  loan_term_years INTEGER DEFAULT 30,
  proposed_loan_amount NUMERIC,
  proposed_lvr NUMERIC DEFAULT 80,
  
  -- Results
  borrowing_capacity NUMERIC NOT NULL DEFAULT 0,
  monthly_surplus NUMERIC NOT NULL DEFAULT 0,
  serviceability_band TEXT NOT NULL DEFAULT 'red',
  stress_tested_capacity NUMERIC DEFAULT 0,
  dti_ratio NUMERIC DEFAULT 0,
  
  -- Recommendations
  recommendations JSONB DEFAULT '[]',
  warnings TEXT[] DEFAULT '{}',
  assumptions JSONB DEFAULT '{}',
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  calculated_by UUID REFERENCES custom_users(id)
);

-- Indexes
CREATE INDEX idx_bc_client ON borrowing_capacity_assessments(client_id);
CREATE INDEX idx_bc_band ON borrowing_capacity_assessments(serviceability_band);
CREATE INDEX idx_bc_created ON borrowing_capacity_assessments(created_at DESC);

-- RLS
ALTER TABLE public.borrowing_capacity_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.borrowing_capacity_assessments
  FOR SELECT USING (true);

CREATE POLICY "Service role full access" ON public.borrowing_capacity_assessments
  FOR ALL USING (true);

-- Auto-update timestamp trigger
CREATE TRIGGER update_bc_updated_at
  BEFORE UPDATE ON public.borrowing_capacity_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
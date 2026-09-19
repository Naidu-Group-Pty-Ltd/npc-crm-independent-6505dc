
-- Create income source types
CREATE TABLE public.client_income_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL DEFAULT 'primary',
  
  -- Source classification
  source_category TEXT NOT NULL DEFAULT 'employment',  -- employment, passive, government, investment, other
  source_type TEXT NOT NULL DEFAULT 'payg_fulltime',   -- payg_fulltime, payg_parttime, casual, self_employed, contract, rental, dividends, interest, centrelink, pension, trust, other
  source_name TEXT,  -- e.g. employer name, investment name, benefit type
  
  -- Income amounts (all stored as annual)
  gross_annual_amount NUMERIC NOT NULL DEFAULT 0,
  input_frequency TEXT NOT NULL DEFAULT 'annual',  -- weekly, fortnightly, monthly, annual (for UI display/conversion)
  input_amount NUMERIC NOT NULL DEFAULT 0,  -- raw amount as entered by user
  
  -- Employment-specific sub-fields (annual amounts)
  bonus NUMERIC DEFAULT 0,
  commission NUMERIC DEFAULT 0,
  overtime_essential NUMERIC DEFAULT 0,
  overtime_non_essential NUMERIC DEFAULT 0,
  allowance NUMERIC DEFAULT 0,
  other_taxable_income NUMERIC DEFAULT 0,
  
  -- Shading for borrowing capacity
  default_shading_rate NUMERIC NOT NULL DEFAULT 1.0,  -- system default based on type
  custom_shading_rate NUMERIC,  -- user override, NULL means use default
  
  -- Metadata
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.client_income_sources ENABLE ROW LEVEL SECURITY;

-- RLS policies (service-role only, matching existing pattern)
CREATE POLICY "Service role full access on client_income_sources"
  ON public.client_income_sources
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX idx_client_income_sources_client_id ON public.client_income_sources(client_id);
CREATE INDEX idx_client_income_sources_contact_type ON public.client_income_sources(client_id, contact_type);

-- Trigger for updated_at
CREATE TRIGGER update_client_income_sources_updated_at
  BEFORE UPDATE ON public.client_income_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Migrate existing client_income data into client_income_sources
-- Each existing record becomes a single "PAYG Full-time" source
INSERT INTO public.client_income_sources (
  client_id, contact_type, source_category, source_type, source_name,
  gross_annual_amount, input_frequency, input_amount,
  bonus, commission, overtime_essential, overtime_non_essential,
  allowance, other_taxable_income,
  default_shading_rate, display_order
)
SELECT
  ci.client_id,
  ci.contact_type,
  'employment',
  'payg_fulltime',
  COALESCE(ce.employer_name, 'Primary Employment'),
  CASE 
    WHEN ci.salary_frequency = 'weekly' THEN COALESCE(ci.gross_salary, 0) * 52
    WHEN ci.salary_frequency = 'fortnightly' THEN COALESCE(ci.gross_salary, 0) * 26
    WHEN ci.salary_frequency = 'monthly' THEN COALESCE(ci.gross_salary, 0) * 12
    ELSE COALESCE(ci.gross_salary, 0)
  END,
  COALESCE(ci.salary_frequency, 'annual'),
  COALESCE(ci.gross_salary, 0),
  COALESCE(ci.bonus, 0),
  COALESCE(ci.commission, 0),
  COALESCE(ci.overtime_essential, 0),
  COALESCE(ci.overtime_non_essential, 0),
  COALESCE(ci.allowance, 0),
  COALESCE(ci.other_taxable_income, 0),
  1.0,
  0
FROM public.client_income ci
LEFT JOIN public.client_employment ce ON ce.client_id = ci.client_id AND ce.contact_type = ci.contact_type AND ce.is_current = true
WHERE COALESCE(ci.gross_salary, 0) > 0
   OR COALESCE(ci.bonus, 0) > 0
   OR COALESCE(ci.commission, 0) > 0
   OR COALESCE(ci.overtime_essential, 0) > 0
   OR COALESCE(ci.overtime_non_essential, 0) > 0
   OR COALESCE(ci.allowance, 0) > 0
   OR COALESCE(ci.other_taxable_income, 0) > 0;

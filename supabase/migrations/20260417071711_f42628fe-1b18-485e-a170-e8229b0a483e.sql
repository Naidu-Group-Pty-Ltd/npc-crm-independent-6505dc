ALTER TABLE public.client_properties
  ADD COLUMN IF NOT EXISTS repayment_type text
    CHECK (repayment_type IN ('principal_and_interest','interest_only')),
  ADD COLUMN IF NOT EXISTS interest_only_period_years integer;

UPDATE public.client_properties
SET repayment_type = CASE
  WHEN COALESCE(loan_repayment_amount, 0) > 0 THEN 'principal_and_interest'
  WHEN COALESCE(loan_remaining, 0) > 0        THEN 'interest_only'
  ELSE NULL
END
WHERE repayment_type IS NULL;

UPDATE public.client_properties
SET monthly_interest_repayment = CASE
  WHEN loan_repayment_frequency = 'weekly' THEN loan_repayment_amount * (52.0/12.0)
  ELSE loan_repayment_amount
END
WHERE COALESCE(monthly_interest_repayment, 0) = 0
  AND COALESCE(loan_repayment_amount, 0) > 0;

COMMENT ON COLUMN public.client_properties.repayment_type IS
  'Repayment structure: principal_and_interest or interest_only. Drives BC and what-if calcs.';
COMMENT ON COLUMN public.client_properties.interest_only_period_years IS
  'For interest_only loans, the IO period before reverting to P&I (e.g. 5).';
COMMENT ON COLUMN public.client_properties.loan_repayment_amount IS
  'DEPRECATED: superseded by monthly_interest_repayment + repayment_type. Retained for backfill only.';
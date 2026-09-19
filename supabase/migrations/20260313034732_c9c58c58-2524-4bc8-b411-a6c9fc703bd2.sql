ALTER TABLE public.client_properties
  ADD COLUMN IF NOT EXISTS loan_repayment_amount numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS loan_repayment_frequency text DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS lender_name text DEFAULT NULL;
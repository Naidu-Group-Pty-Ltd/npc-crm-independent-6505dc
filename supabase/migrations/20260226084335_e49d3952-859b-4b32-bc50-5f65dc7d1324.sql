-- Add LMI-related columns to borrowing_capacity_assessments
ALTER TABLE public.borrowing_capacity_assessments
  ADD COLUMN IF NOT EXISTS lmi_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lmi_mode text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS lmi_lvr_trigger numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS property_value_estimate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS net_purchase_capacity numeric DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.borrowing_capacity_assessments.lmi_mode IS 'none | display_deduction | debt_capitalised';
COMMENT ON COLUMN public.borrowing_capacity_assessments.lmi_amount IS 'LMI premium amount (manual or auto-estimated)';
COMMENT ON COLUMN public.borrowing_capacity_assessments.net_purchase_capacity IS 'borrowing_capacity minus LMI (display_deduction mode)';
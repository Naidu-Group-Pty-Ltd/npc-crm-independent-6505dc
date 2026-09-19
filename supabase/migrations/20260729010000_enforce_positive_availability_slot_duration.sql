-- Repair legacy invalid values before enforcing the invariant at the storage boundary.
UPDATE public.finance_partner_availability
SET slot_duration_min = 30,
    updated_at = now()
WHERE slot_duration_min <= 0;

ALTER TABLE public.finance_partner_availability
  ADD CONSTRAINT finance_partner_availability_slot_duration_positive
  CHECK (slot_duration_min > 0);

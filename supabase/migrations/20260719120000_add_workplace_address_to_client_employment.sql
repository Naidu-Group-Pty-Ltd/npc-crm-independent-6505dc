-- Optional employer location fields are deliberately stored on the employment record.
-- They are not residential addresses and are therefore excluded from client_address_history.
ALTER TABLE public.client_employment
  ADD COLUMN IF NOT EXISTS workplace_address_line_1 text,
  ADD COLUMN IF NOT EXISTS workplace_suburb text,
  ADD COLUMN IF NOT EXISTS workplace_state text,
  ADD COLUMN IF NOT EXISTS workplace_postcode text,
  ADD COLUMN IF NOT EXISTS workplace_country text,
  ADD COLUMN IF NOT EXISTS work_arrangement text;

ALTER TABLE public.client_employment
  ADD COLUMN IF NOT EXISTS workplace_address_line_1 text,
  ADD COLUMN IF NOT EXISTS workplace_suburb text,
  ADD COLUMN IF NOT EXISTS workplace_state text,
  ADD COLUMN IF NOT EXISTS workplace_postcode text,
  ADD COLUMN IF NOT EXISTS workplace_country text,
  ADD COLUMN IF NOT EXISTS work_arrangement text;
-- Add purchase_price and purchase_date columns to client_properties
ALTER TABLE public.client_properties
  ADD COLUMN IF NOT EXISTS purchase_price numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS purchase_date date DEFAULT NULL;
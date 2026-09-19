
-- Add property address field to client_deals
ALTER TABLE public.client_deals ADD COLUMN IF NOT EXISTS property_address text;

-- Add invoice_received fields to deal_stages
ALTER TABLE public.deal_stages ADD COLUMN IF NOT EXISTS invoice_received boolean DEFAULT false;
ALTER TABLE public.deal_stages ADD COLUMN IF NOT EXISTS invoice_received_date timestamptz;


-- Add sourcing/deal tracking columns to client_properties
ALTER TABLE public.client_properties
  ADD COLUMN IF NOT EXISTS sourced_by text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS deal_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sourced_notes text;

-- Add deal status columns to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deal_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS first_deal_closed_at timestamptz;

-- Add per-contact address and ID fields to client_additional_contacts
ALTER TABLE public.client_additional_contacts
  ADD COLUMN current_address text,
  ADD COLUMN country text DEFAULT 'Australia',
  ADD COLUMN living_situation text,
  ADD COLUMN residential_status text,
  ADD COLUMN same_address_as_primary boolean DEFAULT false;

-- Also add address fields to the clients table for the secondary contact
-- (primary already has current_address, country, living_situation, residential_status on the clients table)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS secondary_current_address text,
  ADD COLUMN IF NOT EXISTS secondary_country text DEFAULT 'Australia',
  ADD COLUMN IF NOT EXISTS secondary_living_situation text,
  ADD COLUMN IF NOT EXISTS secondary_residential_status text,
  ADD COLUMN IF NOT EXISTS secondary_same_address_as_primary boolean DEFAULT false;
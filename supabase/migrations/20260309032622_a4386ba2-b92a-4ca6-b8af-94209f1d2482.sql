-- Add Gamma-related columns to agency_agreements
ALTER TABLE public.agency_agreements 
  ADD COLUMN IF NOT EXISTS gamma_document_id TEXT,
  ADD COLUMN IF NOT EXISTS gamma_document_url TEXT,
  ADD COLUMN IF NOT EXISTS initial_commitment_fee NUMERIC;

-- Agency agreements tracking table
CREATE TABLE public.agency_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES public.client_deals(id) ON DELETE SET NULL,
  
  -- Status tracking
  status text NOT NULL DEFAULT 'draft',
  
  -- DocuSign integration
  docusign_envelope_id text,
  docusign_status text,
  docusign_sent_at timestamptz,
  docusign_signed_at timestamptz,
  docusign_voided_at timestamptz,
  
  -- Pre-filled field values (snapshot at time of generation)
  buyer_names text NOT NULL,
  buyer_address text,
  buyer_phone text,
  buyer_email text,
  agreement_date date NOT NULL DEFAULT CURRENT_DATE,
  
  -- Secondary buyer (if applicable)
  secondary_buyer_name text,
  
  -- PDF storage
  pdf_storage_path text,
  signed_pdf_storage_path text,
  
  -- Metadata
  sent_via text DEFAULT 'docusign',
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agency_agreements ENABLE ROW LEVEL SECURITY;

-- Updated_at trigger
CREATE TRIGGER update_agency_agreements_updated_at
  BEFORE UPDATE ON public.agency_agreements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add to activity log enums
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'agreement_generated';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'agreement_sent';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'agreement_signed';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'agreement_voided';

ALTER TYPE public.activity_entity_type ADD VALUE IF NOT EXISTS 'agency_agreement';

-- Add finance_contact_id to clients (assigned finance partner at the client level)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS finance_contact_id UUID REFERENCES public.finance_agent_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_finance_contact_id 
  ON public.clients(finance_contact_id) 
  WHERE finance_contact_id IS NOT NULL;

-- Add finance_contact_id to client_deals (per-deal override)
ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS finance_contact_id UUID REFERENCES public.finance_agent_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_deals_finance_contact_id 
  ON public.client_deals(finance_contact_id) 
  WHERE finance_contact_id IS NOT NULL;

-- Comments for future maintainers
COMMENT ON COLUMN public.clients.finance_contact_id IS 
  'Optional link to the finance partner contact assigned at the client level. Drives Finance Portal auto-link (assigned_contact source) and finance partner notifications.';

COMMENT ON COLUMN public.client_deals.finance_contact_id IS 
  'Optional per-deal finance partner override. Drives Finance Portal auto-link (deal_pipeline source).';
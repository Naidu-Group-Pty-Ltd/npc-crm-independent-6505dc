-- Create client_address_history table
CREATE TABLE public.client_address_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL DEFAULT 'primary',
  additional_contact_id UUID NULL REFERENCES public.client_additional_contacts(id) ON DELETE CASCADE,
  address TEXT NULL,
  country TEXT NULL DEFAULT 'Australia',
  living_situation TEXT NULL,
  residential_status TEXT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  months_at_address INTEGER NULL,
  notes TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS (service-role only model)
ALTER TABLE public.client_address_history ENABLE ROW LEVEL SECURITY;

-- Service-role-only policy (consistent with other client tables)
CREATE POLICY "Service role full access on client_address_history"
  ON public.client_address_history
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for fast lookups by client
CREATE INDEX idx_client_address_history_client_id ON public.client_address_history(client_id);
CREATE INDEX idx_client_address_history_contact ON public.client_address_history(client_id, contact_type);

-- Timestamp trigger
CREATE TRIGGER update_client_address_history_updated_at
  BEFORE UPDATE ON public.client_address_history
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
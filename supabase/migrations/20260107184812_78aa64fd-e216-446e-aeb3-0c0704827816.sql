-- Create finance agent contacts table
CREATE TABLE public.finance_agent_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  contact_type TEXT DEFAULT 'external' CHECK (contact_type IN ('internal', 'external')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.custom_users(id),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.finance_agent_contacts ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to view contacts
CREATE POLICY "Anyone can view finance contacts"
ON public.finance_agent_contacts
FOR SELECT
USING (is_active = true);

-- Allow admins to manage contacts
CREATE POLICY "Admins can manage finance contacts"
ON public.finance_agent_contacts
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_finance_contacts_active ON public.finance_agent_contacts(is_active);
CREATE INDEX idx_finance_contacts_default ON public.finance_agent_contacts(is_default) WHERE is_default = true;

-- Create trigger for updated_at
CREATE TRIGGER update_finance_agent_contacts_updated_at
BEFORE UPDATE ON public.finance_agent_contacts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
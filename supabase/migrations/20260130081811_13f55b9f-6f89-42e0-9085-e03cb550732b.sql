-- Create table for additional contacts (beyond primary and secondary)
CREATE TABLE public.client_additional_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'Additional Contact',
  first_name TEXT NOT NULL,
  surname TEXT NOT NULL,
  middle_name TEXT,
  email TEXT,
  mobile TEXT,
  dob DATE,
  gender TEXT,
  display_order INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS (service_role only pattern)
ALTER TABLE public.client_additional_contacts ENABLE ROW LEVEL SECURITY;

-- Create index for efficient client lookups
CREATE INDEX idx_client_additional_contacts_client_id ON public.client_additional_contacts(client_id);
CREATE INDEX idx_client_additional_contacts_display_order ON public.client_additional_contacts(client_id, display_order);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_client_additional_contacts_updated_at
  BEFORE UPDATE ON public.client_additional_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add comment for documentation
COMMENT ON TABLE public.client_additional_contacts IS 'Stores additional contacts beyond primary and secondary for each client';
COMMENT ON COLUMN public.client_additional_contacts.relationship IS 'The relationship or role of this contact (e.g., Guarantor, Family Member, Business Partner, Accountant, Solicitor)';
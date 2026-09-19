-- Create enum for report request types
CREATE TYPE public.portal_report_request_type AS ENUM (
  'portfolio_review',
  'borrowing_capacity',
  'investment_property'
);

-- Create enum for report request status
CREATE TYPE public.portal_report_request_status AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'declined'
);

-- Create the report requests table
CREATE TABLE public.client_portal_report_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  portal_user_id UUID REFERENCES public.client_portal_users(id) ON DELETE SET NULL,
  request_type portal_report_request_type NOT NULL,
  status portal_report_request_status NOT NULL DEFAULT 'pending',
  property_address TEXT,
  client_property_id UUID REFERENCES public.client_properties(id) ON DELETE SET NULL,
  notes TEXT,
  admin_notes TEXT,
  assigned_to UUID REFERENCES public.custom_users(id) ON DELETE SET NULL,
  fulfilled_report_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (service_role only pattern)
ALTER TABLE public.client_portal_report_requests ENABLE ROW LEVEL SECURITY;

-- Add updated_at trigger
CREATE TRIGGER update_report_requests_updated_at
  BEFORE UPDATE ON public.client_portal_report_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for fast client lookups
CREATE INDEX idx_report_requests_client_id ON public.client_portal_report_requests(client_id);
CREATE INDEX idx_report_requests_status ON public.client_portal_report_requests(status);
CREATE INDEX idx_report_requests_created_at ON public.client_portal_report_requests(created_at DESC);
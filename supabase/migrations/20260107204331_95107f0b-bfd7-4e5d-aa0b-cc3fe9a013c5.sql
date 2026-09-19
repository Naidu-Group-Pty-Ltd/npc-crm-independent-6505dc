-- Add SMSF-specific columns to client_properties table
ALTER TABLE public.client_properties
ADD COLUMN IF NOT EXISTS smsf_fund_name TEXT,
ADD COLUMN IF NOT EXISTS smsf_trustee_name TEXT,
ADD COLUMN IF NOT EXISTS smsf_trustee_type TEXT CHECK (smsf_trustee_type IN ('individual', 'corporate')),
ADD COLUMN IF NOT EXISTS smsf_abn TEXT,
ADD COLUMN IF NOT EXISTS smsf_compliance_status TEXT CHECK (smsf_compliance_status IN ('compliant', 'non_compliant', 'pending_audit')),
ADD COLUMN IF NOT EXISTS smsf_auditor_name TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.client_properties.smsf_fund_name IS 'Self-Managed Super Fund name';
COMMENT ON COLUMN public.client_properties.smsf_trustee_name IS 'Name of the SMSF trustee';
COMMENT ON COLUMN public.client_properties.smsf_trustee_type IS 'Type of trustee: individual or corporate';
COMMENT ON COLUMN public.client_properties.smsf_abn IS 'Australian Business Number for the SMSF';
COMMENT ON COLUMN public.client_properties.smsf_compliance_status IS 'Current compliance status of the SMSF';
COMMENT ON COLUMN public.client_properties.smsf_auditor_name IS 'Name of the SMSF auditor';
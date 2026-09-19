-- =============================================
-- CLIENT MANAGEMENT SCHEMA
-- =============================================

-- Main clients table (primary + secondary contacts)
CREATE TABLE public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- GHL Integration
  ghl_contact_id TEXT,
  ghl_sync_status TEXT DEFAULT 'pending',
  ghl_last_synced_at TIMESTAMP WITH TIME ZONE,
  
  -- Primary Contact
  primary_first_name TEXT NOT NULL,
  primary_middle_name TEXT,
  primary_surname TEXT NOT NULL,
  primary_mobile TEXT,
  primary_email TEXT,
  primary_gender TEXT,
  primary_dob DATE,
  
  -- Secondary Contact (for joint applications)
  secondary_first_name TEXT,
  secondary_middle_name TEXT,
  secondary_surname TEXT,
  secondary_mobile TEXT,
  secondary_email TEXT,
  secondary_gender TEXT,
  secondary_dob DATE,
  
  -- Address
  current_address TEXT,
  country TEXT DEFAULT 'Australia',
  living_situation TEXT, -- renting/living with parents/home with mortgage
  
  -- ID & Status
  residential_status TEXT, -- Permanent Resident/Citizen
  
  -- Family Relations
  marital_status TEXT, -- Single/married/defacto
  dependents_count INTEGER DEFAULT 0,
  
  -- Portfolio Summary (calculated/cached)
  total_portfolio_value NUMERIC(15,2) DEFAULT 0,
  total_debt NUMERIC(15,2) DEFAULT 0,
  total_monthly_expenditure NUMERIC(12,2) DEFAULT 0,
  total_monthly_income NUMERIC(12,2) DEFAULT 0,
  total_monthly_rental_income NUMERIC(12,2) DEFAULT 0,
  net_monthly_cash_flow NUMERIC(12,2) DEFAULT 0,
  
  -- Notes
  notes TEXT,
  
  -- Metadata
  created_by UUID REFERENCES public.custom_users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Client properties table
CREATE TABLE public.client_properties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  
  -- Property Type
  property_type TEXT NOT NULL DEFAULT 'investment', -- 'owner_occupied' or 'investment'
  
  -- Basic Info
  address TEXT NOT NULL,
  value NUMERIC(15,2),
  loan_remaining NUMERIC(15,2) DEFAULT 0,
  interest_rate NUMERIC(5,2),
  ownership_percentage NUMERIC(5,2) DEFAULT 100,
  
  -- Calculated
  monthly_interest_repayment NUMERIC(12,2) DEFAULT 0,
  
  -- Expenses (monthly equivalents)
  monthly_body_corporate NUMERIC(10,2) DEFAULT 0,
  monthly_council_rates NUMERIC(10,2) DEFAULT 0,
  monthly_water_rates NUMERIC(10,2) DEFAULT 0,
  monthly_repairs_maintenance NUMERIC(10,2) DEFAULT 0,
  monthly_property_management NUMERIC(10,2) DEFAULT 0,
  monthly_landlord_insurance NUMERIC(10,2) DEFAULT 0,
  monthly_building_insurance NUMERIC(10,2) DEFAULT 0,
  
  -- Income (for investment properties)
  monthly_rental_income NUMERIC(12,2) DEFAULT 0,
  weekly_rental_income NUMERIC(10,2) DEFAULT 0,
  
  -- Calculated totals
  total_monthly_expenditure NUMERIC(12,2) DEFAULT 0,
  net_monthly_cashflow NUMERIC(12,2) DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Client employment table
CREATE TABLE public.client_employment (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  
  contact_type TEXT NOT NULL DEFAULT 'primary', -- 'primary' or 'secondary'
  
  employer_name TEXT,
  employment_type TEXT, -- permanent/part time/casual/contract
  occupation_role TEXT,
  start_date DATE,
  is_current BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Client income table
CREATE TABLE public.client_income (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  
  contact_type TEXT NOT NULL DEFAULT 'primary', -- 'primary' or 'secondary'
  
  -- All stored as annual amounts
  gross_salary NUMERIC(12,2) DEFAULT 0,
  salary_frequency TEXT DEFAULT 'annual', -- weekly/fortnightly/monthly/annual
  bonus NUMERIC(12,2) DEFAULT 0,
  allowance NUMERIC(12,2) DEFAULT 0,
  commission NUMERIC(12,2) DEFAULT 0,
  overtime_essential NUMERIC(12,2) DEFAULT 0,
  overtime_non_essential NUMERIC(12,2) DEFAULT 0,
  other_taxable_income NUMERIC(12,2) DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Client assets table
CREATE TABLE public.client_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  
  asset_type TEXT NOT NULL, -- 'vehicle', 'savings', 'superfund', 'other'
  
  -- For vehicles
  vehicle_type TEXT,
  make_model TEXT,
  
  -- For superfund
  institution_name TEXT,
  
  -- Common
  description TEXT,
  value NUMERIC(15,2) DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Client liabilities table
CREATE TABLE public.client_liabilities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  
  liability_type TEXT NOT NULL, -- 'mortgage', 'credit_card', 'personal_loan', 'vehicle_loan', 'student_loan', 'other'
  
  provider_name TEXT,
  current_balance NUMERIC(15,2) DEFAULT 0,
  credit_limit NUMERIC(15,2), -- for credit cards
  interest_rate NUMERIC(5,2),
  monthly_repayment NUMERIC(12,2) DEFAULT 0,
  repayment_type TEXT, -- 'principal_and_interest', 'interest_only'
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Client import logs table
CREATE TABLE public.client_import_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  file_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  clients_created INTEGER DEFAULT 0,
  properties_created INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  
  imported_by UUID REFERENCES public.custom_users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_clients_ghl_contact_id ON public.clients(ghl_contact_id);
CREATE INDEX idx_clients_primary_email ON public.clients(primary_email);
CREATE INDEX idx_clients_created_by ON public.clients(created_by);
CREATE INDEX idx_client_properties_client_id ON public.client_properties(client_id);
CREATE INDEX idx_client_employment_client_id ON public.client_employment(client_id);
CREATE INDEX idx_client_income_client_id ON public.client_income(client_id);
CREATE INDEX idx_client_assets_client_id ON public.client_assets(client_id);
CREATE INDEX idx_client_liabilities_client_id ON public.client_liabilities(client_id);

-- =============================================
-- ENABLE RLS
-- =============================================
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_employment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_income ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_liabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_import_logs ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES - Clients
-- =============================================
CREATE POLICY "Anyone can view clients" ON public.clients FOR SELECT USING (true);
CREATE POLICY "Anyone can create clients" ON public.clients FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update clients" ON public.clients FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete clients" ON public.clients FOR DELETE USING (true);

-- =============================================
-- RLS POLICIES - Client Properties
-- =============================================
CREATE POLICY "Anyone can view client properties" ON public.client_properties FOR SELECT USING (true);
CREATE POLICY "Anyone can create client properties" ON public.client_properties FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update client properties" ON public.client_properties FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete client properties" ON public.client_properties FOR DELETE USING (true);

-- =============================================
-- RLS POLICIES - Client Employment
-- =============================================
CREATE POLICY "Anyone can view client employment" ON public.client_employment FOR SELECT USING (true);
CREATE POLICY "Anyone can create client employment" ON public.client_employment FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update client employment" ON public.client_employment FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete client employment" ON public.client_employment FOR DELETE USING (true);

-- =============================================
-- RLS POLICIES - Client Income
-- =============================================
CREATE POLICY "Anyone can view client income" ON public.client_income FOR SELECT USING (true);
CREATE POLICY "Anyone can create client income" ON public.client_income FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update client income" ON public.client_income FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete client income" ON public.client_income FOR DELETE USING (true);

-- =============================================
-- RLS POLICIES - Client Assets
-- =============================================
CREATE POLICY "Anyone can view client assets" ON public.client_assets FOR SELECT USING (true);
CREATE POLICY "Anyone can create client assets" ON public.client_assets FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update client assets" ON public.client_assets FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete client assets" ON public.client_assets FOR DELETE USING (true);

-- =============================================
-- RLS POLICIES - Client Liabilities
-- =============================================
CREATE POLICY "Anyone can view client liabilities" ON public.client_liabilities FOR SELECT USING (true);
CREATE POLICY "Anyone can create client liabilities" ON public.client_liabilities FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update client liabilities" ON public.client_liabilities FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete client liabilities" ON public.client_liabilities FOR DELETE USING (true);

-- =============================================
-- RLS POLICIES - Import Logs
-- =============================================
CREATE POLICY "Anyone can view import logs" ON public.client_import_logs FOR SELECT USING (true);
CREATE POLICY "Anyone can create import logs" ON public.client_import_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update import logs" ON public.client_import_logs FOR UPDATE USING (true);

-- =============================================
-- TRIGGERS FOR updated_at
-- =============================================
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_client_properties_updated_at
  BEFORE UPDATE ON public.client_properties
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_client_employment_updated_at
  BEFORE UPDATE ON public.client_employment
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_client_income_updated_at
  BEFORE UPDATE ON public.client_income
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_client_assets_updated_at
  BEFORE UPDATE ON public.client_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_client_liabilities_updated_at
  BEFORE UPDATE ON public.client_liabilities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
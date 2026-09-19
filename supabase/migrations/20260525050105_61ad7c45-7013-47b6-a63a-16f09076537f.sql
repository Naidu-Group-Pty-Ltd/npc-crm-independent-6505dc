
-- Enums
CREATE TYPE public.commercial_asset_class AS ENUM ('office','retail','industrial','mixed_use','medical','childcare','hospitality','other');
CREATE TYPE public.commercial_tenure AS ENUM ('freehold','leasehold','strata');
CREATE TYPE public.commercial_gst_treatment AS ENUM ('going_concern','margin_scheme','standard','input_taxed');
CREATE TYPE public.commercial_rent_basis AS ENUM ('gross','net','semi_gross');
CREATE TYPE public.commercial_review_type AS ENUM ('cpi','fixed_percent','market','hybrid','none');
CREATE TYPE public.commercial_lease_status AS ENUM ('occupied','vacant','holdover','under_offer','expired');
CREATE TYPE public.commercial_security_type AS ENUM ('bond','bank_guarantee','personal_guarantee','none');

-- commercial_properties
CREATE TABLE public.commercial_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  client_id UUID NULL,
  address TEXT NOT NULL,
  suburb TEXT,
  state TEXT,
  postcode TEXT,
  asset_class public.commercial_asset_class NOT NULL DEFAULT 'office',
  asset_sub_type TEXT,
  tenure public.commercial_tenure NOT NULL DEFAULT 'freehold',
  zoning TEXT,
  gfa_sqm NUMERIC,
  nla_sqm NUMERIC,
  site_area_sqm NUMERIC,
  parking_bays INTEGER,
  year_built INTEGER,
  purchase_price NUMERIC,
  acquisition_date DATE,
  gst_treatment public.commercial_gst_treatment NOT NULL DEFAULT 'standard',
  valuation NUMERIC,
  valuation_date DATE,
  valuer TEXT,
  outgoings_recoverable JSONB NOT NULL DEFAULT '{}'::jsonb,
  industrial_specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_commercial_properties_user ON public.commercial_properties(user_id);
CREATE INDEX idx_commercial_properties_client ON public.commercial_properties(client_id);
CREATE INDEX idx_commercial_properties_asset_class ON public.commercial_properties(asset_class);

-- commercial_leases
CREATE TABLE public.commercial_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.commercial_properties(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  tenant_name TEXT NOT NULL,
  suite_unit TEXT,
  nla_sqm NUMERIC,
  lease_start DATE,
  lease_end DATE,
  option_terms JSONB NOT NULL DEFAULT '[]'::jsonb,
  base_rent_pa NUMERIC NOT NULL DEFAULT 0,
  rent_basis public.commercial_rent_basis NOT NULL DEFAULT 'net',
  review_type public.commercial_review_type NOT NULL DEFAULT 'cpi',
  review_freq_months INTEGER DEFAULT 12,
  next_review_date DATE,
  review_amount NUMERIC,
  rent_free_months NUMERIC DEFAULT 0,
  fitout_contribution NUMERIC DEFAULT 0,
  cash_incentive NUMERIC DEFAULT 0,
  outgoings_recovery_pct NUMERIC DEFAULT 0,
  security_type public.commercial_security_type NOT NULL DEFAULT 'none',
  security_amount NUMERIC DEFAULT 0,
  status public.commercial_lease_status NOT NULL DEFAULT 'occupied',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_commercial_leases_property ON public.commercial_leases(property_id);
CREATE INDEX idx_commercial_leases_user ON public.commercial_leases(user_id);
CREATE INDEX idx_commercial_leases_status ON public.commercial_leases(status);
CREATE INDEX idx_commercial_leases_expiry ON public.commercial_leases(lease_end);

-- commercial_dcf_runs
CREATE TABLE public.commercial_dcf_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.commercial_properties(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  scenario_name TEXT NOT NULL DEFAULT 'base',
  hold_period_years INTEGER NOT NULL DEFAULT 10,
  discount_rate NUMERIC NOT NULL DEFAULT 8.00,
  terminal_cap_rate NUMERIC NOT NULL DEFAULT 6.50,
  rental_growth_assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  vacancy_allowance_pct NUMERIC NOT NULL DEFAULT 5.00,
  capex_schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
  loan_amount NUMERIC DEFAULT 0,
  interest_rate NUMERIC DEFAULT 0,
  loan_term_years INTEGER DEFAULT 0,
  outputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  irr NUMERIC,
  npv NUMERIC,
  equity_multiple NUMERIC,
  peak_equity NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_commercial_dcf_property ON public.commercial_dcf_runs(property_id);
CREATE INDEX idx_commercial_dcf_user ON public.commercial_dcf_runs(user_id);

-- Updated_at triggers (reuse existing update_updated_at_column if present, else create)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_commercial_properties_updated
  BEFORE UPDATE ON public.commercial_properties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_commercial_leases_updated
  BEFORE UPDATE ON public.commercial_leases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_commercial_dcf_runs_updated
  BEFORE UPDATE ON public.commercial_dcf_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: strict service_role only (mediated via edge functions per project pattern)
ALTER TABLE public.commercial_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_dcf_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_commercial_properties"
  ON public.commercial_properties FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_all_commercial_leases"
  ON public.commercial_leases FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_all_commercial_dcf_runs"
  ON public.commercial_dcf_runs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

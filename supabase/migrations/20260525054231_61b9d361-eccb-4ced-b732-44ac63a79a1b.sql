
-- Industrial properties
CREATE TABLE public.industrial_properties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  client_id UUID,
  property_name TEXT,
  street TEXT,
  suburb TEXT,
  state TEXT,
  postcode TEXT,
  asset_subtype TEXT NOT NULL DEFAULT 'warehouse',
  purchase_price NUMERIC(14,2),
  purchase_date DATE,
  current_valuation NUMERIC(14,2),
  valuation_date DATE,
  gla_sqm NUMERIC(12,2),
  site_area_sqm NUMERIC(12,2),
  site_cover_pct NUMERIC(5,2),
  office_pct NUMERIC(5,2),
  hardstand_sqm NUMERIC(12,2),
  clearance_metres NUMERIC(6,2),
  power_kva NUMERIC(10,2),
  dock_doors INTEGER,
  ground_floor_load_kpa NUMERIC(8,2),
  zoning TEXT,
  year_built INTEGER,
  condition_rating TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.industrial_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_industrial_properties" ON public.industrial_properties
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_industrial_properties_user ON public.industrial_properties(user_id);
CREATE INDEX idx_industrial_properties_client ON public.industrial_properties(client_id);

-- Industrial tenancies
CREATE TABLE public.industrial_tenancies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.industrial_properties(id) ON DELETE CASCADE,
  tenant_name TEXT NOT NULL,
  anzsic_industry TEXT,
  unit_label TEXT,
  gla_sqm NUMERIC(12,2),
  lease_start DATE,
  lease_end DATE,
  base_rent_per_sqm_pa NUMERIC(10,2),
  base_rent_pa NUMERIC(14,2),
  outgoings_recovery_type TEXT NOT NULL DEFAULT 'net',
  annual_review_type TEXT NOT NULL DEFAULT 'cpi',
  review_rate_pct NUMERIC(5,2),
  option_terms_years INTEGER,
  bank_guarantee_months NUMERIC(5,2),
  incentive_pct NUMERIC(5,2),
  make_good_status TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.industrial_tenancies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_industrial_tenancies" ON public.industrial_tenancies
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_industrial_tenancies_property ON public.industrial_tenancies(property_id);

-- Industrial capex
CREATE TABLE public.industrial_capex (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.industrial_properties(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'other',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.industrial_capex ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_industrial_capex" ON public.industrial_capex
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_industrial_capex_property ON public.industrial_capex(property_id);

-- Timestamp triggers
CREATE TRIGGER update_industrial_properties_updated_at
  BEFORE UPDATE ON public.industrial_properties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_industrial_tenancies_updated_at
  BEFORE UPDATE ON public.industrial_tenancies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_industrial_capex_updated_at
  BEFORE UPDATE ON public.industrial_capex
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.industrial_properties;
ALTER PUBLICATION supabase_realtime ADD TABLE public.industrial_tenancies;
ALTER PUBLICATION supabase_realtime ADD TABLE public.industrial_capex;

-- Create land tax rates table based on Australian state legislation
CREATE TABLE public.land_tax_rates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT')),
  owner_type TEXT NOT NULL,
  lower_bound NUMERIC NOT NULL DEFAULT 0,
  upper_bound NUMERIC NOT NULL DEFAULT 999999999999,
  base_tax NUMERIC NOT NULL DEFAULT 0,
  marginal_rate NUMERIC NOT NULL DEFAULT 0,
  marginal_threshold NUMERIC NOT NULL DEFAULT 0,
  fixed_charge NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  effective_year INTEGER NOT NULL DEFAULT 2025,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create WA MRIT addon table
CREATE TABLE public.land_tax_addons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  state TEXT NOT NULL,
  addon_name TEXT NOT NULL,
  applies_when TEXT NOT NULL,
  rate NUMERIC NOT NULL DEFAULT 0,
  threshold NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ACT quarterly splits table
CREATE TABLE public.land_tax_quarterly_splits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quarter TEXT NOT NULL,
  non_leap_year_pct NUMERIC NOT NULL,
  leap_year_pct NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.land_tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_tax_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_tax_quarterly_splits ENABLE ROW LEVEL SECURITY;

-- Create policies for read access
CREATE POLICY "Anyone can view land tax rates" ON public.land_tax_rates FOR SELECT USING (true);
CREATE POLICY "Anyone can view land tax addons" ON public.land_tax_addons FOR SELECT USING (true);
CREATE POLICY "Anyone can view quarterly splits" ON public.land_tax_quarterly_splits FOR SELECT USING (true);

-- Service role can manage
CREATE POLICY "Service role can manage land tax rates" ON public.land_tax_rates FOR ALL USING (true);
CREATE POLICY "Service role can manage land tax addons" ON public.land_tax_addons FOR ALL USING (true);
CREATE POLICY "Service role can manage quarterly splits" ON public.land_tax_quarterly_splits FOR ALL USING (true);

-- Insert NSW rates
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('NSW', 'individual', 0, 1075000, 0, 0, 0, 0, 'No land tax below general threshold.'),
('NSW', 'individual', 1075000, 6571000, 100, 0.016, 1075000, 0, 'General rate band.'),
('NSW', 'individual', 6571000, 999999999999, 88036, 0.02, 6571000, 0, 'Premium rate band.'),
('NSW', 'company_trust', 0, 6571000, 0, 0.016, 0, 0, 'Flat 1.6% up to premium threshold (no threshold).'),
('NSW', 'company_trust', 6571000, 999999999999, 105136, 0.02, 6571000, 0, '2% above premium threshold (no threshold).');

-- Insert VIC rates - General
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('VIC', 'individual', 0, 50000, 0, 0, 0, 0, 'Nil below $50k.'),
('VIC', 'individual', 50000, 100000, 500, 0, 50000, 0, NULL),
('VIC', 'individual', 100000, 300000, 975, 0, 100000, 0, NULL),
('VIC', 'individual', 300000, 600000, 1350, 0.003, 300000, 0, NULL),
('VIC', 'individual', 600000, 1000000, 2250, 0.006, 600000, 0, NULL),
('VIC', 'individual', 1000000, 1800000, 4650, 0.009, 1000000, 0, NULL),
('VIC', 'individual', 1800000, 3000000, 11850, 0.0165, 1800000, 0, NULL),
('VIC', 'individual', 3000000, 999999999999, 31650, 0.0265, 3000000, 0, NULL);

-- Insert VIC rates - Trust surcharge
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('VIC', 'trust', 0, 25000, 0, 0, 0, 0, 'Nil below $25k.'),
('VIC', 'trust', 25000, 50000, 82, 0.00375, 25000, 0, NULL),
('VIC', 'trust', 50000, 100000, 676, 0.00375, 50000, 0, NULL),
('VIC', 'trust', 100000, 250000, 1338, 0.00375, 100000, 0, NULL),
('VIC', 'trust', 250000, 600000, 1901, 0.00675, 250000, 0, NULL),
('VIC', 'trust', 600000, 1000000, 4263, 0.00975, 600000, 0, NULL),
('VIC', 'trust', 1000000, 1800000, 8163, 0.01275, 1000000, 0, NULL),
('VIC', 'trust', 1800000, 3000000, 18363, 0.011072, 1800000, 0, NULL),
('VIC', 'trust', 3000000, 999999999999, 31650, 0.0265, 3000000, 0, NULL);

-- Insert VIC rates - Absentee
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('VIC', 'absentee', 0, 50000, 0, 0, 0, 0, 'Nil below $50k.'),
('VIC', 'absentee', 50000, 100000, 2500, 0.04, 50000, 0, NULL),
('VIC', 'absentee', 100000, 300000, 4975, 0.04, 100000, 0, NULL),
('VIC', 'absentee', 300000, 600000, 13350, 0.043, 300000, 0, NULL),
('VIC', 'absentee', 600000, 1000000, 26250, 0.046, 600000, 0, NULL),
('VIC', 'absentee', 1000000, 1800000, 44650, 0.049, 1000000, 0, NULL),
('VIC', 'absentee', 1800000, 3000000, 83850, 0.0565, 1800000, 0, NULL),
('VIC', 'absentee', 3000000, 999999999999, 151650, 0.0665, 3000000, 0, NULL);

-- Insert QLD rates - Individual
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('QLD', 'individual', 0, 600000, 0, 0, 0, 0, 'Nil below $600k.'),
('QLD', 'individual', 600000, 1000000, 500, 0.01, 600000, 0, NULL),
('QLD', 'individual', 1000000, 3000000, 4500, 0.0165, 1000000, 0, NULL),
('QLD', 'individual', 3000000, 5000000, 37500, 0.0125, 3000000, 0, NULL),
('QLD', 'individual', 5000000, 10000000, 62500, 0.0175, 5000000, 0, NULL),
('QLD', 'individual', 10000000, 999999999999, 150000, 0.0225, 10000000, 0, NULL);

-- Insert QLD rates - Company/Trustee
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('QLD', 'company_trust', 0, 350000, 0, 0, 0, 0, 'Nil below $350k.'),
('QLD', 'company_trust', 350000, 2250000, 1450, 0.017, 350000, 0, NULL),
('QLD', 'company_trust', 2250000, 5000000, 33750, 0.015, 2250000, 0, NULL),
('QLD', 'company_trust', 5000000, 10000000, 75000, 0.0225, 5000000, 0, NULL),
('QLD', 'company_trust', 10000000, 999999999999, 187500, 0.0275, 10000000, 0, NULL);

-- Insert QLD rates - Absentee
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('QLD', 'absentee', 0, 350000, 0, 0, 0, 0, 'Nil below $350k.'),
('QLD', 'absentee', 350000, 2250000, 1450, 0.017, 350000, 0, NULL),
('QLD', 'absentee', 2250000, 5000000, 33750, 0.015, 2250000, 0, NULL),
('QLD', 'absentee', 5000000, 10000000, 75000, 0.02, 5000000, 0, NULL),
('QLD', 'absentee', 10000000, 999999999999, 175000, 0.025, 10000000, 0, NULL);

-- Insert WA rates - General
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('WA', 'individual', 0, 300000, 0, 0, 0, 0, 'Nil up to $300k.'),
('WA', 'individual', 300000, 420000, 300, 0, 300000, 0, NULL),
('WA', 'individual', 420000, 1000000, 300, 0.0025, 420000, 0, NULL),
('WA', 'individual', 1000000, 1800000, 1750, 0.009, 1000000, 0, NULL),
('WA', 'individual', 1800000, 5000000, 8950, 0.018, 1800000, 0, NULL),
('WA', 'individual', 5000000, 11000000, 66550, 0.02, 5000000, 0, NULL),
('WA', 'individual', 11000000, 999999999999, 186550, 0.0267, 11000000, 0, NULL);

-- Insert SA rates - General (2025-26)
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('SA', 'individual', 0, 833000, 0, 0, 0, 0, 'Nil up to $833k.'),
('SA', 'individual', 833000, 1338000, 0, 0.005, 833000, 0, NULL),
('SA', 'individual', 1338000, 1946000, 2525, 0.01, 1338000, 0, NULL),
('SA', 'individual', 1946000, 3116000, 8605, 0.02, 1946000, 0, NULL),
('SA', 'individual', 3116000, 999999999999, 32005, 0.024, 3116000, 0, NULL);

-- Insert SA rates - Trust (2025-26)
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('SA', 'trust', 0, 25000, 0, 0, 0, 0, 'Nil up to $25k.'),
('SA', 'trust', 25000, 833000, 125, 0.005, 25000, 0, NULL),
('SA', 'trust', 833000, 1338000, 4165, 0.01, 833000, 0, NULL),
('SA', 'trust', 1338000, 1946000, 9215, 0.015, 1338000, 0, NULL),
('SA', 'trust', 1946000, 3116000, 18335, 0.024, 1946000, 0, NULL),
('SA', 'trust', 3116000, 999999999999, 46415, 0.024, 3116000, 0, NULL);

-- Insert TAS rates - General
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('TAS', 'individual', 0, 125000, 0, 0, 0, 0, 'Nil below $125k.'),
('TAS', 'individual', 125000, 500000, 50, 0.0045, 125000, 0, NULL),
('TAS', 'individual', 500000, 999999999999, 1737.5, 0.015, 500000, 0, NULL);

-- Insert ACT rates - Residential land tax (AUV-based)
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('ACT', 'individual', 0, 150000, 0, 0.0054, 0, 1693, 'Value input is AUV (avg unimproved value).'),
('ACT', 'individual', 150000, 275000, 810, 0.0064, 150000, 1693, NULL),
('ACT', 'individual', 275000, 1000000, 1610, 0.0124, 275000, 1693, NULL),
('ACT', 'individual', 1000000, 2000000, 10600, 0.0125, 1000000, 1693, NULL),
('ACT', 'individual', 2000000, 999999999999, 23100, 0.0126, 2000000, 1693, NULL);

-- Insert NT - No land tax
INSERT INTO public.land_tax_rates (state, owner_type, lower_bound, upper_bound, base_tax, marginal_rate, marginal_threshold, fixed_charge, notes) VALUES
('NT', 'individual', 0, 999999999999, 0, 0, 0, 0, 'No land tax in NT.');

-- Insert WA MRIT addon
INSERT INTO public.land_tax_addons (state, addon_name, applies_when, rate, threshold, notes) VALUES
('WA', 'Metropolitan Region Improvement Tax (MRIT)', 'Perth metro area AND land tax liability > 0', 0.0014, 300000, '0.14 cent per $1 in excess of $300,000.');

-- Insert ACT quarterly splits
INSERT INTO public.land_tax_quarterly_splits (quarter, non_leap_year_pct, leap_year_pct) VALUES
('Jul-Sep', 25.2054, 25.1366),
('Oct-Dec', 25.2054, 25.1366),
('Jan-Mar', 24.6575, 24.8633),
('Apr-Jun', 24.9315, 24.8633);

-- Create trigger for updated_at
CREATE TRIGGER update_land_tax_rates_updated_at
  BEFORE UPDATE ON public.land_tax_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_land_tax_rates_state_owner ON public.land_tax_rates(state, owner_type);
CREATE INDEX idx_land_tax_rates_bounds ON public.land_tax_rates(lower_bound, upper_bound);
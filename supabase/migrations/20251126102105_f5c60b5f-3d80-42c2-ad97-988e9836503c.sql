-- Create stamp duty rates cache table
CREATE TABLE IF NOT EXISTS public.stamp_duty_rates_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  brackets JSONB NOT NULL,
  data_quality TEXT NOT NULL DEFAULT 'fallback',
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  source_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.stamp_duty_rates_cache ENABLE ROW LEVEL SECURITY;

-- Allow public read access (rates are public information)
CREATE POLICY "Stamp duty rates are viewable by everyone"
ON public.stamp_duty_rates_cache
FOR SELECT
USING (true);

-- Only allow service role to update (via edge function)
CREATE POLICY "Only service role can update stamp duty rates"
ON public.stamp_duty_rates_cache
FOR ALL
USING (auth.role() = 'service_role');

-- Add trigger for updated_at
CREATE TRIGGER update_stamp_duty_rates_updated_at
BEFORE UPDATE ON public.stamp_duty_rates_cache
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Seed with current hardcoded values as fallback
INSERT INTO public.stamp_duty_rates_cache (state, brackets, data_quality, source_url) VALUES
('NSW', '[
  {"threshold": 0, "base": 0, "rate": 0.0125},
  {"threshold": 16000, "base": 200, "rate": 0.015},
  {"threshold": 35000, "base": 485, "rate": 0.0175},
  {"threshold": 93000, "base": 1500, "rate": 0.035},
  {"threshold": 351000, "base": 10530, "rate": 0.045},
  {"threshold": 1168000, "base": 47295, "rate": 0.055},
  {"threshold": 3000000, "base": 147055, "rate": 0.07}
]'::jsonb, 'fallback', 'https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/transfer-duty'),
('VIC', '[
  {"threshold": 0, "base": 0, "rate": 0.014},
  {"threshold": 25000, "base": 350, "rate": 0.024},
  {"threshold": 130000, "base": 2870, "rate": 0.05},
  {"threshold": 960000, "base": 44370, "rate": 0.06},
  {"threshold": 2000000, "base": 106770, "rate": 0.065}
]'::jsonb, 'fallback', 'https://www.sro.vic.gov.au/duty'),
('QLD', '[
  {"threshold": 0, "base": 0, "rate": 0},
  {"threshold": 5000, "base": 0, "rate": 0.015},
  {"threshold": 75000, "base": 1050, "rate": 0.035},
  {"threshold": 540000, "base": 17325, "rate": 0.045},
  {"threshold": 1000000, "base": 38025, "rate": 0.0575}
]'::jsonb, 'fallback', 'https://www.qro.qld.gov.au/duties/transfer-duty/'),
('WA', '[
  {"threshold": 0, "base": 0, "rate": 0.019},
  {"threshold": 120000, "base": 2280, "rate": 0.029},
  {"threshold": 150000, "base": 3150, "rate": 0.039},
  {"threshold": 360000, "base": 11340, "rate": 0.049},
  {"threshold": 725000, "base": 29225, "rate": 0.051}
]'::jsonb, 'fallback', 'https://www.wa.gov.au/service/financial-services/taxation/transfer-duty'),
('SA', '[
  {"threshold": 0, "base": 0, "rate": 0.01},
  {"threshold": 12000, "base": 120, "rate": 0.02},
  {"threshold": 30000, "base": 480, "rate": 0.03},
  {"threshold": 50000, "base": 1080, "rate": 0.035},
  {"threshold": 100000, "base": 2830, "rate": 0.045},
  {"threshold": 200000, "base": 7330, "rate": 0.0475},
  {"threshold": 300000, "base": 12080, "rate": 0.05},
  {"threshold": 500000, "base": 22080, "rate": 0.055}
]'::jsonb, 'fallback', 'https://www.revenuesa.sa.gov.au/stampduty/property'),
('TAS', '[
  {"threshold": 0, "base": 0, "rate": 0.015},
  {"threshold": 3000, "base": 50, "rate": 0.025},
  {"threshold": 25000, "base": 600, "rate": 0.035},
  {"threshold": 75000, "base": 2350, "rate": 0.04},
  {"threshold": 200000, "base": 7350, "rate": 0.045},
  {"threshold": 375000, "base": 15225, "rate": 0.045},
  {"threshold": 725000, "base": 30975, "rate": 0.045}
]'::jsonb, 'fallback', 'https://www.sro.tas.gov.au/property-transfer-duty'),
('NT', '[
  {"threshold": 0, "base": 0, "rate": 0.065},
  {"threshold": 525000, "base": 6498, "rate": 0.049},
  {"threshold": 3000000, "base": 127774, "rate": 0.057}
]'::jsonb, 'fallback', 'https://nt.gov.au/property/land-title-unit/property-transactions/stamp-duty'),
('ACT', '[
  {"threshold": 0, "base": 0, "rate": 0.012},
  {"threshold": 260000, "base": 1890, "rate": 0.025},
  {"threshold": 300000, "base": 2890, "rate": 0.035},
  {"threshold": 500000, "base": 9890, "rate": 0.045},
  {"threshold": 750000, "base": 21140, "rate": 0.0465},
  {"threshold": 1000000, "base": 32765, "rate": 0.0495},
  {"threshold": 1455000, "base": 55285, "rate": 0.059}
]'::jsonb, 'fallback', 'https://www.revenue.act.gov.au/duties/conveyance-duty');

-- Function to cleanup expired stamp duty cache
CREATE OR REPLACE FUNCTION public.cleanup_expired_stamp_duty_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.stamp_duty_rates_cache 
  SET data_quality = 'fallback'
  WHERE expires_at < NOW() AND data_quality = 'live';
$$;
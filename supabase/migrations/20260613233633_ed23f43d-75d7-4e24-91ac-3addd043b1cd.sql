
-- =========================
-- commercial_capex
-- =========================
CREATE TABLE IF NOT EXISTS public.commercial_capex (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.commercial_properties(id) ON DELETE CASCADE,
  year integer NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  category text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commercial_capex_property_id_idx ON public.commercial_capex(property_id);

GRANT ALL ON public.commercial_capex TO service_role;
ALTER TABLE public.commercial_capex ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages commercial_capex"
  ON public.commercial_capex FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_commercial_capex_updated_at
  BEFORE UPDATE ON public.commercial_capex
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- commercial_financing
-- =========================
CREATE TABLE IF NOT EXISTS public.commercial_financing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL UNIQUE REFERENCES public.commercial_properties(id) ON DELETE CASCADE,
  lender text,
  loan_amount numeric,
  loan_balance numeric,
  interest_rate numeric,        -- percent, e.g. 6.85
  loan_term_years integer,
  io_period_years integer,
  repayment_type text,          -- 'pi' | 'io' | 'pi_after_io'
  lvr_pct numeric,
  upfront_fees numeric,
  ongoing_fees_pa numeric,
  rate_type text,               -- 'variable' | 'fixed'
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.commercial_financing TO service_role;
ALTER TABLE public.commercial_financing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages commercial_financing"
  ON public.commercial_financing FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_commercial_financing_updated_at
  BEFORE UPDATE ON public.commercial_financing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- industrial_financing (relational; legacy JSONB column kept for backwards compat)
-- =========================
CREATE TABLE IF NOT EXISTS public.industrial_financing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL UNIQUE REFERENCES public.industrial_properties(id) ON DELETE CASCADE,
  lender text,
  loan_amount numeric,
  loan_balance numeric,
  interest_rate numeric,
  loan_term_years integer,
  io_period_years integer,
  repayment_type text,
  lvr_pct numeric,
  upfront_fees numeric,
  ongoing_fees_pa numeric,
  rate_type text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.industrial_financing TO service_role;
ALTER TABLE public.industrial_financing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages industrial_financing"
  ON public.industrial_financing FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_industrial_financing_updated_at
  BEFORE UPDATE ON public.industrial_financing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

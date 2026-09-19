
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commercial_properties_client_id_fkey') THEN
    ALTER TABLE public.commercial_properties
      ADD CONSTRAINT commercial_properties_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'industrial_properties_client_id_fkey') THEN
    ALTER TABLE public.industrial_properties
      ADD CONSTRAINT industrial_properties_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.commercial_properties ADD COLUMN IF NOT EXISTS linked_at timestamptz;
ALTER TABLE public.industrial_properties ADD COLUMN IF NOT EXISTS linked_at timestamptz;
ALTER TABLE public.industrial_properties ADD COLUMN IF NOT EXISTS industrial_financing jsonb;

UPDATE public.commercial_properties
  SET linked_at = COALESCE(linked_at, updated_at, created_at, now())
  WHERE client_id IS NOT NULL AND linked_at IS NULL;

UPDATE public.industrial_properties
  SET linked_at = COALESCE(linked_at, updated_at, created_at, now())
  WHERE client_id IS NOT NULL AND linked_at IS NULL;

COMMENT ON COLUMN public.industrial_properties.industrial_financing IS
  'Optional financing snapshot: { loan_balance, interest_rate_pct, monthly_repayment, loan_term_years, repayment_type, lender_name }';

CREATE INDEX IF NOT EXISTS idx_commercial_properties_client_linked
  ON public.commercial_properties(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_industrial_properties_client_linked
  ON public.industrial_properties(client_id) WHERE client_id IS NOT NULL;

CREATE OR REPLACE VIEW public.client_portfolio_properties AS
SELECT
  cp.id, cp.client_id,
  'residential'::text AS asset_class,
  cp.property_type AS sub_type,
  cp.address, cp.value, cp.loan_remaining, cp.interest_rate,
  cp.monthly_interest_repayment, cp.monthly_rental_income,
  cp.ownership_percentage, cp.lender_name,
  cp.created_at,
  NULL::timestamptz AS linked_at,
  'client_properties'::text AS source_table,
  NULL::numeric AS noi_pa
FROM public.client_properties cp

UNION ALL

SELECT
  com.id, com.client_id,
  'commercial'::text AS asset_class,
  com.asset_class::text AS sub_type,
  com.address,
  com.valuation AS value,
  (com.outgoings_recoverable->>'loan_balance')::numeric AS loan_remaining,
  (com.outgoings_recoverable->>'interest_rate_pct')::numeric AS interest_rate,
  (com.outgoings_recoverable->>'monthly_repayment')::numeric AS monthly_interest_repayment,
  NULL::numeric AS monthly_rental_income,
  100::numeric AS ownership_percentage,
  NULL::text AS lender_name,
  com.created_at, com.linked_at,
  'commercial_properties'::text AS source_table,
  (SELECT COALESCE(SUM(cl.base_rent_pa), 0) FROM public.commercial_leases cl WHERE cl.property_id = com.id) AS noi_pa
FROM public.commercial_properties com
WHERE com.client_id IS NOT NULL

UNION ALL

SELECT
  ind.id, ind.client_id,
  'industrial'::text AS asset_class,
  ind.asset_subtype AS sub_type,
  trim(BOTH ', ' FROM concat_ws(', ',
    NULLIF(ind.street,''), NULLIF(ind.suburb,''),
    NULLIF(trim(concat_ws(' ', NULLIF(ind.state,''), NULLIF(ind.postcode,''))),'')
  )) AS address,
  ind.current_valuation AS value,
  (ind.industrial_financing->>'loan_balance')::numeric AS loan_remaining,
  (ind.industrial_financing->>'interest_rate_pct')::numeric AS interest_rate,
  (ind.industrial_financing->>'monthly_repayment')::numeric AS monthly_interest_repayment,
  NULL::numeric AS monthly_rental_income,
  100::numeric AS ownership_percentage,
  (ind.industrial_financing->>'lender_name')::text AS lender_name,
  ind.created_at, ind.linked_at,
  'industrial_properties'::text AS source_table,
  (SELECT COALESCE(SUM(it.base_rent_pa), 0) FROM public.industrial_tenancies it WHERE it.property_id = ind.id) AS noi_pa
FROM public.industrial_properties ind
WHERE ind.client_id IS NOT NULL;

GRANT SELECT ON public.client_portfolio_properties TO authenticated;
GRANT ALL    ON public.client_portfolio_properties TO service_role;

COMMENT ON VIEW public.client_portfolio_properties IS
  'Normalised UNION of residential, commercial and industrial properties per client. Consumed by hybrid BC reconciler.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='commercial_properties') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.commercial_properties;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='industrial_properties') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.industrial_properties;
  END IF;
END $$;

INSERT INTO public.feature_flags (key, value, description)
VALUES (
  'bcSegmentEngine',
  jsonb_build_object('enabled', false),
  'Phase 2: hybrid residential/commercial/industrial borrowing-capacity reconciler. Off = residential-only legacy path.'
)
ON CONFLICT (key) DO NOTHING;

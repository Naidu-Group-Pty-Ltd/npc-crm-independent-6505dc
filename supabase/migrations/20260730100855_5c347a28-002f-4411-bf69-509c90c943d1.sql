CREATE TABLE IF NOT EXISTS public.listing_geocodes (
  listing_hash TEXT PRIMARY KEY,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  precision TEXT,
  provider TEXT NOT NULL DEFAULT 'google',
  status TEXT NOT NULL DEFAULT 'ok',
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.listing_geocodes TO service_role;

ALTER TABLE public.listing_geocodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listing_geocodes_service_role_only" ON public.listing_geocodes;
CREATE POLICY "listing_geocodes_service_role_only"
  ON public.listing_geocodes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS listing_geocodes_resolved_at_idx ON public.listing_geocodes (resolved_at DESC);
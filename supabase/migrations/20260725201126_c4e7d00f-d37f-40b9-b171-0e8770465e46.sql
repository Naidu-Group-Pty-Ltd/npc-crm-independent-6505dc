-- Market Updates: restore missing PostgREST grants (root cause of 0/0 sources on the page).
GRANT SELECT ON public.market_sources TO authenticated;
GRANT SELECT ON public.market_updates TO authenticated;
GRANT SELECT ON public.market_digests TO authenticated;
GRANT SELECT ON public.market_ingestion_runs TO authenticated;
GRANT SELECT ON public.market_source_fetch_runs TO authenticated;
GRANT SELECT, INSERT ON public.market_update_questions TO authenticated;

GRANT ALL ON public.market_sources TO service_role;
GRANT ALL ON public.market_updates TO service_role;
GRANT ALL ON public.market_digests TO service_role;
GRANT ALL ON public.market_ingestion_runs TO service_role;
GRANT ALL ON public.market_source_fetch_runs TO service_role;
GRANT ALL ON public.market_update_questions TO service_role;

-- Retire legacy pre-schema seed rows that have no source_key / adapter / URL
-- so they no longer appear as unusable entries in the Sources dialog.
UPDATE public.market_sources
   SET enabled = false,
       health_status = 'failed',
       last_error = COALESCE(last_error, 'Legacy row — not configured under the 20-source registry. Retired by production recovery migration.')
 WHERE source_key IS NULL
   AND adapter_type IS NULL
   AND primary_url IS NULL;
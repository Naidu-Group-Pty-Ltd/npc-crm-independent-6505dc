
-- Staging table for CSV/XLSX uploaded migration source rows.
-- Workers (contacts, opportunities) read from here when payload.upload_id is set,
-- bypassing live GHL pagination.
CREATE TABLE IF NOT EXISTS public.migration_uploaded_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL CHECK (domain IN ('contacts', 'opportunities')),
  file_name TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  records JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of normalized records
  uploaded_by UUID,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_uploaded_sources_domain
  ON public.migration_uploaded_sources(domain, created_at DESC);

ALTER TABLE public.migration_uploaded_sources ENABLE ROW LEVEL SECURITY;

-- Strict service_role-only access (consistent with other migration tables).
-- Reads/writes must go through edge functions.
CREATE POLICY "service_role_all_migration_uploaded_sources"
  ON public.migration_uploaded_sources
  FOR ALL
  USING (false)
  WITH CHECK (false);

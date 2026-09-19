-- Lead magnet PDF versioning with rollback
CREATE TABLE public.lead_magnet_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  magnet_id UUID NOT NULL REFERENCES public.lead_magnets(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  notes TEXT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (magnet_id, version_number)
);

CREATE INDEX idx_lead_magnet_versions_magnet ON public.lead_magnet_versions(magnet_id, version_number DESC);

ALTER TABLE public.lead_magnet_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages lead_magnet_versions"
  ON public.lead_magnet_versions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Add pointer to active version on lead_magnets
ALTER TABLE public.lead_magnets
  ADD COLUMN active_version_id UUID REFERENCES public.lead_magnet_versions(id) ON DELETE SET NULL;

-- Backfill: create a v1 version row from each existing magnet's current file
INSERT INTO public.lead_magnet_versions (magnet_id, version_number, file_path, file_name, file_size, mime_type, notes)
SELECT id, 1, file_path, file_name, file_size, mime_type, 'Initial version (backfilled)'
FROM public.lead_magnets
WHERE file_path IS NOT NULL;

-- Point active_version_id to the v1 row we just created
UPDATE public.lead_magnets m
SET active_version_id = v.id
FROM public.lead_magnet_versions v
WHERE v.magnet_id = m.id AND v.version_number = 1;
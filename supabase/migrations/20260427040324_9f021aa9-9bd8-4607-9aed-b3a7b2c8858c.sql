ALTER TABLE public.ghl_id_mapping
  ADD COLUMN IF NOT EXISTS match_confidence text NOT NULL DEFAULT 'high';

CREATE INDEX IF NOT EXISTS idx_ghl_id_mapping_confidence
  ON public.ghl_id_mapping(resource_type, match_confidence);

-- Flag ambiguous opportunity mappings (multiple legacy IDs collapsed to one target)
UPDATE public.ghl_id_mapping
SET match_confidence = 'low'
WHERE resource_type = 'opportunity'
  AND new_ghl_id IN (
    SELECT new_ghl_id
    FROM public.ghl_id_mapping
    WHERE resource_type = 'opportunity'
    GROUP BY new_ghl_id
    HAVING COUNT(*) > 1
  );
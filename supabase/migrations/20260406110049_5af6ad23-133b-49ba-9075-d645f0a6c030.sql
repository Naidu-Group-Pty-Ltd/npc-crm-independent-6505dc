ALTER TABLE public.property_comparisons
ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.brand_design_systems
  ADD COLUMN IF NOT EXISTS neutrals jsonb,
  ADD COLUMN IF NOT EXISTS source_namespace text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

ALTER TABLE public.brand_design_systems
  DROP CONSTRAINT IF EXISTS brand_design_systems_origin_check;

ALTER TABLE public.brand_design_systems
  ADD CONSTRAINT brand_design_systems_origin_check
  CHECK (origin IN ('authored', 'generated', 'imported'));

ALTER TABLE public.brand_design_systems
  DROP CONSTRAINT IF EXISTS brand_design_systems_import_provenance;

ALTER TABLE public.brand_design_systems
  ADD CONSTRAINT brand_design_systems_import_provenance
  CHECK (
    (origin = 'imported' AND source_namespace <> '')
    OR (origin <> 'imported' AND imported_at IS NULL)
  );

COMMENT ON COLUMN public.brand_design_systems.neutrals IS
  'The seven print grounds this system brings — paper, paperAlt, paperBright, field, rule, bodyInk, mutedInk — as #RRGGBB. Null means take them from options.preset. Read all-seven-or-none.';

COMMENT ON COLUMN public.brand_design_systems.source_namespace IS
  'The Claude Design project namespace this was imported from. Empty unless origin = imported.';

CREATE INDEX IF NOT EXISTS brand_design_systems_source_idx
  ON public.brand_design_systems (source_namespace)
  WHERE source_namespace <> '';
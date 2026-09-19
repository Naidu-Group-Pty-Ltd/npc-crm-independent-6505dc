-- A brand design system can carry its own paper and ink.
--
-- Additive only. Every column is nullable or defaulted, so a system saved
-- before this migration reads back exactly as it did — `neutrals` null means
-- "take the grounds from `options.preset`", which is what every existing row
-- has always done.
--
-- ## Why a system needs its own grounds
--
-- Until now `options.preset` was the only thing that touched paper and ink, and
-- the four presets are permutations of three hardcoded values —
-- `editorial_navy` contains no navy. That is fine for a house style with a
-- tenant accent on top of it, and useless the moment somebody imports a
-- published design system: its ivory, its porcelain, its obsidian and its
-- hairline would all be discarded and only one accent hex would survive.
--
-- The seven values here are exactly the seven `resolveReportPalette` takes from
-- a preset, so a row carrying them is a preset the tenant wrote. They are
-- audited at save time by the same `auditPaletteContrast` every preset goes
-- through; an imported stock that cannot carry its own body ink is refused
-- before it is stored.

ALTER TABLE public.brand_design_systems
  -- `{ paper, paperAlt, paperBright, field, rule, bodyInk, mutedInk }`, each
  -- `#RRGGBB`. Read all-seven-or-none by `readReportNeutrals`: a half-read set
  -- would print somebody else's obsidian cover on our ivory, which looks like a
  -- deliberate choice and is a parse error. Null is the normal state.
  ADD COLUMN IF NOT EXISTS neutrals jsonb,

  -- The `_ds_manifest.json` namespace this was imported from, e.g.
  -- `NPCServicesDesignSystem_f624bc`. Empty unless imported. Kept so a re-import
  -- can be recognised as an update to the same system rather than a second copy.
  ADD COLUMN IF NOT EXISTS source_namespace text NOT NULL DEFAULT '',

  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

-- `origin` gains a third value.
--
-- Dropped and recreated rather than added to, because a CHECK constraint has no
-- ALTER. The name is preserved so the two are the same constraint to anybody
-- reading `\d brand_design_systems`.
ALTER TABLE public.brand_design_systems
  DROP CONSTRAINT IF EXISTS brand_design_systems_origin_check;

ALTER TABLE public.brand_design_systems
  ADD CONSTRAINT brand_design_systems_origin_check
  CHECK (origin IN ('authored', 'generated', 'imported'));

-- A system that says it was imported must say what from, and one that does not
-- must not pretend. Cheap, and it stops the history panel from showing an
-- "Imported from Claude Design" chip with nothing behind it.
ALTER TABLE public.brand_design_systems
  ADD CONSTRAINT brand_design_systems_import_provenance
  CHECK (
    (origin = 'imported' AND source_namespace <> '')
    OR (origin <> 'imported' AND imported_at IS NULL)
  );

COMMENT ON COLUMN public.brand_design_systems.neutrals IS
  'The seven print grounds this system brings — paper, paperAlt, paperBright, field, rule, bodyInk, mutedInk — as #RRGGBB. Null means take them from options.preset, which is what every authored and generated system does. Read all-seven-or-none; a partial set falls back to the preset whole.';

COMMENT ON COLUMN public.brand_design_systems.source_namespace IS
  'The Claude Design project namespace this was imported from. Empty unless origin = imported.';

-- Imported systems are the ones somebody will look for by name after the fact.
CREATE INDEX IF NOT EXISTS brand_design_systems_source_idx
  ON public.brand_design_systems (source_namespace)
  WHERE source_namespace <> '';

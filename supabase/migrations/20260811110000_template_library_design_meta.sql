-- =====================================================================
-- Template Library — design-system metadata for the Investment Compass
-- family catalogue.
--
-- ADDITIVE ONLY. One nullable-by-default jsonb column and one index. No
-- existing column, constraint, policy, index or row is altered, and every
-- row that predates this migration reads back as `{}` — which every
-- consumer already treats as "not a family template".
--
-- ## Why a jsonb column rather than typed columns
--
-- The approved catalogue's family model is a RESOLVED MANIFEST of ~21 keys
-- (cover_overlay, section_header_style, kpi_layout, table_style, …) plus a
-- curated colourway list. Typed columns for that would be twenty-odd
-- migrations chasing a vocabulary that grows with each of the remaining
-- nine families. The library already filters client-side
-- (`filterEntries.ts`), so nothing here needs to be a WHERE clause.
--
-- ## Why NOT family_id or variant
--
-- `family_id` is a uuid meaning "the lineage this entry's versions share" —
-- every version of one template carries the same one, and the publish path
-- deprecates siblings by it. Overloading it with a *design* family would
-- make five unrelated templates look like five versions of each other, and
-- publishing any one of them would deprecate the other four.
--
-- `variant` is constrained to ('composite','financial','due_diligence') and
-- is copied onto the working copy in `report_templates.variant`, where it
-- feeds report routing. Widening that CHECK to hold structural variant
-- names would put design vocabulary into a routing column.
--
-- Both were left exactly as they are.
-- =====================================================================

ALTER TABLE public.template_library_entries
  ADD COLUMN IF NOT EXISTS design_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.template_library_entries.design_meta IS
  'Design-system metadata for catalogue families: familyKey, templateCode, variantAxis, density, ground, recommendedUse, the resolved manifest, and the curated colourway ids. Empty for entries that are not part of a design family. Never used for routing or authorisation.';

-- Browsing is filtered client-side, but the family key is the one axis a
-- future server-side "show me Private Banking" query would use, and a
-- partial index on it costs nothing while design_meta is empty for most rows.
CREATE INDEX IF NOT EXISTS template_library_entries_design_family_idx
  ON public.template_library_entries ((design_meta ->> 'familyKey'))
  WHERE design_meta ? 'familyKey';

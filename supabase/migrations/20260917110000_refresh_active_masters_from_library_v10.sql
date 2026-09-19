-- Refresh the ACTIVE report_templates rows that descend from library designs,
-- so the v10 catalogue changes reach the documents people already generate.
--
-- Why this exists: `use_for_reports` and the master seeds COPY a library
-- entry's schema into `report_templates` at adoption time, and nothing ever
-- updated a copy afterwards. The v10 catalogue fixes ship three defects that
-- were measured on real client PDFs (1/27D Mitchell Street, 2026-09-04):
-- the tier identity (a Financial Analysis rendered titled "Investment
-- Compass" on its cover and every running head/foot), the missing Contents
-- page on the ten Luxury Editorial / Private Banking masters (the house
-- default among them), and the narrative page budget that let a document's
-- tail print over the running foot. Left as copies, every existing selection
-- — including the seeded house defaults the ranking resolves — would keep
-- rendering the defective schemas for ever.
--
-- What it does, and deliberately nothing else:
--   * schema  := the library entry's current schema, with THIS ROW'S OWN
--     token colours carried forward. A copy adopted in a colourway holds
--     `default ⊕ colourway` in tokens.colors (applyColourwayToSchema is
--     exactly that merge), and the v10 changes touch pages and bindings,
--     never palettes — so carrying the row's colours forward re-bakes the
--     colourway without this migration having to know a single hex.
--   * the lineage's entryVersion := the entry's current version, so the
--     picker's fold (which matches entry + version) keeps recognising the
--     copy as the design it descends from.
--
-- What it refuses to touch: rows with no library lineage (hand-built
-- templates, the Compass pilot), inactive drafts, and rows whose lineage
-- entry the library no longer lists. Idempotent: re-running it re-copies the
-- same current schema.

update public.report_templates t
set
  schema = jsonb_set(
    e.schema,
    '{tokens,colors}',
    coalesce(t.schema -> 'tokens' -> 'colors', e.schema -> 'tokens' -> 'colors', '{}'::jsonb)
  ),
  config = jsonb_set(
    t.config,
    '{libraryLineage,entryVersion}',
    to_jsonb(e.version)
  ),
  updated_at = now()
from public.template_library_entries e
where t.is_active
  and (t.config -> 'libraryLineage' ->> 'entryId') = e.id::text
  and e.status = 'published'
  and e.schema is not null;

-- Turn the raised surface style on for the two systems that should carry it.
--
-- `surfaceStyle` is a new axis on `ReportDesignOptions`: `flat` is every rule
-- this repo shipped for its first nine formats — hairline dividers, banded
-- rows, ink on paper and nothing between them — and `raised` gives the same
-- content in containers: KPI cards rather than a KPI strip, a shell around a
-- table with a tinted header inside it, callouts and sidenotes as cards, an
-- accent bar beside the section head, and a faint grid on the paper.
--
-- It defaults to `flat` in `DEFAULT_REPORT_DESIGN_OPTIONS`, so every existing
-- row keeps the look its golden render was taken against and no format changes
-- because a field appeared. Opting in is a decision somebody makes per design
-- system, which is what this migration is.
--
-- NPC Services and Chancery only. The other four voices are deliberately plain:
-- Slip and Cadastre are the minimal-ink ones, and Broadsheet and Marque earn
-- their difference through cover style and drop caps rather than through
-- containers. Six systems that all print in cards would be one system again,
-- which is the defect `20260826000000` exists about.
--
-- Guarded on the absence of the key rather than on the whole options blob: this
-- follows `20260826000000`, which rewrote Chancery's options, so matching the
-- original seed text would silently do nothing. `?` is "has this key", so a row
-- somebody has already set — either way — is left alone.

UPDATE public.brand_design_systems
SET
  options = options || '{"surfaceStyle":"raised"}'::jsonb,
  updated_at = now()
WHERE slug IN ('npc-services-design-system', 'chancery')
  AND NOT (options ? 'surfaceStyle');

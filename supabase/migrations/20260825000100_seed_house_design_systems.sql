-- The house design systems, so the picker is not empty on the first day.
--
-- Six rows: the NPC Services Design System as published on claude.ai/design,
-- and the five report voices the PDF catalogue is already built from.
--
-- ## Where these values come from
--
-- **NPC Services Design System** is derived from the committed manifest at
-- `scripts/brandDesign/claudeDesign/npc-services.manifest.json` by the same
-- code path a person's own import takes — `brandDesign/import.pure.ts`. Its
-- seven grounds are `--background`, `--muted`, `--card`, `--aurixa-obsidian`,
-- `--border`, `--foreground` and `--muted-foreground`, converted from the HSL
-- triplets Claude Design writes. `npm run brand:sync` re-checks that the
-- derivation still reproduces `reportDesign/tokens.pure.ts` exactly, and
-- `src/lib/brandDesign/__tests__/import.spec.ts` asserts it on every run.
--
-- **The five voices** come from `scripts/template-library/designSystem.ts ›
-- VOICES`, which is also what generates the `report-templates/voices.card.html`
-- card in the published design system. A voice fixes the paper, the display
-- face, the type scale and the section rule; `paper`, `paperAlt`, `field` and
-- `rule` here are that voice's `surface`, `panel`, `field` and `line`, with
-- `paperBright` taken as the lightest of the set. Every one was resolved
-- through `resolveReportPalette` and cleared `auditPaletteContrast` with zero
-- problems before this file was written.
--
-- ## What a voice does not bring
--
-- Its typography. Chancery is Playfair Display, Broadsheet is Fraunces, Marque
-- is Cinzel, Cadastre is Public Sans — and `ReportDesignOptions` has no font
-- axis: `PRINT_STACK` is fixed, and `REPORT_RULES.md` records that Cinzel is
-- not installed in the WeasyPrint container. So these rows carry each voice's
-- colour and rhythm and not its face. A font axis is a separate piece of work
-- with a container change in it, and pretending otherwise here would ship five
-- design systems that all print in the same type.
--
-- ## Idempotent
--
-- `ON CONFLICT (slug) DO NOTHING`. Re-running the migration adds nothing and
-- overwrites nothing — a system somebody has since edited keeps their edits.
-- `created_by` is null: these are the house's, not any one person's.

INSERT INTO public.brand_design_systems
  (name, slug, description, brand_hex, options, neutrals, origin, source_namespace, imported_at, is_active)
VALUES
  (
    'NPC Services Design System',
    'npc-services-design-system',
    'The published brand, as it prints. Warm ivory stock, graphite ink, obsidian cover, gold accent.',
    '#D9A520',
    '{"preset":"signature","density":"balanced","chapterStyle":"classic","tableStyle":"classic","coverStyle":"title_overlay","bodyScale":100,"visualIntensity":70,"showDropCaps":false,"showSectionNumbers":true,"justifyText":true}'::jsonb,
    '{"paper":"#FAF7EF","paperAlt":"#F2EBDE","paperBright":"#FFFDFA","field":"#251F18","rule":"#DDD1C0","bodyInk":"#312A21","mutedInk":"#6E6253"}'::jsonb,
    'imported',
    'NPCServicesDesignSystem_f624bc',
    now(),
    true
  ),

  -- ── The five report voices ────────────────────────────────────────────────

  (
    'Chancery',
    'chancery',
    'Board-ready and signed. The document that gets filed.',
    '#D9A521',
    '{"preset":"signature","density":"balanced","chapterStyle":"classic","tableStyle":"classic","coverStyle":"title_overlay","bodyScale":100,"visualIntensity":70,"showDropCaps":false,"showSectionNumbers":true,"justifyText":true}'::jsonb,
    '{"paper":"#FFFDFA","paperAlt":"#F2EBDE","paperBright":"#FFFDFA","field":"#251F18","rule":"#DDD1C0","bodyInk":"#312A21","mutedInk":"#6E6253"}'::jsonb,
    'authored', '', NULL, true
  ),
  (
    'Broadsheet',
    'broadsheet',
    'Market narrative that earns a long read.',
    '#D9A521',
    '{"preset":"signature","density":"spacious","chapterStyle":"classic","tableStyle":"minimal","coverStyle":"editorial","bodyScale":105,"visualIntensity":55,"showDropCaps":true,"showSectionNumbers":true,"justifyText":true}'::jsonb,
    '{"paper":"#FAF7EF","paperAlt":"#F7F0E4","paperBright":"#FFFDFA","field":"#251F18","rule":"#DDD1C0","bodyInk":"#312A21","mutedInk":"#6E6253"}'::jsonb,
    'authored', '', NULL, true
  ),
  (
    'Slip',
    'slip',
    'One page, read in ninety seconds, nothing spare.',
    '#D9A521',
    '{"preset":"minimal_ink","density":"compact","chapterStyle":"minimal","tableStyle":"minimal","coverStyle":"editorial","bodyScale":95,"visualIntensity":35,"showDropCaps":false,"showSectionNumbers":false,"justifyText":false}'::jsonb,
    '{"paper":"#FFFFFF","paperAlt":"#F5F3EF","paperBright":"#FFFFFF","field":"#312A21","rule":"#E4E0D8","bodyInk":"#312A21","mutedInk":"#6E6253"}'::jsonb,
    'authored', '', NULL, true
  ),
  (
    'Marque',
    'marque',
    'Private client. Commissioned, not generated.',
    '#D9A521',
    '{"preset":"signature","density":"spacious","chapterStyle":"opener_band","tableStyle":"classic","coverStyle":"image","bodyScale":102,"visualIntensity":85,"showDropCaps":true,"showSectionNumbers":true,"justifyText":true}'::jsonb,
    '{"paper":"#FAF7EF","paperAlt":"#F8EED3","paperBright":"#FFFDFA","field":"#251F18","rule":"#DDD1C0","bodyInk":"#312A21","mutedInk":"#6E6253"}'::jsonb,
    'authored', '', NULL, true
  ),
  (
    'Cadastre',
    'cadastre',
    'Dense data. The columns have to line up.',
    '#D9A521',
    '{"preset":"minimal_ink","density":"compact","chapterStyle":"classic","tableStyle":"ledger","coverStyle":"editorial","bodyScale":95,"visualIntensity":45,"showDropCaps":false,"showSectionNumbers":true,"justifyText":false}'::jsonb,
    '{"paper":"#FFFDFA","paperAlt":"#EEF1F4","paperBright":"#FFFDFA","field":"#251F18","rule":"#D5DCE3","bodyInk":"#312A21","mutedInk":"#6E6253"}'::jsonb,
    'authored', '', NULL, true
  )
ON CONFLICT (slug) DO NOTHING;

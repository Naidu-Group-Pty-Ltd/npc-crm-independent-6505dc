-- Chancery was a copy of the house system, so choosing it changed nothing.
--
-- `20260825000100_seed_house_design_systems.sql` seeded six systems. Five of
-- them carry a real voice. Chancery's `options` were byte-identical to the NPC
-- Services row's — same preset, density, chapterStyle, tableStyle, coverStyle,
-- bodyScale, visualIntensity, every flag — so the only thing separating the two
-- was `neutrals` (`#FFFDFA` against `#FAF7EF`), a shift of three units of
-- lightness on the paper. And `neutrals` did not reach the render at all until
-- the converter route started passing them.
--
-- The consequence was a person picking Chancery, rendering, and getting a
-- document indistinguishable from the house default — which reads as the design
-- system having no effect, and was reported as exactly that.
--
-- Chancery is the filed document: "board-ready and signed". So it takes the
-- ledger table — ruled rows, the look of a schedule — a tighter measure, and
-- type set a touch smaller, against the same warm stock. It stays distinct from
-- Cadastre, which is also ledger-ruled but sets on `minimal_ink` with an
-- editorial cover.
--
-- Only the seeded row, and only if nobody has touched it: the `WHERE` matches
-- the exact options the seed wrote, so a Chancery somebody has since edited in
-- the UI keeps their edits and this migration passes over it.

UPDATE public.brand_design_systems
SET
  options = '{"preset":"signature","density":"compact","chapterStyle":"classic","tableStyle":"ledger","coverStyle":"title_overlay","bodyScale":98,"visualIntensity":60,"showDropCaps":false,"showSectionNumbers":true,"justifyText":true}'::jsonb,
  description = 'Board-ready and signed. The document that gets filed — ruled schedules, a close measure, nothing decorative.',
  updated_at = now()
WHERE slug = 'chancery'
  AND options = '{"preset":"signature","density":"balanced","chapterStyle":"classic","tableStyle":"classic","coverStyle":"title_overlay","bodyScale":100,"visualIntensity":70,"showDropCaps":false,"showSectionNumbers":true,"justifyText":true}'::jsonb;

-- Two sections of a Property Comparison Analysis the table never had room for.
--
-- APPROVED by the platform owner on 28 Sep 2026 ("please proceed with making
-- the database change as that is going to be a requirement based on providing a
-- complete QA report"). It reaches production only through
-- `apply-migration.yml` on a merged file, like every other migration.
--
-- ## What was wrong
--
-- `compare-investment-reports` has asked the model for ten sections since its
-- first prompt. The writer destructured a successful answer into seven jsonb
-- columns and `executive_summary`, and had no column for `marketTiming` (buy
-- first, how long to hold each, how to exit) or `competitiveAdvantages` (what
-- sets each property apart) — so on every INTACT comparison those two were
-- generated, paid for and discarded, while a comparison whose answer had been
-- cut off kept its raw text and printed them. The damaged rows carried more of
-- the analysis than the intact ones (docs/reports/COMPARISON.md §14).
--
-- ## What this does, and what it deliberately does not
--
-- Adds two NULLABLE jsonb columns. Nothing else:
--
--   * no default, no backfill — a row written before this holds nothing in
--     either and prints exactly as it did; the sections were never stored, so
--     there is nothing to recover and nothing is invented;
--   * no constraint on the shape — the seven sibling columns carry none either,
--     and the one reader (`normalise.pure.ts`) already treats every field as
--     untrusted model output;
--   * no change to row-level security — the table's policies are per row, and
--     two columns on the same row are governed by them unchanged;
--   * the model, its prompt and its schema are untouched. The producer stores
--     the answer it already receives.
--
-- ## Ordering
--
-- Safe in either order with the edge deploy. The producer writes these two in
-- a SEPARATE update after the insert and logs a refusal rather than failing, so
-- before this is applied a new comparison is saved without them (as today);
-- every reader selects `*` and reads an absent key as absent.

alter table public.property_comparisons
  add column if not exists market_timing jsonb,
  add column if not exists competitive_advantages jsonb;

comment on column public.property_comparisons.market_timing is
  'The analysis''s marketTiming section as the model gave it: buyFirst, holdingPeriods, exitStrategies. NULL on rows written before 2026-09-28 and on raw (salvaged) rows, whose executive_summary carries it.';

comment on column public.property_comparisons.competitive_advantages is
  'The analysis''s competitiveAdvantages section as the model gave it: [{propertyNumber, advantages[]}]. NULL on rows written before 2026-09-28 and on raw (salvaged) rows, whose executive_summary carries it.';

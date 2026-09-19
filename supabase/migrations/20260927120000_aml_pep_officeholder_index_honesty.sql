-- ═══════════════════════════════════════════════════════════════════════
-- The index states what it FOUND, and never what it concluded
-- ═══════════════════════════════════════════════════════════════════════
--
-- Two corrections to `aml.pep_officeholders`, both found by loading it
-- against the real source for the first time.
--
-- 1. `pep_type` must be NULLABLE, and null is now what the loader writes.
--
--    The AUSTRAC category — foreign, domestic or international organisation
--    — is part of the DETERMINATION a person reaches. This index does not
--    make determinations, so it has no business asserting one. It also
--    cannot: "applies to jurisdiction: Australia" is the right way to find
--    Australian public offices, and it correctly includes foreign
--    ambassadors posted here, so stamping every row `domestic` was wrong on
--    the face of the data as well as in principle.
--
--    The CHECK is kept for the values that ARE spelled, so a future source
--    that genuinely knows the category still cannot invent a fourth one.
--
-- 2. The office count is recorded on the sync, because the coverage shown
--    to an operator is derived from it.
--
--    The first load wrote 1,254 people across TWO offices — the House of
--    Representatives and its Speaker — while the product stated on screen
--    that it covered ministers, judges, heads of agency and every state and
--    territory. The load was green, the count was plausible, and the
--    coverage claim was false. A sentence somebody typed once cannot be
--    checked; a number the loader measured can be, so the panel now renders
--    what was actually reached.

ALTER TABLE aml.pep_officeholders ALTER COLUMN pep_type DROP NOT NULL;
ALTER TABLE aml.pep_officeholders ALTER COLUMN pep_type DROP DEFAULT;

-- Re-state the CHECK so it admits NULL explicitly rather than by accident.
ALTER TABLE aml.pep_officeholders
  DROP CONSTRAINT IF EXISTS pep_officeholders_pep_type_check;
ALTER TABLE aml.pep_officeholders
  ADD CONSTRAINT pep_officeholders_pep_type_check
  CHECK (pep_type IS NULL
    OR pep_type IN ('foreign', 'domestic', 'international_organisation'));

-- The rows already loaded asserted `domestic` on every one of them. That
-- assertion was never true of the whole set and is not the index's to make.
UPDATE aml.pep_officeholders SET pep_type = NULL WHERE pep_type IS NOT NULL;

COMMENT ON COLUMN aml.pep_officeholders.pep_type IS
  'Left NULL by design. The AUSTRAC category belongs to the determination a '
  'person reaches, not to the index that surfaces the candidate.';

COMMENT ON COLUMN aml.pep_officeholder_syncs.detail IS
  'What the load actually reached — office_count, distinct_offices and a '
  'sample. The coverage an operator is shown is derived from this, because a '
  'claim nobody measures is a claim nobody can check.';

-- Stored templates print a date, not a machine timestamp.
--
-- ## What was on the page
--
-- A Client Details Form exported on 16 August 2026 carried
--
--     Prepared 2026-08-16T08:58:56.946Z
--
-- on its cover, and the same string again under PREPARED on page 3.
--
-- `report.generatedDate` is a full ISO timestamp in all seven projections —
-- they publish `updated_at` / `created_at` / `preparedOn` verbatim, under a name
-- that promises a date. The masters bind it as `{{report.generatedDate | date}}`
-- and always have since ad99bc228; the rows a document is actually drawn from
-- bind it with no filter, because **an activated template is a copy** and
-- correcting the catalogue does not reach one that was already made.
--
-- Measured 2026-08-16, over the thirteen active `report_templates` rows:
--
--     report.generatedDate                        11 uses, no filter   5 formats
--     comparison.analysedOn                        1 use,  no filter   comparison
--     clientDetails.addressHistory.N.startDate    32 uses, no filter   client_details
--     …and the same paths WITH `| date`             9 uses             4 formats
--
-- Seven of the thirteen printed the raw timestamp. The address-history dates are
-- a Postgres `date`, so they printed as `2016-02-14` — a machine date on a
-- client-facing page just the same, in the half of the class nobody had noticed.
--
-- ## What this does, and what it is not
--
-- It adds `| date` to those bindings, so a stored template says what it means
-- and matches the catalogue entry it was copied from.
--
-- It is **not** the fix. The fix is in `bindingResolver.ts`: a bound value that
-- is a bare ISO date now prints as a date whether or not the template asked,
-- because no seed and no migration can reach a user-authored template, an
-- imported one, or a converted one. This migration makes the stored rows agree
-- with the renderer and with their source; if it were reverted, the pages would
-- still be correct.
--
-- Idempotent: the pattern requires `}}` immediately after the path, so a
-- binding that already carries a filter cannot match. Re-running changes
-- nothing.

UPDATE report_templates
SET schema = regexp_replace(
      schema::text,
      '\{\{\s*((?:report\.generatedDate'
      || '|comparison\.analysedOn'
      || '|qa\.preparedOn'
      || '|clientDetails\.preparedOn'
      || '|marketIntel\.meta\.preparedOn'
      || '|capacity\.meta\.assessedOn'
      || '|cashFlowComparison\.meta\.preparedOn'
      || '|portfolio\.review\.reviewedOn'
      || '|portfolio\.review\.nextReviewDue'
      || '|clientDetails\.addressHistory\.\d+\.(?:startDate|endDate)'
      || '))\s*\}\}',
      '{{\1 | date}}',
      'g'
    )::jsonb
WHERE schema::text ~ ('\{\{\s*(?:report\.generatedDate'
      || '|comparison\.analysedOn'
      || '|qa\.preparedOn'
      || '|clientDetails\.preparedOn'
      || '|marketIntel\.meta\.preparedOn'
      || '|capacity\.meta\.assessedOn'
      || '|cashFlowComparison\.meta\.preparedOn'
      || '|portfolio\.review\.reviewedOn'
      || '|portfolio\.review\.nextReviewDue'
      || '|clientDetails\.addressHistory\.\d+\.(?:startDate|endDate)'
      || ')\s*\}\}');

-- Nothing may be left behind, and nothing may have been lost.
--
-- The second half matters as much as the first: the rewrite goes through
-- `schema::text`, so a pattern that matched more than intended would corrupt a
-- template rather than fail. `{{` is counted before and after — the rewrite adds
-- seven characters per binding and must add no bindings and drop none.
DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining
  FROM report_templates
  WHERE is_active
    AND schema::text ~ ('\{\{\s*(?:report\.generatedDate'
        || '|comparison\.analysedOn'
        || '|qa\.preparedOn'
        || '|clientDetails\.preparedOn'
        || '|marketIntel\.meta\.preparedOn'
        || '|capacity\.meta\.assessedOn'
        || '|cashFlowComparison\.meta\.preparedOn'
        || '|portfolio\.review\.reviewedOn'
        || '|portfolio\.review\.nextReviewDue'
        || '|clientDetails\.addressHistory\.\d+\.(?:startDate|endDate)'
        || ')\s*\}\}');

  IF remaining > 0 THEN
    RAISE EXCEPTION
      '% active report_templates still bind a timestamp with no date filter', remaining;
  END IF;
END $$;

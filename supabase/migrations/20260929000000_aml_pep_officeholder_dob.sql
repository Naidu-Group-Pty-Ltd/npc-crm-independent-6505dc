-- ═══════════════════════════════════════════════════════════════════════
-- A date of birth on the office-holder index — so a candidate can be told
-- apart from somebody who merely shares a name
-- ═══════════════════════════════════════════════════════════════════════
--
-- The index searches on name tokens alone. That is correct for RECALL — a
-- common surname must still surface the office holder — and it means the
-- operator is handed candidates that are frequently a different person with
-- the same name, with nothing on the card to tell them apart except an office
-- title they have no way to connect to their customer.
--
-- A date of birth is the strongest discriminator any of these sources
-- publishes. Wikidata carries `P569` for most people it holds.
--
-- ── WHY `text` AND NOT `date` ─────────────────────────────────────────
-- Because the sources publish PARTIAL dates, and a partial date stored in a
-- `date` column has to be padded to something.
--
-- Wikidata records precision explicitly: `wikibase:timePrecision` 9 means the
-- YEAR is known and nothing else, 10 the month, 11 the day. But the value it
-- renders is a full timestamp either way — a year-precision birth in 1961 comes
-- back as `1961-01-01T00:00:00Z`. Storing that as a `date` would assert that a
-- person was born on 1 January, and the comparison would then report a
-- confident MISMATCH against a customer genuinely born on 4 August 1961.
--
-- A fabricated discriminator is worse than none: it demotes a real lead with a
-- reason that sounds decisive.
--
-- So the column carries the precision in the shape of the string — `1961`,
-- `1961-03`, `1961-03-02` — which is the same convention
-- `aml.sanctions_entries.date_of_birth` already uses for the same reason, and
-- the convention `compareDob` in `_shared/aml/matching.ts` is written against.
-- One convention, one comparator, no second precision column to drift.
--
-- ── WHAT THIS COLUMN MAY NEVER DO ────────────────────────────────────
-- It may order candidates and annotate them. It may NOT remove one.
--
-- The threshold that decides whether a candidate is shown to a person is
-- applied to the NAME score alone. A birth date that disagrees is rendered
-- beside the candidate for the reviewer to weigh; it never drops the candidate
-- out of the list. Hiding an office holder because a date disagrees is the
-- automation reaching the conclusion, and the whole design position here is
-- that the reviewer or MLRO reaches it.

ALTER TABLE aml.pep_officeholders
  ADD COLUMN IF NOT EXISTS date_of_birth text;

COMMENT ON COLUMN aml.pep_officeholders.date_of_birth IS
  'Partial-date text — ''1961'', ''1961-03'' or ''1961-03-02'' — carrying the '
  'source''s own precision in the shape of the string, exactly as '
  'sanctions_entries.date_of_birth does. NEVER padded to a full date: a '
  'year-precision birth stored as 1 January produces a confident mismatch '
  'against the real birthday. Orders and annotates candidates; never filters '
  'them.';

-- A value this shape is the only thing `compareDob` can read. Anything else
-- (a timestamp, a `circa 1961`, an empty string) would parse to a year by
-- accident or to nothing at all, and both readings are silent.
DO $$ BEGIN
  ALTER TABLE aml.pep_officeholders
    ADD CONSTRAINT pep_officeholders_dob_partial_date
    CHECK (date_of_birth IS NULL
      OR date_of_birth ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

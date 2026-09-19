-- A perimeter finding that excludes nothing must be refused by the TABLE, not
-- only by the code above it.
--
-- ## The defect
--
-- 20260920000000 wrote:
--
--   CHECK (classification <> 'outside_perimeter'
--          OR array_length(scopes_excluded, 1) >= 1)
--
-- `array_length(ARRAY[]::text[], 1)` is **NULL**, not 0. `NULL >= 1` is NULL,
-- and a CHECK constraint PASSES on NULL. So the one shape the constraint
-- existed to refuse — an out-of-perimeter row that stands nothing down — was
-- accepted, and the constraint read as though it worked.
--
-- Found by exercising it against the real table rather than by reading it:
-- the test that shipped with the migration asserted the constraint existed by
-- name, which is true of a constraint that does nothing.
--
-- ## Why it was not exploitable, and why it is still wrong
--
-- Nothing downstream trusted it. `readPerimeter` treats a finding that
-- excludes no scopes as INSIDE the perimeter, and `classify_screening_perimeter`
-- refuses the request with `no_scopes_excluded` before it writes. So no
-- exemption could be produced this way.
--
-- But a constraint that cannot fail is worse than no constraint: it is a
-- guarantee the next person will rely on. The database is the last place this
-- rule can be enforced, and it is the one place that does not depend on which
-- code path did the writing.
--
-- Additive and idempotent. `NOT VALID` is deliberately NOT used: there are no
-- rows to grandfather, and validating now proves the fix on real data.
--
-- ROLLBACK (exact):
--   ALTER TABLE aml.case_screening_perimeter
--     DROP CONSTRAINT IF EXISTS case_screening_perimeter_scopes_required;

ALTER TABLE aml.case_screening_perimeter
  DROP CONSTRAINT IF EXISTS case_screening_perimeter_scopes_required;

ALTER TABLE aml.case_screening_perimeter
  ADD CONSTRAINT case_screening_perimeter_scopes_required
  CHECK (
    classification <> 'outside_perimeter'
    OR coalesce(array_length(scopes_excluded, 1), 0) >= 1
  );

-- Document requirements: the unique key the code has always assumed.
--
-- ── The defect ────────────────────────────────────────────────────────
-- `aml-cases` creates document requirements in exactly two places, and both
-- upsert on the same key:
--
--   seed_default_requirements  .upsert(rows, { onConflict: 'case_id,code' })
--   upsert_requirement         .upsert(row,  { onConflict: 'case_id,code' })
--
-- `aml.document_requirements` was created with a primary key on `id`, a
-- foreign key on `case_id` and a NON-unique index on `(case_id, status)`.
-- Nothing has ever been unique on `(case_id, code)`, so Postgres refuses the
-- statement at planning time:
--
--   ERROR: 42P10: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- The op throws, the function's catch turns it into a 500, and the operator
-- sees "Could not add requirements — Internal error".
--
-- This is not a regression. `aml.document_requirements` holds **0 rows across
-- every case in production**: neither op has ever succeeded, so the Documents
-- stage has been unreachable since the day it shipped. The client's portal
-- checklist is built from these rows, which is why it has always been empty
-- and why the case sat at "No requirements set".
--
-- ── Why a unique key is the right fix, not a code change ──────────────
-- `code` is the requirement's identity within a case ('photo_id_primary',
-- 'proof_of_address', …). Seeding is meant to be idempotent — pressing "Add
-- standard requirements" twice must not produce ten rows — and re-issuing a
-- requirement is meant to update the existing one rather than fork it. Both
-- behaviours are what the upsert was written for; the constraint that makes
-- them possible was simply never created.
--
-- Dropping the ON CONFLICT instead would make the seed non-idempotent and
-- give a case duplicate requirements with the same code, which every
-- downstream reader (the portal checklist, the stage's completion count, the
-- readiness meter) counts twice.
--
-- ── Safety ────────────────────────────────────────────────────────────
-- Verified before writing: 0 rows in the table and 0 duplicate (case_id, code)
-- pairs, so the index builds cleanly. `IF NOT EXISTS` keeps it re-runnable.

CREATE UNIQUE INDEX IF NOT EXISTS aml_document_requirements_case_code_key
  ON aml.document_requirements (case_id, code);

COMMENT ON INDEX aml.aml_document_requirements_case_code_key IS
  'A requirement code is unique within a case. Backs the ON CONFLICT (case_id, code) '
  'upsert used by seed_default_requirements and upsert_requirement in aml-cases; '
  'without it both ops fail with 42P10 and no requirement can ever be created.';

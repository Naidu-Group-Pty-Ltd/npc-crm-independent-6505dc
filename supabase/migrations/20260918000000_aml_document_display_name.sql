-- A readable name for a compliance document, without touching its identity.
--
-- A client photographing their passport uploads
-- `17868163460724899975067990115218.jpg`. Three of those in a review list are
-- indistinguishable, and a reviewer has to open every one.
--
-- What this is NOT: a categorisation fix. Every one of those uploads already
-- carries a correct `requirement_id` — the three in production resolve to
-- `photo_id_primary`, `proof_of_address` and `source_of_funds`. The linkage
-- was right all along; the list simply never asked for it.
--
-- `display_name` is additive and nullable:
--   * `filename` is NEVER rewritten. It is the bytes the client actually
--     sent, and it stays as the audit record of that.
--   * renaming changes what people read, never which requirement, case,
--     client or Passport the row belongs to — those are foreign keys and
--     none of them is touched.
--   * NULL means "nobody has named this", and the reader derives a name from
--     the requirement instead. Existing rows therefore keep working
--     unchanged and improve immediately, with no backfill.

ALTER TABLE aml.documents
  ADD COLUMN IF NOT EXISTS display_name text;

COMMENT ON COLUMN aml.documents.display_name IS
  'Human-chosen name for review. NULL = derive from the requirement. Never '
  'replaces `filename`, which is preserved as the audit record of what was '
  'uploaded. Renaming changes presentation only and never re-links the row.';

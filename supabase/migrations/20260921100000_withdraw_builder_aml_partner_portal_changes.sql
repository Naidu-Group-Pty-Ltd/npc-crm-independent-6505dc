-- @effect: select 1 where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'builder_accept_current_terms')
--
-- Withdraws every object applied today that touches the Builder Portal, the
-- AML/CTF module, or a partner portal, and removes their ledger rows so the
-- record matches the database.
--
-- These were applied while recovering objects the drift report named as
-- missing. They are withdrawn at the owner's direction: those three areas are
-- not to be changed. Each restores the exact state of this morning — every
-- object below was ABSENT before today, so dropping it returns the schema to
-- what the product has been running on, and none of it is a rollback of
-- somebody else's work.
--
-- Checked before writing, so the cost of withdrawing is known rather than
-- assumed:
--
--   * `builder_accept_current_terms` has ZERO callers. It appears only in the
--     generated `src/integrations/supabase/types.ts`, which is a type
--     declaration and not a call site. Nothing can regress.
--   * `share_correlation_id`, `shared_with_finance_user_id` and
--     `storage_bucket` on `finance_portal_documents` are referenced nowhere in
--     `src/` or `supabase/functions/`. The `storage_bucket` matches in the
--     codebase are `client_files`, a different table. The three columns were
--     added today, nothing writes them, so no value is lost.
--   * `aml.verification_checks` has no upsert and no ON CONFLICT anywhere, so
--     nothing depends on `uq_aml_verification_attempt` existing.
--
-- NOT touched, deliberately: `aml.consent_documents`. Today's run inserted
-- ZERO rows there — the 2026.2 catalogue it would have written already existed
-- (its seven documents were created 28 Jul to 4 Aug 2026) and both inserts
-- carried ON CONFLICT DO NOTHING. There is nothing of today's to withdraw, and
-- deleting that catalogue would destroy real compliance records.
--
-- ROLLBACK: re-apply 20260719000000 and 20260728120000. The Builder Portal
-- function has no file to re-apply — `20260921080000` is deleted in the same
-- commit as this migration, because a file whose only object is dropped here
-- would report NOT APPLIED every night for ever. Its definition is recoverable
-- verbatim from lines 105-171 of
-- `20260901000700_partner_portal_agreement_cascade.sql`, which is where it
-- came from and which is untouched.

-- Builder Portal.
DROP FUNCTION IF EXISTS public.builder_accept_current_terms(uuid, uuid, text, text, jsonb);

-- AML/CTF.
DROP INDEX IF EXISTS aml.uq_aml_verification_attempt;

-- Finance (partner) Portal.
DROP INDEX IF EXISTS public.idx_fpd_finance_share_correlation;
DROP INDEX IF EXISTS public.idx_fpd_finance_share_recipient;
ALTER TABLE public.finance_portal_documents
  DROP COLUMN IF EXISTS share_correlation_id,
  DROP COLUMN IF EXISTS shared_with_finance_user_id,
  DROP COLUMN IF EXISTS storage_bucket;

-- The ledger claimed these ran. With their objects gone that is false, and a
-- ledger row asserting an application that did not happen is the exact fault
-- this programme's drift reporter exists to catch.
DELETE FROM supabase_migrations.schema_migrations
 WHERE version IN ('20260719000000','20260728120000','20260921070000','20260921080000','20260921090000');

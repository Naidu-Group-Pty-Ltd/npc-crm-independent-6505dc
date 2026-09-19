-- The provider catalogue said the opposite of what the code does, and what it
-- denied was the customer's document images leaving our buckets.
--
-- `aml.provider_configs` for `didit_standalone` has carried, since it was
-- seeded on 11 Sep, `"save_api_request": false` and a note reading
-- "save_api_request is false on every call: NPC/Supabase is the evidence
-- store." Every Standalone call has sent `save_api_request=true` since
-- 2026-08-14 — `baseForm()` in `_shared/aml/providers/diditStandaloneClient.ts`
-- appends it unconditionally, and `diditStandaloneWire.test.ts` pins it on the
-- encoded multipart body of all three endpoints.
--
-- ## Why this is not a typo in a comment
--
-- The flag decides whether the PROVIDER keeps a copy. Under `true` Didit
-- persists each request as an API-type session under Manual Checks — which is
-- what makes an NPC verification auditable on Didit's side, and is why it was
-- reversed from `false`: before that, a completed check existed nowhere but in
-- NPC's own database. It follows that Didit now RETAINS the customer's
-- document images and selfie, so NPC's private buckets are no longer the only
-- copy of them.
--
-- The stale row asserted the reverse to anyone reading the catalogue: that no
-- copy of a customer's identity document exists outside this deployment. That
-- is a statement about where personal information lives, read by the people
-- who answer for it, and it was false.
--
-- ## The class, and why nothing caught it
--
-- **A config field that no code reads cannot be contradicted by anything.**
-- Nothing in `src/` or `supabase/functions/` reads
-- `provider_configs.config.save_api_request`; it is documentation stored in a
-- database, so the ordinary guards — types, tests, the column-name checker —
-- have no purchase on it. It is kept rather than deleted because the fact it
-- records is one a compliance reader needs; `diditProviderConfigTruth.spec.ts`
-- now reads this file and the client together and fails when they disagree.
--
-- The value is corrected rather than the note alone: a reader who filters on
-- the boolean and a reader who reads the prose must not get different answers.
--
-- ## Reach
--
-- The clones carry the same stale row. The reference copy is
-- `on conflict do nothing` by design — seeding is not replication, and a sweep
-- must never revert a tenant's own edit — so it cannot converge them. This
-- migration travels with the cascade and each deployment applies it, which is
-- the deliberate path for a correction as opposed to a sweep.

UPDATE aml.provider_configs
   SET config = config || jsonb_build_object(
         'save_api_request', true,
         'note',
           'Identity verification only — ID document, passive liveness, face match 1:1. '
           'Didit AML/PEP/sanctions/KYB/proof-of-address screening is NOT enabled and '
           'must not be: NPC screens against its own DFAT/UN/OFAC lists. '
           'save_api_request is true on every call (since 2026-08-14): Didit persists each '
           'request as an API-type session under Manual Checks, which is what makes a '
           'verification auditable on the provider''s side. Didit therefore RETAINS the '
           'customer''s document images and selfie — this deployment''s private buckets are '
           'not the only copy. NPC/Supabase remains the evidence store of record: the '
           'authenticated response is the authoritative result and no decision is re-fetched.'
       ),
       updated_at = now()
 WHERE capability = 'idv'
   AND provider_key = 'didit_standalone'
   AND config->>'save_api_request' IS DISTINCT FROM 'true';

-- ─────────────────────────────────────────────────────────────────────────
-- Convergence check. A silent no-op here would leave the catalogue asserting
-- that no copy of a customer's identity document exists outside this
-- deployment, which is the whole defect.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  wrong int;
BEGIN
  SELECT count(*) INTO wrong
    FROM aml.provider_configs
   WHERE capability = 'idv'
     AND provider_key = 'didit_standalone'
     AND (config->>'save_api_request' IS DISTINCT FROM 'true'
          -- The note must STATE the fact, not merely omit the falsehood: a row
          -- that says nothing about retention leaves the same reader guessing.
          OR config->>'note' NOT LIKE '%save_api_request is true%');

  IF wrong > 0 THEN
    RAISE EXCEPTION
      'didit_standalone config did not converge: % row(s) still deny that Didit retains the capture',
      wrong;
  END IF;
END $$;

-- Generalise portal terms to serve Builder users as well as Solicitor users.
--
-- Phase 0 recorded this as GEN-01/GEN-02 and as migration risk MIG-01: the
-- highest-risk widening in the programme, because it drops a NOT NULL and that
-- is effectively one-way once a Builder row exists.
--
-- ADR 021 records why the discriminated-owner shape was chosen over a separate
-- builder_terms_acceptances table, and over a generic user_id column.
--
-- Ordering is deliberate and must not be rearranged:
--   1. Pre-migration assertions — fail loudly rather than corrupt.
--   2. Widen the portal CHECK on both tables.
--   3. Add builder_user_id (nullable, real FK).
--   4. Add the exactly-one-owner CHECK as NOT VALID, then VALIDATE.
--   5. Add the portal/owner agreement CHECK the same way.
--   6. Create per-portal partial unique indexes.
--   7. ONLY THEN drop the old composite unique and the NOT NULL.
--   8. Post-migration assertions.
-- Dropping the NOT NULL before the replacement uniqueness exists would leave a
-- window in which a duplicate or ownerless acceptance is storable.

-- ===========================================================================
-- 1. Pre-migration assertions
-- ===========================================================================
DO $$
DECLARE
  v_versions bigint; v_acceptances bigint; v_orphans bigint; v_mismatched bigint;
BEGIN
  SELECT count(*) INTO v_versions FROM public.portal_terms_versions;
  SELECT count(*) INTO v_acceptances FROM public.portal_terms_acceptances;

  -- Every existing acceptance must already have a solicitor owner and a
  -- solicitor portal marker. If not, the assumptions below are wrong.
  SELECT count(*) INTO v_orphans
  FROM public.portal_terms_acceptances
  WHERE solicitor_user_id IS NULL OR portal IS DISTINCT FROM 'solicitor';
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'PRE-MIGRATION FAILURE: % portal_terms_acceptances rows lack a solicitor owner or a solicitor portal marker', v_orphans;
  END IF;

  -- Every acceptance must point at a version of the same portal. This is the
  -- invariant the new agreement CHECK will enforce going forward.
  SELECT count(*) INTO v_mismatched
  FROM public.portal_terms_acceptances a
  JOIN public.portal_terms_versions v ON v.id = a.terms_version_id
  WHERE v.portal IS DISTINCT FROM a.portal;
  IF v_mismatched > 0 THEN
    RAISE EXCEPTION 'PRE-MIGRATION FAILURE: % acceptances reference a terms version belonging to a different portal', v_mismatched;
  END IF;

  RAISE NOTICE 'portal terms pre-migration: % versions, % acceptances, 0 anomalies',
    v_versions, v_acceptances;
END $$;

-- Preserve a count snapshot so the post-migration assertion can prove nothing
-- was lost, not merely that the table is non-empty.
CREATE TEMP TABLE _portal_terms_premigration_counts AS
SELECT
  (SELECT count(*) FROM public.portal_terms_versions)     AS versions,
  (SELECT count(*) FROM public.portal_terms_acceptances)  AS acceptances,
  (SELECT count(*) FROM public.portal_terms_versions WHERE portal='solicitor')    AS solicitor_versions,
  (SELECT count(*) FROM public.portal_terms_acceptances WHERE portal='solicitor') AS solicitor_acceptances;

-- ===========================================================================
-- 2. Widen the portal discriminator
-- ===========================================================================
ALTER TABLE public.portal_terms_versions
  DROP CONSTRAINT IF EXISTS portal_terms_versions_portal_check;
ALTER TABLE public.portal_terms_versions
  ADD CONSTRAINT portal_terms_versions_portal_check
  CHECK (portal IN ('solicitor','builder'));

ALTER TABLE public.portal_terms_acceptances
  DROP CONSTRAINT IF EXISTS portal_terms_acceptances_portal_check;
ALTER TABLE public.portal_terms_acceptances
  ADD CONSTRAINT portal_terms_acceptances_portal_check
  CHECK (portal IN ('solicitor','builder'));

-- The existing partial unique index on (portal) WHERE retired_at IS NULL is
-- already portal-generic: it now yields one current version per portal, which
-- is exactly the required behaviour. It is deliberately left untouched.

-- ===========================================================================
-- 3. Add the Builder owner column
--
-- A real foreign key, not a generic user_id. A generic identifier column would
-- be unenforceable: nothing would stop an acceptance naming a user that does
-- not exist, or a solicitor id being stored under a builder portal marker.
-- ===========================================================================
-- [Phase 7, network extraction] The foreign key that used to sit inline here
-- was released live by 20261122000000 when the portal moved to the Builders
-- Network, and the decommission migration (20261124000000) drops the table it
-- referenced — so a fresh clone must not recreate it. The column stays: dead
-- uuids are the recorded history.
ALTER TABLE public.portal_terms_acceptances
  ADD COLUMN IF NOT EXISTS builder_user_id uuid;

-- ===========================================================================
-- 4. Exactly one owner
-- ===========================================================================
ALTER TABLE public.portal_terms_acceptances
  DROP CONSTRAINT IF EXISTS portal_terms_acceptances_single_owner;
ALTER TABLE public.portal_terms_acceptances
  ADD CONSTRAINT portal_terms_acceptances_single_owner
  CHECK (num_nonnulls(solicitor_user_id, builder_user_id) = 1) NOT VALID;
ALTER TABLE public.portal_terms_acceptances
  VALIDATE CONSTRAINT portal_terms_acceptances_single_owner;

-- ===========================================================================
-- 5. The owner column must agree with the portal discriminator
--
-- This is what stops one portal's user accepting another portal's terms, and
-- what makes "prevent one user accepting terms for another" a database
-- guarantee rather than an application convention.
-- ===========================================================================
ALTER TABLE public.portal_terms_acceptances
  DROP CONSTRAINT IF EXISTS portal_terms_acceptances_portal_owner_agree;
ALTER TABLE public.portal_terms_acceptances
  ADD CONSTRAINT portal_terms_acceptances_portal_owner_agree
  CHECK (
    (portal = 'solicitor' AND solicitor_user_id IS NOT NULL AND builder_user_id IS NULL)
    OR
    (portal = 'builder'   AND builder_user_id  IS NOT NULL AND solicitor_user_id IS NULL)
  ) NOT VALID;
ALTER TABLE public.portal_terms_acceptances
  VALIDATE CONSTRAINT portal_terms_acceptances_portal_owner_agree;

-- A CHECK cannot reach another table, so the acceptance-to-version portal match
-- is enforced by trigger.
CREATE OR REPLACE FUNCTION public.guard_portal_terms_acceptance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_version_portal text;
BEGIN
  SELECT portal INTO v_version_portal
  FROM public.portal_terms_versions WHERE id = NEW.terms_version_id;

  IF v_version_portal IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='PORTAL_TERMS_VERSION_NOT_FOUND';
  END IF;

  IF v_version_portal IS DISTINCT FROM NEW.portal THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='PORTAL_TERMS_PORTAL_MISMATCH',
      DETAIL=format('acceptance portal %s does not match terms version portal %s',
                    NEW.portal, v_version_portal);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_portal_terms_acceptance ON public.portal_terms_acceptances;
CREATE TRIGGER trg_guard_portal_terms_acceptance
  BEFORE INSERT OR UPDATE OF terms_version_id, portal, solicitor_user_id, builder_user_id
  ON public.portal_terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.guard_portal_terms_acceptance();

-- ===========================================================================
-- 6. Replacement uniqueness — created BEFORE the old constraint is dropped
-- ===========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS portal_terms_acceptances_solicitor_key
  ON public.portal_terms_acceptances(terms_version_id, solicitor_user_id)
  WHERE solicitor_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS portal_terms_acceptances_builder_key
  ON public.portal_terms_acceptances(terms_version_id, builder_user_id)
  WHERE builder_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS portal_terms_acceptances_builder_user_idx
  ON public.portal_terms_acceptances(builder_user_id)
  WHERE builder_user_id IS NOT NULL;

-- ===========================================================================
-- 7. Only now relax the original single-portal shape
-- ===========================================================================
ALTER TABLE public.portal_terms_acceptances
  DROP CONSTRAINT IF EXISTS portal_terms_acceptances_terms_version_id_solicitor_user_id_key;
ALTER TABLE public.portal_terms_acceptances
  ALTER COLUMN solicitor_user_id DROP NOT NULL;

-- ===========================================================================
-- 8. Post-migration assertions
-- ===========================================================================
DO $$
DECLARE
  v_before record; v_versions bigint; v_acceptances bigint;
  v_sol_versions bigint; v_sol_acceptances bigint;
BEGIN
  SELECT * INTO v_before FROM _portal_terms_premigration_counts;

  SELECT count(*) INTO v_versions FROM public.portal_terms_versions;
  SELECT count(*) INTO v_acceptances FROM public.portal_terms_acceptances;
  SELECT count(*) INTO v_sol_versions FROM public.portal_terms_versions WHERE portal='solicitor';
  SELECT count(*) INTO v_sol_acceptances FROM public.portal_terms_acceptances WHERE portal='solicitor';

  IF v_versions <> v_before.versions THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: terms version count changed from % to %',
      v_before.versions, v_versions;
  END IF;
  IF v_acceptances <> v_before.acceptances THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: acceptance count changed from % to %',
      v_before.acceptances, v_acceptances;
  END IF;
  IF v_sol_versions <> v_before.solicitor_versions THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: solicitor terms versions changed from % to %',
      v_before.solicitor_versions, v_sol_versions;
  END IF;
  IF v_sol_acceptances <> v_before.solicitor_acceptances THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: solicitor acceptances changed from % to %',
      v_before.solicitor_acceptances, v_sol_acceptances;
  END IF;

  -- Every preserved solicitor acceptance must still carry its owner.
  IF EXISTS (SELECT 1 FROM public.portal_terms_acceptances
             WHERE portal='solicitor' AND solicitor_user_id IS NULL) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: a solicitor acceptance lost its owner';
  END IF;

  -- The replacement uniqueness must exist before this migration is considered
  -- complete; a missing index here would mean duplicates became storable.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                 AND indexname='portal_terms_acceptances_solicitor_key') THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: solicitor uniqueness index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                 AND indexname='portal_terms_acceptances_builder_key') THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: builder uniqueness index missing';
  END IF;

  RAISE NOTICE 'portal terms post-migration: % versions, % acceptances preserved intact',
    v_versions, v_acceptances;
END $$;

DROP TABLE IF EXISTS _portal_terms_premigration_counts;

-- ===========================================================================
-- 9. Builder terms version
-- ===========================================================================
INSERT INTO public.portal_terms_versions(portal, version, title, content_markdown, effective_at)
VALUES ('builder', 'v1.0', 'Builder / Developer Portal Terms of Use',
$md$# Builder / Developer Portal — Terms of Use

These terms govern access to the Aurixa Builder / Developer Portal by builder and
developer organisations and their authorised personnel.

## 1. Access
Access is granted to named individuals through an organisation membership.
Credentials must not be shared. Access may be revoked at any time.

## 2. Permitted use
The portal may be used only to manage your organisation's own property, sales and
construction records and to communicate with Aurixa and connected parties.

## 3. Confidentiality
Information about purchasers, other organisations and connected transactions is
confidential and must not be disclosed or used for any other purpose.

## 4. Accuracy
You are responsible for the accuracy of information your organisation records,
including pricing, availability, construction status and completion estimates.

## 5. Security
You must report any suspected unauthorised access immediately. Sessions are
time-limited and may be revoked.

## 6. Audit
Portal activity is logged for security and compliance purposes.
$md$,
  now())
ON CONFLICT (portal, version) DO NOTHING;

COMMENT ON COLUMN public.portal_terms_acceptances.builder_user_id IS
  'Builder Portal owner of this acceptance. Exactly one of solicitor_user_id and builder_user_id is populated, enforced by portal_terms_acceptances_single_owner, and it must agree with the portal discriminator.';

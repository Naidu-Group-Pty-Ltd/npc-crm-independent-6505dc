-- Nothing may quietly detach an AML/CTF case from its customer.
--
-- ── What happened ─────────────────────────────────────────────────────
-- `aml.cases.client_id` was ON DELETE SET NULL. Deleting a client therefore
-- neither failed nor cascaded — it ORPHANED the case. The customer vanished
-- from the register while the case, its screening subjects, its
-- determinations and its event chain remained, attached to nobody.
--
-- Measured in production before this migration: 1 of 6 cases was already in
-- that state. AML-2026-00001 (`edd_required`, still open) pointed at client
-- 658e8e83-5fee-4697-b474-c95cd4d99f44 — a real customer with a
-- house-and-land deal and three notes — and that client had been deleted.
--
-- ── Why RESTRICT and not CASCADE ──────────────────────────────────────
-- CASCADE is the obvious fix and it is the wrong one. An AML/CTF case is a
-- record the business is obliged to keep, and some of what hangs off it must
-- survive regardless of what anybody wants to tidy up: a submitted
-- regulatory report, a recorded service-gate decision, a confirmed sanctions
-- match, an issued passport, anything under legal hold. Cascading a client
-- delete into that is a worse outcome than the orphan.
--
-- RESTRICT makes the generic delete FAIL instead. Deleting a client who has
-- an AML case now has exactly one route: `reset_client_journey`, which knows
-- what it is holding, refuses on retained evidence, removes the AML rows
-- explicitly and verifies nothing was left behind before the client row
-- goes. That operation deletes the cases first, so it is unaffected.
--
-- ── The path this closes is not hypothetical ──────────────────────────
-- `import-clients-from-ghl` offers "Clear & Reimport", which runs
--
--     delete from clients where id <> '00000000-...'
--
-- Under SET NULL that single statement orphans EVERY AML case in the
-- deployment at once, silently, and reports success. Under RESTRICT it
-- fails and nothing is lost.

ALTER TABLE aml.cases DROP CONSTRAINT IF EXISTS cases_client_id_fkey;

ALTER TABLE aml.cases
  ADD CONSTRAINT cases_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id)
  ON DELETE RESTRICT;

COMMENT ON CONSTRAINT cases_client_id_fkey ON aml.cases IS
  'RESTRICT, deliberately. SET NULL orphaned the case (1 in 6 in production); '
  'CASCADE would destroy retained compliance evidence. A client with an AML '
  'case is deleted through reset_client_journey or not at all.';

-- ── Recovering the attribution the FK destroyed ───────────────────────
--
-- The row lost its `client_id`, but the audit chain never did: the
-- `case_created` event carries it in its payload, written when the case was
-- opened. That chain is the record, so it is READ here and never rewritten —
-- `aml.case_events` rows carry an application-computed hash chain, and a raw
-- INSERT would produce a link that verifies as broken.
--
-- The recovered id is stamped onto the case as evidence, NOT written back to
-- `client_id`. The client it names has been deleted; re-pointing the column
-- at a different customer who happens to share a name would be inventing an
-- attribution, which is worse than the orphan it replaces.
--
-- Idempotent and general: no case id is hardcoded, it is a no-op on any
-- deployment with no orphans, and re-running it changes nothing.
DO $$
DECLARE
  repaired integer := 0;
BEGIN
  WITH orphan AS (
    SELECT c.id,
           (SELECT e.payload ->> 'client_id'
              FROM aml.case_events e
             WHERE e.case_id = c.id
               AND e.payload ? 'client_id'
             ORDER BY e.created_at ASC
             LIMIT 1) AS recovered_client_id
      FROM aml.cases c
     WHERE c.client_id IS NULL
       AND NOT (coalesce(c.metadata, '{}'::jsonb) ? 'orphaned_client')
  )
  UPDATE aml.cases c
     SET metadata = jsonb_set(
           coalesce(c.metadata, '{}'::jsonb),
           '{orphaned_client}',
           jsonb_build_object(
             'client_id', o.recovered_client_id,
             'recovered_from', 'case_events.payload.client_id',
             'client_still_exists',
               EXISTS (SELECT 1 FROM public.clients cl
                        WHERE cl.id = o.recovered_client_id::uuid),
             'detached_because',
               'clients.id was deleted while aml.cases.client_id was ON DELETE SET NULL',
             'recorded_at', to_jsonb(now())
           ),
           true)
    FROM orphan o
   WHERE c.id = o.id
     AND o.recovered_client_id IS NOT NULL;

  GET DIAGNOSTICS repaired = ROW_COUNT;
  RAISE NOTICE 'aml.cases: recovered attribution for % orphaned case(s)', repaired;
END $$;

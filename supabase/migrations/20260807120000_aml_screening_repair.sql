-- AML screening repair (non-KYC): connect party screening to the canonical
-- screening engine, and give PEP a real, auditable determination record.
--
-- What existed before this migration: queue_party_screening set
-- party_screening_subjects.state = 'queued' and NOTHING ever executed the
-- screening; PEP was a bare checkbox (beneficial_owners.is_pep) recording no
-- evidence of how the determination was established; the seeded
-- pep_direct_no_edd mandatory trigger had no input that could ever feed it.
--
-- Additive and idempotent. Applying it twice is a no-op. No existing rows are
-- rewritten and no history is deleted.
--
-- ROLLBACK (exact):
--   DROP TRIGGER IF EXISTS trg_aml_party_screening_outbox ON aml.party_screening_subjects;
--   DROP FUNCTION IF EXISTS aml.tg_emit_party_screening_requested();
--   DROP TRIGGER IF EXISTS trg_aml_pep_det_supersede ON aml.pep_determinations;
--   DROP FUNCTION IF EXISTS aml.tg_supersede_prior_pep_determinations();
--   DROP TABLE IF EXISTS aml.pep_determinations;
--   DROP TABLE IF EXISTS aml.senior_manager_designations;
--   DELETE FROM aml.mandatory_triggers WHERE key IN
--     ('pep_edd_outstanding','pep_approval_outstanding');
--   DELETE FROM aml.retention_schedules WHERE entity_type IN
--     ('pep_determination','senior_manager_designation');

/* ── 1. Transactional outbox emission for party screening ────────────────── */
-- Same proven AFTER-trigger pattern as aml.verification.requested
-- (20260831000100): the event is part of the transaction that queued the
-- subject, so no code path can queue work without emitting it and a rollback
-- creates neither. Payload carries identifiers only — no name, DOB or match
-- content travels through the outbox.
--
-- The idempotency key embeds a second-resolution timestamp: a duplicate
-- transition in the same instant deduplicates, while a genuine re-screen
-- weeks later emits a fresh event. The trigger only fires on a transition
-- INTO 'queued', so updates that keep state 'queued' emit nothing.
CREATE OR REPLACE FUNCTION aml.tg_emit_party_screening_requested()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = aml, public
AS $$
BEGIN
  IF NEW.state = 'queued'
     AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
    INSERT INTO public.integration_outbox
      (aggregate_type, aggregate_id, event_type, event_version, payload, idempotency_key)
    VALUES (
      'aml_party_screening_subject', NEW.id, 'aml.screening.requested', 1,
      jsonb_build_object(
        'party_screening_subject_id', NEW.id,
        'case_id', NEW.case_id
      ),
      'aml-screen-' || NEW.id::text || '-' ||
        floor(extract(epoch FROM clock_timestamp()))::bigint::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aml_party_screening_outbox ON aml.party_screening_subjects;
CREATE TRIGGER trg_aml_party_screening_outbox
  AFTER INSERT OR UPDATE OF state ON aml.party_screening_subjects
  FOR EACH ROW EXECUTE FUNCTION aml.tg_emit_party_screening_requested();

/* ── 2. Auditable PEP determinations ─────────────────────────────────────── */
-- A determination answers: who was assessed, what the result was, how it was
-- reached (sources/methods), who made it, when, and why the conclusion was
-- reasonable. AUSTRAC record-keeping guidance: "you must keep records to show
-- how you've established if a person is a PEP" — a boolean cannot do that.
-- A manual not_pep is as much a determination as a pep, and both carry a
-- review date so ongoing CDD can reconsider them.
--
-- Append-only with the match_resolutions hash-chain convention; a new
-- determination supersedes the previous one rather than editing it.
CREATE TABLE IF NOT EXISTS aml.pep_determinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  case_id uuid NOT NULL,
  -- NULL = the case subject; otherwise the reconciled related party.
  party_screening_subject_id uuid REFERENCES aml.party_screening_subjects(id),
  party_type text,
  party_id uuid,
  subject_name text NOT NULL,
  result text NOT NULL CHECK (result IN ('not_pep','pep')),
  pep_type text CHECK (pep_type IS NULL OR pep_type IN
    ('foreign','domestic','international_organisation')),
  pep_relationship text CHECK (pep_relationship IS NULL OR pep_relationship IN
    ('self','family_member','close_associate')),
  -- A PEP result must carry its classification; not_pep carries none.
  CONSTRAINT pep_result_requires_classification CHECK (
    result <> 'pep' OR (pep_type IS NOT NULL AND pep_relationship IS NOT NULL)
  ),
  position_held text,
  jurisdiction text,
  -- Current vs former office holder, where established. Nullable: former
  -- status is captured only when it was actually assessed.
  holds_position_currently boolean,
  -- Sources/methods checked: [{source, reference, note}] — references and
  -- metadata only, never copied page content.
  methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale text NOT NULL,
  determined_by uuid NOT NULL,
  determined_by_label text,
  determined_at timestamptz NOT NULL DEFAULT now(),
  review_due_at timestamptz,
  superseded_at timestamptz,
  -- DEFERRABLE: the supersession trigger below runs BEFORE INSERT and stamps
  -- the closing row's superseded_by_determination_id with NEW.id while the
  -- new row does not exist yet. An immediately-checked self-reference fails
  -- that UPDATE with a foreign-key violation, so every SUPERSEDING insert
  -- would error; deferring the check to COMMIT (by which time the new row is
  -- in place) keeps referential integrity without breaking the atomic
  -- supersession.
  superseded_by_determination_id uuid REFERENCES aml.pep_determinations(id)
    DEFERRABLE INITIALLY DEFERRED,
  prev_hash text,
  row_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Converge a database where the table pre-existed with the immediate
-- constraint (CREATE TABLE IF NOT EXISTS skips the new inline definition).
ALTER TABLE aml.pep_determinations
  ALTER CONSTRAINT pep_determinations_superseded_by_determination_id_fkey
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS idx_aml_pep_det_case
  ON aml.pep_determinations(case_id, superseded_at);
CREATE INDEX IF NOT EXISTS idx_aml_pep_det_review
  ON aml.pep_determinations(review_due_at)
  WHERE superseded_at IS NULL AND review_due_at IS NOT NULL;

-- Supersession is ATOMIC with the insert: a BEFORE INSERT trigger closes the
-- previous current determination for the same subject scope inside the same
-- transaction, so no crash or concurrent write can leave two current
-- determinations — and the partial unique index makes that structural. An
-- application-side "insert then update the old row" cannot give either
-- guarantee.
CREATE OR REPLACE FUNCTION aml.tg_supersede_prior_pep_determinations()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = aml, public
AS $$
BEGIN
  UPDATE aml.pep_determinations
     SET superseded_at = now(),
         superseded_by_determination_id = NEW.id
   WHERE case_id = NEW.case_id
     AND party_screening_subject_id IS NOT DISTINCT FROM NEW.party_screening_subject_id
     AND superseded_at IS NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aml_pep_det_supersede ON aml.pep_determinations;
CREATE TRIGGER trg_aml_pep_det_supersede
  BEFORE INSERT ON aml.pep_determinations
  FOR EACH ROW EXECUTE FUNCTION aml.tg_supersede_prior_pep_determinations();

-- One current determination per (case, subject scope). NULL subject = the
-- case subject, folded to a fixed sentinel so the index can see it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_aml_pep_det_one_current
  ON aml.pep_determinations(
    case_id,
    COALESCE(party_screening_subject_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE superseded_at IS NULL;
ALTER TABLE aml.pep_determinations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON aml.pep_determinations TO service_role;
DO $$ BEGIN
  CREATE POLICY "aml_pep_determinations_service_only" ON aml.pep_determinations
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ── 3. Senior manager designations ──────────────────────────────────────── */
-- AUSTRAC's senior-manager requirements (foreign-PEP approval among them) name
-- a defined role that is NOT automatically the MLRO. The existing model has no
-- way to record who the reporting entity's senior managers are, so approvals
-- of kind 'pep_service_approval' had no one authorised to give them. This is
-- the smallest explicit record: a designation, MLRO-recorded, soft-revoked.
-- It grants nothing else — it only identifies who may resolve the approvals
-- that current AUSTRAC guidance says need a senior manager.
CREATE TABLE IF NOT EXISTS aml.senior_manager_designations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  user_id uuid NOT NULL,
  designated_by uuid NOT NULL,
  designated_by_label text,
  note text,
  designated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aml_senior_manager_active
  ON aml.senior_manager_designations(tenant_id, user_id)
  WHERE revoked_at IS NULL;
ALTER TABLE aml.senior_manager_designations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON aml.senior_manager_designations TO service_role;
DO $$ BEGIN
  CREATE POLICY "aml_senior_manager_designations_service_only"
    ON aml.senior_manager_designations
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ── 4. PEP mandatory-trigger seeds ──────────────────────────────────────── */
-- Inputs pep_edd_required / edd_complete / pep_approval_required /
-- pep_approval_granted are set authoritatively by aml-risk from the recorded
-- determination, the EDD case and the approvals queue — never by a caller.
-- Severity 'hold' deliberately: a PEP is never an automatic rejection; the
-- gate blocks through explicit clearance reasons until the required EDD and
-- senior-manager approval exist.
INSERT INTO aml.mandatory_triggers(key, label, description, severity, rule) VALUES
  ('pep_edd_outstanding', 'PEP requires enhanced due diligence',
   'A foreign PEP — or a domestic/international organisation PEP on a high ML/TF risk customer — requires completed EDD including source of funds and source of wealth (AUSTRAC PEP guidance).',
   'hold', '{"pep_edd_required": true, "edd_complete": false}'::jsonb),
  ('pep_approval_outstanding', 'PEP requires senior manager approval',
   'Providing the designated service to the applicable PEP categories requires senior manager approval (AUSTRAC PEP / senior-manager guidance). The approver must hold a recorded senior-manager designation.',
   'hold', '{"pep_approval_required": true, "pep_approval_granted": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

/* ── 5. Retention registrations for the new record types ─────────────────── */
INSERT INTO aml.retention_schedules (entity_type, retention_years, legal_basis, disposal_method, notes, active)
VALUES
  ('pep_determination', 7, 'AML/CTF Act s 107', 'recorded_only',
   'PEP determination with sources, rationale and review date (P4).', true),
  ('senior_manager_designation', 7, 'AML/CTF Act s 107', 'recorded_only',
   'Record of who was designated a senior manager for AML approvals.', true)
ON CONFLICT DO NOTHING;

/* ── Verification: the migration must converge ──────────────────────────── */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_aml_party_screening_outbox') THEN
    RAISE EXCEPTION 'party screening outbox trigger did not converge';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_aml_pep_det_supersede') THEN
    RAISE EXCEPTION 'PEP determination supersession trigger did not converge';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
      WHERE schemaname = 'aml' AND indexname = 'idx_aml_pep_det_one_current') THEN
    RAISE EXCEPTION 'single-current-determination index did not converge';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'pep_determinations_superseded_by_determination_id_fkey'
        AND condeferrable AND condeferred) THEN
    RAISE EXCEPTION 'supersession self-reference is not deferred — every superseding determination would fail its FK check';
  END IF;
  IF (SELECT count(*) FROM aml.mandatory_triggers
      WHERE key IN ('pep_edd_outstanding','pep_approval_outstanding')) < 2 THEN
    RAISE EXCEPTION 'PEP mandatory triggers did not converge';
  END IF;
  IF (SELECT count(*) FROM aml.retention_schedules
      WHERE entity_type IN ('pep_determination','senior_manager_designation')) < 2 THEN
    RAISE EXCEPTION 'retention registration did not converge for the new record types';
  END IF;
END $$;

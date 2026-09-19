-- Didit **Standalone API** identity verification, on the EXISTING canonical model.
--
-- The customer now captures their identity document and their face inside NPC,
-- the images land in NPC's own private buckets, and a server-side processor
-- calls Didit's three Standalone endpoints. No hosted session, no verification
-- URL, no webhook, no Didit UI. See docs/aml/DIDIT_STANDALONE_IDV.md.
--
-- Nothing here creates a second verification domain. A Standalone attempt is an
-- ordinary `check_type = 'electronic_idv'` row on `aml.verification_checks`
-- whose `provider` is 'didit_standalone'. The columns the canonical model
-- already added (20260831000000) carry everything else:
--
--   provider                    'didit_standalone'
--   provider_reference          the ID Verification request_id
--   provider_attempt_reference  same
--   document_reference          aml-documents path of the FRONT capture
--   biometric_storage_path      aml-biometrics path of the selfie
--   outcome_detail.standalone_capture   the server-generated capture plan
--   outcome_detail.standalone           sanitised evidence: verdicts, scores,
--                                       request ids, thresholds in force
--   attempt_consumed            still only ever true for a real outcome
--
-- Four changes, all additive and idempotent:
--   1. a `draft` processing state, so an attempt can be PREPARED (paths minted,
--      signed upload grants issued) before any image exists and without
--      consuming anything;
--   2. the outbox trigger fires on UPDATE as well as INSERT, because a draft
--      becomes queued by an update and previously emitted nothing;
--   3. `provider_error_category` gains the Standalone failure vocabulary;
--   4. one draft per party, enforced by the database.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS aml.uq_aml_verification_draft_capture;
--   ALTER TABLE aml.verification_checks DROP CONSTRAINT IF EXISTS verification_checks_processing_status_check;
--   ALTER TABLE aml.verification_checks ADD CONSTRAINT verification_checks_processing_status_check
--     CHECK (processing_status IN ('submitted','queued','processing','completed','capture_unusable',
--            'technical_failure','retry_scheduled','dead_lettered','cancelled'));
--   ALTER TABLE aml.verification_checks DROP CONSTRAINT IF EXISTS verification_checks_provider_error_category_check;
--   ALTER TABLE aml.verification_checks ADD CONSTRAINT verification_checks_provider_error_category_check
--     CHECK (provider_error_category IS NULL OR provider_error_category IN
--            ('provider_not_configured','provider_misconfigured','provider_unavailable',
--             'timeout','storage_unreadable','capture_unusable','worker_failure'));
--   DROP TRIGGER IF EXISTS trg_aml_verification_outbox ON aml.verification_checks;
--   CREATE TRIGGER trg_aml_verification_outbox AFTER INSERT ON aml.verification_checks
--     FOR EACH ROW EXECUTE FUNCTION aml.tg_emit_verification_requested();
--   DELETE FROM aml.provider_configs WHERE provider_key = 'didit_standalone';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. `draft` — an attempt that has been prepared but not submitted.
--
-- This is what makes "creating upload URLs consumes no attempt" structural
-- rather than a promise in application code. A draft row holds the capture
-- plan the server minted (which paths, which bucket, which sides are required)
-- and nothing else: no images exist yet, `attempt_consumed` is false, the
-- outbox trigger declines to emit for it, and the attempt counter
-- (`aml.verification_attempts_used`, which counts `attempt_consumed`) cannot
-- see it.
--
-- It is also what removes browser-supplied storage paths from the submission.
-- The old `submit_verification` took `document_storage_path` and
-- `selfie_storage_path` from the request body and validated a `caseId/` prefix;
-- now the browser sends an attempt id and every path comes from this row.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE aml.verification_checks
  DROP CONSTRAINT IF EXISTS verification_checks_processing_status_check;
ALTER TABLE aml.verification_checks
  ADD CONSTRAINT verification_checks_processing_status_check
  CHECK (processing_status IN
    ('draft','submitted','queued','processing','completed','capture_unusable',
     'technical_failure','retry_scheduled','dead_lettered','cancelled'));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Standalone failure vocabulary.
--
-- The existing list was written for one provider that answered over one call.
-- Three of these separate conditions that the old set collapsed into
-- `provider_unavailable`, and the distinction is operational: an empty credit
-- balance needs a card, a rate limit needs patience, and a request the provider
-- refused needs a developer. `provider_rejected_request` in particular must
-- never be readable as "the customer failed" — it means NPC sent something
-- Didit would not accept.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE aml.verification_checks
  DROP CONSTRAINT IF EXISTS verification_checks_provider_error_category_check;
ALTER TABLE aml.verification_checks
  ADD CONSTRAINT verification_checks_provider_error_category_check
  CHECK (provider_error_category IS NULL OR provider_error_category IN
    ('provider_not_configured','provider_misconfigured','provider_unavailable',
     'timeout','storage_unreadable','capture_unusable','worker_failure',
     'insufficient_credits','rate_limited','provider_rejected_request'));

-- ─────────────────────────────────────────────────────────────────────────
-- 3. The outbox trigger has to see the draft → queued transition.
--
-- It was AFTER INSERT only. Under the hosted and self-hosted flows that was
-- complete, because a check was INSERTed already queued. A Standalone attempt
-- is inserted as a draft and becomes queued by an UPDATE, so on the old trigger
-- the durable event was never written and the durable path silently did not
-- exist for the new flow.
--
-- Duplicate emission is not a risk: `idempotency_key` is 'aml-verify-<row id>'
-- and the insert is ON CONFLICT DO NOTHING, so a row emits exactly once no
-- matter how many times it is updated into an emitting state.
--
-- The `document_reference IS NOT NULL` condition from 20260908000000 stays, and
-- keeps doing its job: a hosted-session check never has one, so hosted checks
-- still cannot enter the image worker. A Standalone check has one from the
-- moment it is submitted.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION aml.tg_emit_verification_requested()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = aml, public
AS $$
BEGIN
  IF NEW.check_type = 'electronic_idv'
     AND NEW.processing_status IN ('submitted', 'queued')
     AND NEW.document_reference IS NOT NULL THEN
    INSERT INTO public.integration_outbox
      (aggregate_type, aggregate_id, event_type, event_version, payload, idempotency_key)
    VALUES (
      'aml_verification_check', NEW.id, 'aml.verification.requested', 1,
      jsonb_build_object(
        'verification_check_id', NEW.id,
        'case_id', NEW.case_id,
        'capture_sequence', NEW.capture_sequence
      ),
      'aml-verify-' || NEW.id::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aml_verification_outbox ON aml.verification_checks;
CREATE TRIGGER trg_aml_verification_outbox
  AFTER INSERT OR UPDATE ON aml.verification_checks
  FOR EACH ROW EXECUTE FUNCTION aml.tg_emit_verification_requested();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. At most ONE draft per party — enforced by the database.
--
-- `prepare_verification_attempt` is idempotent by intent: a refresh, a second
-- tab and a double tap should all land on the SAME attempt and the same three
-- storage paths, not on three drafts racing to be submitted. Application code
-- resumes an existing draft, but "select then insert" is not atomic, so the
-- index is what actually holds it. The loser of the race gets 23505 and is
-- answered with the draft that already exists.
--
-- Scoped to drafts only, so a completed or abandoned attempt never blocks the
-- next legitimate one.
-- ─────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_verification_draft_capture
  ON aml.verification_checks (case_id, COALESCE(party_id, case_id))
  WHERE check_type = 'electronic_idv'
    AND processing_status = 'draft'
    AND superseded_at IS NULL;

COMMENT ON INDEX aml.uq_aml_verification_draft_capture IS
  'One prepared-but-unsubmitted capture attempt per party. Makes '
  'prepare_verification_attempt idempotent across tabs and refreshes, so a '
  'customer cannot accumulate drafts or storage paths. Drafts consume no '
  'attempt: aml.verification_attempts_used() counts attempt_consumed only.';

-- Processing lookup for the watchdog sweep: queued Standalone work, oldest
-- first. The existing idx_aml_verification_processing covers
-- ('queued','retry_scheduled') on next_retry_at, which is not this query.
CREATE INDEX IF NOT EXISTS idx_aml_verification_standalone_queue
  ON aml.verification_checks (processing_status, created_at)
  WHERE check_type = 'electronic_idv'
    AND processing_status IN ('queued', 'processing')
    AND superseded_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. The provider row, INACTIVE.
--
-- Seeded so that switching NPC from the hosted session onto the Standalone
-- capture journey is a reviewed one-field change by an operator —
--
--   UPDATE aml.provider_configs SET active = true
--    WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit_standalone';
--   UPDATE aml.provider_configs SET active = false
--    WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';
--
-- — rather than a side effect of deploying this migration. Both statements are
-- deliberately separate: the hosted row must stay readable while the sessions
-- open on 2026-08-08 settle, and only ONE idv provider is active at a time
-- (resolveTenantProvider takes the highest-priority active row).
--
-- `mode` is stated explicitly. The column defaults to 'simulator' and
-- production carries aml.tg_reject_simulator_idv(), which raises
-- check_violation on any simulator-mode idv row — omitting it made the
-- 20260908000000 migration impossible to apply to production. 'live' is also
-- the only correct value: there is no Didit simulator.
--
-- No credential is stored here. `secret_ref` NAMES the secret; the value lives
-- only in the function environment, alongside the two thresholds — which are
-- policy, not secrets, but are environment-held so that changing NPC's
-- compliance position is a deployment action with a record rather than a row
-- edit.
-- ─────────────────────────────────────────────────────────────────────────
-- ## What `cost_per_unit_cents` means here, and why it is not zero
--
-- Traced before setting it: `runWithMetrics` adds this value to
-- `aml.provider_metrics_daily.cost_cents_sum` once per SUCCESSFUL provider
-- call, and `AmlConfiguration.tsx` renders that sum as "30-day cost". It is
-- real cost reporting, and the UNIT is one provider call — not one
-- verification. A paid integration left at 0 would report a growing spend as
-- free, which is the one answer worse than an imprecise number.
--
-- Didit prices the three Standalone endpoints separately, per successful
-- request, in USD (docs.didit.me/getting-started/pricing, read 2026-08-11):
--
--     ID Verification   USD 0.20
--     Passive Liveness  USD 0.05
--     Face Match        USD 0.05
--
-- One integer cannot express three prices, so the exact per-call figures go in
-- `config.standalone_unit_costs_cents` and the ORCHESTRATOR passes the matching
-- one to `runWithMetrics` per step. That makes the variable fail-fast sequence
-- account correctly by construction: an attempt that stops at a declined
-- document records 20, and a full pass records 30. No estimate, no average, and
-- nothing that has to be kept in step by hand.
--
-- The column itself carries **the dearest single call (20)** rather than the
-- full-sequence 30. It is the fallback for any caller that does not pass a
-- per-step cost, and at a per-call unit a fallback that errs high is safe for
-- budget reporting while one that errs low is not. Setting 30 here would make
-- such a caller over-report threefold.
--
-- `currency` is USD because that is what Didit bills. The existing metrics
-- roll-up sums `cost_cents_sum` without a currency dimension — every provider
-- in it is currently 0, so this is the first real figure and the first mixed
-- currency. Converting is a finance decision and changing that aggregation is
-- out of scope here; it is recorded in docs/aml/DIDIT_STANDALONE_IDV.md as a
-- known limitation rather than silently mislabelled as AUD.
INSERT INTO aml.provider_configs
  (tenant_id, capability, provider_key, display_label, priority,
   cost_per_unit_cents, currency, active, mode, secret_ref, config)
SELECT 'default', 'idv', 'didit_standalone',
       'Didit Standalone APIs (NPC capture)', 5,
       20, 'USD', false, 'live', 'DIDIT_API_KEY',
       jsonb_build_object(
         'flow', 'capture',
         'integration_mode', 'standalone',
         'endpoints', jsonb_build_array(
           '/v3/id-verification/', '/v3/passive-liveness/', '/v3/face-match/'),
         'save_api_request', false,
         'required_env', jsonb_build_array(
           'DIDIT_API_KEY', 'DIDIT_LIVENESS_THRESHOLD', 'DIDIT_FACE_MATCH_THRESHOLD'),
         -- Per-call prices, in cents of `pricing_currency`. Read by
         -- standaloneVerification.ts so each billed step is metered at its own
         -- price and a fail-fast sequence costs what it actually cost.
         'standalone_unit_costs_cents', jsonb_build_object(
           'id_verification', 20, 'passive_liveness', 5, 'face_match', 5),
         'pricing_currency', 'USD',
         'pricing_source', 'https://docs.didit.me/getting-started/pricing',
         'pricing_observed_at', '2026-08-11',
         'pricing_note', 'Per successful request. A full three-call sequence is USD 0.30; '
                 'a sequence that fail-fasts costs less and is metered per step. '
                 'cost_per_unit_cents carries the dearest single call as a fallback.',
         'note', 'Identity verification only — ID document, passive liveness, face match 1:1. '
                 'Didit AML/PEP/sanctions/KYB/proof-of-address screening is NOT enabled and '
                 'must not be: NPC screens against its own DFAT/UN/OFAC lists. '
                 'save_api_request is false on every call: NPC/Supabase is the evidence store.'
       )
WHERE EXISTS (SELECT 1 FROM aml.tenant_settings WHERE tenant_id = 'default')
ON CONFLICT (tenant_id, capability, provider_key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- Convergence checks. A silent no-op here would mean prepared attempts that
-- can never be submitted, or submitted attempts that emit no durable event.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'aml.verification_checks'::regclass
       AND conname = 'verification_checks_processing_status_check'
       AND pg_get_constraintdef(oid) LIKE '%draft%'
  ) THEN
    RAISE EXCEPTION 'didit standalone did not converge: processing_status has no draft state';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'aml.verification_checks'::regclass
       AND conname = 'verification_checks_provider_error_category_check'
       AND pg_get_constraintdef(oid) LIKE '%insufficient_credits%'
  ) THEN
    RAISE EXCEPTION 'didit standalone did not converge: provider_error_category is missing the standalone vocabulary';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'aml' AND c.relname = 'verification_checks'
       AND t.tgname = 'trg_aml_verification_outbox'
       -- tgtype bit 2 (value 4) is INSERT, bit 4 (value 16) is UPDATE.
       AND (t.tgtype & 4) = 4 AND (t.tgtype & 16) = 16
  ) THEN
    RAISE EXCEPTION 'didit standalone did not converge: the verification outbox trigger does not fire on UPDATE, so a submitted draft emits no durable event';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'aml' AND indexname = 'uq_aml_verification_draft_capture'
  ) THEN
    RAISE EXCEPTION 'didit standalone did not converge: draft uniqueness index missing';
  END IF;
END $$;

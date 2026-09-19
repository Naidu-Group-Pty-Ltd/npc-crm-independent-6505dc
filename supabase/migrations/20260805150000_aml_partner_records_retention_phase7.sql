-- Records, privacy, retention and disposal extensions — Phase 7 of the
-- AML/CTF partner/reliance domain.
--
-- ── RECONCILIATION (§7.1 — recorded before any new schema) ────────────────
--
-- The repository already contains ONE retention/disposal engine and it is
-- EXTENDED here, never duplicated:
--
--   aml.retention_schedules   per-entity-type configuration (years, legal
--                             basis, disposal method) — MLRO-editable
--   aml.retention_triggers    the recorded legal trigger that starts every
--                             clock (supersede-not-overwrite; §18 doctrine:
--                             no trigger, no clock, never disposal-eligible)
--   aml.legal_holds           active hold blocks disposal (checked at dry
--                             run AND re-checked at execution)
--   aml.retention_scans/_scan_items  dry run → awaiting_approval → approved
--                             (MLRO) → executing → completed, with
--                             dependency_blockers and disposal_evidence
--   aml-records edge function dependencyBlockersFor / activeHoldFor /
--                             disposeBiometric (object removed FIRST,
--                             pointer cleared second) / hash-chained
--                             records_audit_events
--
-- Raw-capture finding (§7.8): the platform stores ONE class of raw identity
-- object — the biometric facial image (verification_checks.
-- biometric_storage_path, aml-biometrics bucket, hard_delete schedule,
-- APP 11 access log). Full ID-document copies are NOT stored as objects:
-- document sighting keeps structured attributes (document type, certifier
-- capacity) only. The raw_id_document_copy record class and its
-- necessity-end trigger kind are catalogued now so any future capture MUST
-- adopt them instead of inheriting the structured-CDD clock.
--
-- What Phase 7 adds (all additive):
--   1. eight trigger kinds (superset CHECK swap) — partner relationship /
--      arrangement / evidence-delivery / necessity-end / obligation clocks;
--   2. aml.record_class_catalogue — the controlled record taxonomy:
--      family (GOV…AUD), P1–P6 information classification, storage zone,
--      access-logging duty, trigger kind and disposal rule per class, with
--      a structural guarantee that P4/P5/P6 can never be partner-exportable;
--   3. retention_schedules seeds for the partner-domain entity types
--      (recorded configuration — the MLRO edits them via the existing op);
--   4. disposal lifecycle events: the Phase 6 catalogue's three
--      aml.disposal.* events gain their emitter (AFTER UPDATE trigger on
--      aml.retention_scans), atomic with the scan transition;
--   5. the aml_partner_records_retention flag (default false). The flag
--      gates only the partner-domain EXTENSION in aml-records; existing
--      retention controls are untouched while it is off.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_aml_emit_disposal_events ON aml.retention_scans;
--   DROP FUNCTION IF EXISTS aml.emit_disposal_events();
--   DROP TABLE IF EXISTS aml.record_class_catalogue;
--   DELETE FROM aml.retention_schedules WHERE entity_type IN
--     ('partner_case_link','partner_records_request','partner_evidence_delivery',
--      'partner_refresh_obligation','partner_notification','attestation',
--      'reliance_grant','disclosure_manifest','arrangement_assessment',
--      'partner_organisation','raw_id_document_copy');
--   UPDATE aml.partner_event_catalogue SET emitted_by = 'phase7'
--     WHERE event_type IN ('aml.disposal.approved','aml.disposal.executed','aml.disposal.failed');
--   -- Restore the original trigger-kind CHECK ONLY after confirming no row
--   -- uses a new kind:
--   --   ALTER TABLE aml.retention_triggers DROP CONSTRAINT retention_triggers_trigger_kind_check;
--   --   ALTER TABLE aml.retention_triggers ADD CONSTRAINT retention_triggers_trigger_kind_check
--   --     CHECK (trigger_kind IN ('relationship_end','occasional_transaction_complete',
--   --       'transaction_date','program_version_obsolete','investigation_complete',
--   --       'report_complete','legal_hold_release'));
--   DELETE FROM public.feature_flags WHERE key = 'aml_partner_records_retention';

-- ── 1. Trigger kinds: superset CHECK swap (§7.5) ──────────────────────────
-- Every historical value remains valid. The new kinds give the partner
-- domain and raw-capture classes their own recorded clocks — upload age is
-- never a trigger kind.

ALTER TABLE aml.retention_triggers
  DROP CONSTRAINT IF EXISTS retention_triggers_trigger_kind_check;
ALTER TABLE aml.retention_triggers
  ADD CONSTRAINT retention_triggers_trigger_kind_check CHECK (trigger_kind IN (
    'relationship_end',
    'occasional_transaction_complete',
    'transaction_date',
    'program_version_obsolete',
    'investigation_complete',
    'report_complete',
    'legal_hold_release',
    -- Phase 7 additions:
    'record_created',                   -- ONLY for classes that explicitly use creation date
    'client_transaction_record_received',
    'cdd_arrangement_end',
    'partner_relationship_end',
    'evidence_delivery_end',
    'raw_id_copy_necessity_end',
    'biometric_necessity_end',
    'audit_obligation_end'));

-- ── 2. The controlled record-class catalogue (§7.2, §7.3) ─────────────────
-- One row per record class: the documented family code, the P1–P6
-- information classification, the logical storage zone (mapped to EXISTING
-- stores — no new bucket exists or is implied), the access-logging duty,
-- the trigger kind that starts its clock and the disposal rule. Retention
-- logic reads this catalogue; it is never scattered across UI components.

CREATE TABLE IF NOT EXISTS aml.record_class_catalogue (
  record_code text PRIMARY KEY,
  family text NOT NULL CHECK (family IN
    ('GOV','CUS','IDV','REP','OWN','TRU','SCR','REL','FND','EDD','TXN',
     'CTR','MON','DEC','RPT','CON','SHR','RET','AUD')),
  label text NOT NULL,
  information_classification text NOT NULL CHECK (information_classification IN
    ('P1','P2','P3','P4','P5','P6')),
  -- Who may see the record by default. Disclosure beyond this is always an
  -- explicit, logged decision (manifest, records request, export).
  default_visibility text NOT NULL CHECK (default_visibility IN
    ('client_safe','partner_safe','origin_staff','reviewer_mlro','prohibited')),
  storage_zone text NOT NULL CHECK (storage_zone IN
    ('structured_cdd_db',        -- aml schema relational tables
     'aml_document_vault',       -- existing private AML evidence storage
     'biometric_vault',          -- existing aml-biometrics private bucket
     'restricted_reporting_vault',-- aml reports / EDD / SMR tables
     'attestation_store',        -- aml.compliance_attestations + manifests
     'audit_retention_ledger')), -- hash-chained audit + retention tables
  access_logging_required boolean NOT NULL DEFAULT false,
  retention_trigger_kind text NOT NULL CHECK (retention_trigger_kind IN (
    'relationship_end','occasional_transaction_complete','transaction_date',
    'program_version_obsolete','investigation_complete','report_complete',
    'legal_hold_release','record_created','client_transaction_record_received',
    'cdd_arrangement_end','partner_relationship_end','evidence_delivery_end',
    'raw_id_copy_necessity_end','biometric_necessity_end','audit_obligation_end')),
  disposal_rule text NOT NULL CHECK (disposal_rule IN
    ('soft_delete','redact','hard_delete','recorded_only')),
  partner_exportable boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Structural guarantee, not convention: reviewer/MLRO-restricted,
  -- prohibited and biometric classes can never be marked partner-exportable.
  CONSTRAINT record_class_restricted_never_exportable CHECK (
    information_classification NOT IN ('P4','P5','P6') OR partner_exportable = false
  )
);

INSERT INTO aml.record_class_catalogue
  (record_code, family, label, information_classification, default_visibility,
   storage_zone, access_logging_required, retention_trigger_kind, disposal_rule,
   partner_exportable, notes) VALUES
  -- Partner/reliance domain (Phases 1–6)
  ('partner_organisation_record',   'GOV', 'Partner organisation classification record', 'P2', 'origin_staff',   'structured_cdd_db',    false, 'partner_relationship_end', 'soft_delete',  false, 'Classification is recorded configuration with evidence; retained while any arrangement or link survives.'),
  ('partner_membership_record',     'GOV', 'Partner portal membership mapping',           'P3', 'origin_staff',   'structured_cdd_db',    false, 'partner_relationship_end', 'soft_delete',  false, NULL),
  ('partner_case_link_record',      'REL', 'Partner-case link and legal route',           'P2', 'partner_safe',   'structured_cdd_db',    false, 'partner_relationship_end', 'soft_delete',  true,  'The partner sees its own link state and route.'),
  ('reliance_arrangement_record',   'REL', 'Written CDD arrangement (s 37A)',             'P2', 'origin_staff',   'structured_cdd_db',    false, 'cdd_arrangement_end',      'soft_delete',  true,  'Reference and scope are partner-visible; internal review notes are not.'),
  ('arrangement_assessment_record', 'REL', 'Arrangement review assessment',               'P4', 'reviewer_mlro',  'structured_cdd_db',    false, 'cdd_arrangement_end',      'soft_delete',  false, 'Findings and conditions are internal review reasoning.'),
  ('compliance_attestation_record', 'SHR', 'Compliance attestation (sanitised)',          'P2', 'partner_safe',   'attestation_store',    true,  'relationship_end',         'recorded_only', true, 'Versioned, hash-addressed; rides the case relationship clock; rows are evidence and are never row-deleted apart from the case file.'),
  ('disclosure_manifest_record',    'SHR', 'Per-grant disclosure manifest',               'P2', 'origin_staff',   'attestation_store',    false, 'relationship_end',         'recorded_only', false, NULL),
  ('reliance_grant_record',         'SHR', 'Reliance access grant',                       'P2', 'partner_safe',   'structured_cdd_db',    true,  'relationship_end',         'recorded_only', true,  'Token hash only; every access logged.'),
  ('partner_records_request_record','SHR', 'Controlled partner records request',          'P3', 'partner_safe',   'structured_cdd_db',    false, 'evidence_delivery_end',    'soft_delete',  true,  NULL),
  ('evidence_delivery_record',      'SHR', 'Evidence delivery read model (metadata only)','P3', 'partner_safe',   'structured_cdd_db',    true,  'evidence_delivery_end',    'recorded_only', true, 'No storage path exists on this record by design.'),
  ('partner_determination_record',  'REL', 'Partner independent determination',           'P3', 'partner_safe',   'structured_cdd_db',    false, 'partner_relationship_end', 'soft_delete',  true,  'The partner''s own decision, pinned to a content hash. Append-only history.'),
  ('refresh_obligation_record',     'SHR', 'Partner refresh obligation',                  'P2', 'partner_safe',   'structured_cdd_db',    false, 'audit_obligation_end',     'soft_delete',  true,  'Safe reason code only; internal trigger classification is staff-only.'),
  ('partner_notification_record',   'SHR', 'Partner-safe notification (fixed copy)',      'P2', 'partner_safe',   'structured_cdd_db',    false, 'record_created',           'hard_delete',  true,  'Transient fixed-copy rows; the class explicitly uses creation date.'),
  ('integration_event_record',      'AUD', 'Partner integration outbox event',            'P4', 'origin_staff',   'audit_retention_ledger', false, 'audit_obligation_end',   'recorded_only', false, 'Safe identifiers/codes only, but an internal ops record; never partner-served.'),
  ('delivery_attempt_record',       'AUD', 'Event delivery attempt ledger entry',         'P4', 'origin_staff',   'audit_retention_ledger', false, 'audit_obligation_end',   'recorded_only', false, NULL),
  ('reliance_access_event_record',  'AUD', 'Partner access log entry',                    'P4', 'origin_staff',   'audit_retention_ledger', false, 'audit_obligation_end',   'recorded_only', false, 'The APP-11/audit answer to "who saw what, when".'),
  ('retention_trigger_record',      'RET', 'Recorded retention trigger',                  'P4', 'origin_staff',   'audit_retention_ledger', false, 'audit_obligation_end',   'recorded_only', false, 'Supersede-not-overwrite; the basis of every clock stays reconstructable.'),
  ('legal_hold_record',             'RET', 'Legal hold',                                  'P5', 'reviewer_mlro',  'audit_retention_ledger', false, 'legal_hold_release',     'recorded_only', false, 'Hold reasons may name investigations; never client- or partner-visible.'),
  ('disposal_evidence_record',      'RET', 'Disposal approval/execution evidence',        'P4', 'origin_staff',   'audit_retention_ledger', false, 'audit_obligation_end',   'recorded_only', false, 'The record proving why disposal was authorised is never itself disposed of.'),
  -- Raw-capture classes (§7.8): these NEVER inherit the structured-CDD clock.
  ('raw_id_document_copy',          'IDV', 'Full identity-document image copy',           'P5', 'prohibited',     'aml_document_vault',   true,  'raw_id_copy_necessity_end', 'hard_delete', false, 'NOT CURRENTLY STORED by the platform (structured sighting attributes only). Catalogued so any future capture must use the necessity-end clock, separate from structured CDD data.'),
  ('biometric_raw_capture',         'IDV', 'Raw biometric capture (facial image)',        'P6', 'prohibited',     'biometric_vault',      true,  'biometric_necessity_end',  'hard_delete',  false, 'Existing aml-biometrics object + APP 11 access log; object removed before pointer cleared; consent id retained as authority evidence.')
ON CONFLICT (record_code) DO NOTHING;

GRANT ALL ON aml.record_class_catalogue TO service_role;
GRANT SELECT ON aml.record_class_catalogue TO authenticated;
ALTER TABLE aml.record_class_catalogue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "aml_record_class_catalogue_read"
    ON aml.record_class_catalogue FOR SELECT TO authenticated
    USING (public.has_any_aml_role(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "aml_record_class_catalogue_service"
    ON aml.record_class_catalogue FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Retention schedules for the partner domain (recorded config) ───────
-- Defaults are the s 107 seven-year minimum for CDD-connected records; the
-- MLRO adjusts them through the existing upsert_schedule operation. Values
-- here are CONFIGURATION, not a legal conclusion, mirroring the existing
-- seeds. Transient/necessity classes carry their own shorter defaults with
-- the reasoning in notes.

INSERT INTO aml.retention_schedules (entity_type, retention_years, legal_basis, disposal_method, notes) VALUES
  ('partner_case_link',        7, 'AML/CTF Act 2006 s107 — record of the CDD arrangement relationship', 'soft_delete', 'Clock: partner_relationship_end (link ended). Survives case disposal as arrangement evidence.'),
  ('partner_records_request',  7, 'AML/CTF Act 2006 s107 — record of information shared under an arrangement', 'soft_delete', 'Clock: evidence_delivery_end.'),
  ('partner_evidence_delivery',7, 'AML/CTF Act 2006 s107 — record of information shared under an arrangement', 'soft_delete', 'Metadata read model; clock: evidence_delivery_end (expiry/revocation).'),
  ('partner_refresh_obligation',7,'AML/CTF Act 2006 s107 — refresh obligation evidence', 'soft_delete', 'Clock: audit_obligation_end (completed/cancelled).'),
  ('partner_notification',     2, 'Operational record — configuration default, MLRO adjustable', 'hard_delete', 'Fixed-copy transient rows; clock: record_created (the class explicitly uses creation date).'),
  ('attestation',              7, 'AML/CTF Act 2006 s107 — record of applicable customer identification procedure', 'soft_delete', 'Versioned evidence; rides the case relationship clock; disposal is recorded_only in scans.'),
  ('reliance_grant',           7, 'AML/CTF Act 2006 s107 — record of reliance access granted', 'soft_delete', 'Clock: relationship_end.'),
  ('disclosure_manifest',      7, 'AML/CTF Act 2006 s107 — record of what disclosure was authorised', 'soft_delete', 'Clock: relationship_end.'),
  ('arrangement_assessment',   7, 'AML/CTF Act 2006 s37A — regular review evidence', 'soft_delete', 'Clock: cdd_arrangement_end.'),
  ('partner_organisation',     7, 'AML/CTF Act 2006 s107 — counterparty identity and classification evidence', 'soft_delete', 'Clock: partner_relationship_end (last arrangement/link ended).'),
  ('raw_id_document_copy',     0, 'Privacy Act 1988 APP 11.2 — destroy when no longer necessary', 'hard_delete', 'Not currently stored. Necessity-end clock, immediate disposal eligibility once necessity ends and dependencies allow. Years=0 is deliberate: the clock is necessity, not a period.')
ON CONFLICT (entity_type) DO NOTHING;

-- ── 4. Disposal lifecycle events (completes the Phase 6 catalogue) ────────
-- Emitted by the scan-status transition in the SAME transaction, through
-- the same flag-gated, catalogue-validated, duplicate-safe choke point.
-- Ops-only destination: disposal never notifies a partner.

CREATE OR REPLACE FUNCTION aml.emit_disposal_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = aml, public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'approved' THEN
      PERFORM aml.enqueue_partner_event(
        'aml.disposal.approved', 'retention_scan', NEW.id, 1,
        jsonb_build_object('scan_id', NEW.id, 'scope', NEW.scope,
          'candidates_count', NEW.candidates_count, 'held_count', NEW.held_count),
        'aml.disposal.approved:' || NEW.id);
    ELSIF NEW.status = 'completed' THEN
      PERFORM aml.enqueue_partner_event(
        'aml.disposal.executed', 'retention_scan', NEW.id, 1,
        jsonb_build_object('scan_id', NEW.id, 'scope', NEW.scope,
          'disposed_count', NEW.disposed_count, 'skipped_count', NEW.skipped_count),
        'aml.disposal.executed:' || NEW.id);
    ELSIF NEW.status = 'failed' THEN
      PERFORM aml.enqueue_partner_event(
        'aml.disposal.failed', 'retention_scan', NEW.id, 1,
        jsonb_build_object('scan_id', NEW.id, 'scope', NEW.scope),
        'aml.disposal.failed:' || NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_aml_emit_disposal_events ON aml.retention_scans;
CREATE TRIGGER trg_aml_emit_disposal_events
  AFTER UPDATE ON aml.retention_scans
  FOR EACH ROW EXECUTE FUNCTION aml.emit_disposal_events();

UPDATE aml.partner_event_catalogue SET emitted_by = 'trigger'
  WHERE event_type IN ('aml.disposal.approved', 'aml.disposal.executed', 'aml.disposal.failed')
    AND emitted_by = 'phase7';

-- ── 5. Feature flag (default OFF; enabling is an operator decision) ───────
-- Gates ONLY the partner-domain extension in aml-records (partner trigger
-- derivation, partner dependency blockers, partner entries in exports).
-- Existing retention behaviour is unchanged while false.

INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_partner_records_retention', 'false'::jsonb,
   'AML partner domain Phase 7: partner-domain record classes join the trigger-based retention engine — partner trigger derivation (sync_partner_triggers), partner dependency blockers before disposal, and partner-sharing metadata in privacy exports. Off = the retention engine behaves exactly as before.')
ON CONFLICT (key) DO NOTHING;

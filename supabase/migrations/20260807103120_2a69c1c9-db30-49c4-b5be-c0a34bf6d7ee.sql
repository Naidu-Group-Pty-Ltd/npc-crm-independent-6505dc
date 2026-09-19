CREATE TABLE IF NOT EXISTS aml.partner_sla_targets (
  queue_key text PRIMARY KEY,
  label text NOT NULL,
  warn_hours integer NOT NULL CHECK (warn_hours > 0),
  escalate_hours integer NOT NULL CHECK (escalate_hours >= warn_hours),
  responsible_role text NOT NULL CHECK (responsible_role IN
    ('mlro', 'reviewer', 'analyst', 'partner_organisation')),
  note text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO aml.partner_sla_targets
  (queue_key, label, warn_hours, escalate_hours, responsible_role, note) VALUES
  ('partner_records_requests_pending', 'Partner records requests awaiting review',      48,  120, 'mlro',
   'Operational target, not a legal deadline. Triage window for controlled records requests.'),
  ('evidence_delivery_approval',       'Approved requests awaiting delivery recording', 72,  168, 'mlro',
   'Operational target, not a legal deadline. Aligned to arrangement record-availability terms where recorded.'),
  ('partner_determination_pending',    'Partner determinations outstanding',            120, 336, 'partner_organisation',
   'The partner organisation''s own decision under its own obligations — never the originating MLRO''s to make.'),
  ('partner_refresh_required',         'Open partner refresh obligations',              72,  168, 'partner_organisation',
   'Partner-owned follow-up after a material change. Operational target, not a legal deadline.'),
  ('arrangement_assessment_due',       'Arrangement reviews due within 30 days',        336, 720, 'mlro',
   'Regular review is a s 37A condition; the warn window is an operational target for scheduling it.'),
  ('arrangement_assessment_overdue',   'Arrangement reviews overdue',                   24,  72,  'mlro',
   'Overdue reviews suspend new grants; clearing them is time-critical operations work.'),
  ('partner_classification_pending',   'Partner organisations awaiting classification', 120, 336, 'mlro',
   'Classification is recorded configuration with evidence; unclassified blocks reliance-capable behaviour only.'),
  ('retention_approval',               'Retention scans awaiting MLRO approval',        72,  168, 'mlro',
   'Operational target, not a legal deadline.'),
  ('disposal_failure',                 'Failed disposal actions',                       24,  72,  'mlro',
   'A failed deletion stays visible and blocked until resolved — it never silently clears.'),
  ('outbox_retry',                     'Partner events retrying',                       12,  48,  'analyst',
   'Delivery retries within backoff. Sustained growth means the worker is not being invoked.'),
  ('outbox_failed',                    'Partner events dead-lettered',                  12,  24,  'analyst',
   'Terminal delivery failures awaiting operator replay.'),
  ('sanctions_freshness',              'Sanctions list sources stale',                  24,  72,  'mlro',
   'List freshness underpins screening statements in attestations.')
ON CONFLICT (queue_key) DO NOTHING;

GRANT ALL ON aml.partner_sla_targets TO service_role;
GRANT SELECT ON aml.partner_sla_targets TO authenticated;
ALTER TABLE aml.partner_sla_targets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "aml_partner_sla_targets_read"
    ON aml.partner_sla_targets FOR SELECT TO authenticated
    USING (public.has_any_aml_role(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "aml_partner_sla_targets_service"
    ON aml.partner_sla_targets FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_partner_operations_reporting', 'false'::jsonb,
   'AML partner domain Phase 8: Command Center partner operations — compliance queues, filtered registers, management reporting and SLA ageing over the Phases 1–7 partner domain. Off = the operations answer 409 and no partner-operations UI renders.')
ON CONFLICT (key) DO NOTHING;
-- Phase 11 — Records, Privacy, Retention & Tipping-Off
-- Adds retention schedules, legal holds, retention scans (dry-run + approval + execute),
-- privacy requests, tipping-off suppression rules, and a hash-chained audit table.

-- ============ retention_schedules ============
CREATE TABLE aml.retention_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL UNIQUE,          -- e.g. 'case','verification','screening','transaction','report','edd','alert'
  retention_years NUMERIC(5,2) NOT NULL CHECK (retention_years >= 0),
  legal_basis TEXT NOT NULL,                 -- e.g. 'AML/CTF Act 2006 s107 (7 years)'
  disposal_method TEXT NOT NULL DEFAULT 'soft_delete', -- 'soft_delete' | 'redact' | 'hard_delete'
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

GRANT SELECT ON aml.retention_schedules TO authenticated;
GRANT ALL ON aml.retention_schedules TO service_role;
ALTER TABLE aml.retention_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_rs_read" ON aml.retention_schedules FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_rs_write" ON aml.retention_schedules FOR ALL TO authenticated
  USING (public.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (public.has_aml_role(auth.uid(), 'mlro'));

-- Seed the mandated 7-year AUSTRAC defaults
INSERT INTO aml.retention_schedules (entity_type, retention_years, legal_basis, disposal_method, notes) VALUES
  ('case',         7, 'AML/CTF Act 2006 s107 – 7 years from case closure', 'soft_delete', 'Retain all case artefacts, decisions and MLRO sign-offs'),
  ('verification', 7, 'AML/CTF Act 2006 s107 – 7 years from verification', 'redact', 'Redact IDV media; keep verification outcome record'),
  ('screening',    7, 'AML/CTF Act 2006 s107',                              'soft_delete', 'PEP/Sanctions screening evidence'),
  ('transaction',  7, 'AML/CTF Act 2006 s107',                              'soft_delete', 'Transaction settlement and party evidence'),
  ('report',       7, 'AML/CTF Act 2006 s119 – SMR/TTR/IFTI retention',     'soft_delete', 'AUSTRAC report drafts, versions, receipts'),
  ('alert',        7, 'AML/CTF Rules Ch 8',                                 'soft_delete', 'Monitoring alerts and remediation notes'),
  ('edd',          7, 'AML/CTF Rules Ch 15',                                'soft_delete', 'Enhanced due diligence workpapers and source-of-funds/wealth');

-- ============ legal_holds ============
CREATE TABLE aml.legal_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID,                            -- nullable if hold is scoped to a case
  case_id UUID REFERENCES aml.cases(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  imposed_by UUID NOT NULL,
  imposed_by_label TEXT,
  imposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_by UUID,
  released_at TIMESTAMPTZ,
  release_note TEXT,
  active BOOLEAN GENERATED ALWAYS AS (released_at IS NULL) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX aml_lh_active_idx ON aml.legal_holds (entity_type, entity_id) WHERE released_at IS NULL;
CREATE INDEX aml_lh_case_idx ON aml.legal_holds (case_id) WHERE released_at IS NULL;

GRANT SELECT ON aml.legal_holds TO authenticated;
GRANT ALL ON aml.legal_holds TO service_role;
ALTER TABLE aml.legal_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_lh_read" ON aml.legal_holds FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_lh_write" ON aml.legal_holds FOR ALL TO authenticated
  USING (public.has_aml_role(auth.uid(), 'reviewer') OR public.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (public.has_aml_role(auth.uid(), 'reviewer') OR public.has_aml_role(auth.uid(), 'mlro'));

-- ============ retention_scans ============
CREATE TABLE aml.retention_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL DEFAULT 'all',                    -- 'all' | entity_type
  status TEXT NOT NULL DEFAULT 'dry_run'
    CHECK (status IN ('dry_run','awaiting_approval','approved','executing','completed','cancelled','failed')),
  requested_by UUID NOT NULL,
  requested_by_label TEXT,
  approved_by UUID,
  approved_by_label TEXT,
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  candidates_count INT NOT NULL DEFAULT 0,
  held_count INT NOT NULL DEFAULT 0,
  disposed_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON aml.retention_scans TO authenticated;
GRANT ALL ON aml.retention_scans TO service_role;
ALTER TABLE aml.retention_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_rsc_read" ON aml.retention_scans FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_rsc_write" ON aml.retention_scans FOR ALL TO authenticated
  USING (public.has_aml_role(auth.uid(), 'reviewer') OR public.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (public.has_aml_role(auth.uid(), 'reviewer') OR public.has_aml_role(auth.uid(), 'mlro'));

-- ============ retention_scan_items ============
CREATE TABLE aml.retention_scan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES aml.retention_scans(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  reference_label TEXT,
  eligible_since TIMESTAMPTZ,
  disposition TEXT NOT NULL DEFAULT 'pending'
    CHECK (disposition IN ('pending','held','approved','disposed','skipped','failed')),
  hold_id UUID REFERENCES aml.legal_holds(id) ON DELETE SET NULL,
  disposal_method TEXT,
  note TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX aml_rsi_scan_idx ON aml.retention_scan_items (scan_id);
CREATE INDEX aml_rsi_entity_idx ON aml.retention_scan_items (entity_type, entity_id);

GRANT SELECT ON aml.retention_scan_items TO authenticated;
GRANT ALL ON aml.retention_scan_items TO service_role;
ALTER TABLE aml.retention_scan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_rsi_read" ON aml.retention_scan_items FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_rsi_write" ON aml.retention_scan_items FOR ALL TO authenticated
  USING (public.has_aml_role(auth.uid(), 'reviewer') OR public.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (public.has_aml_role(auth.uid(), 'reviewer') OR public.has_aml_role(auth.uid(), 'mlro'));

-- ============ privacy_requests ============
CREATE TABLE aml.privacy_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('access','correction','deletion','portability','objection')),
  subject_client_id UUID,
  subject_email TEXT,
  subject_full_name TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','in_progress','awaiting_verification','fulfilled','partially_fulfilled','rejected','withdrawn')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ,                        -- default: received_at + 30d (set client-side)
  fulfilled_at TIMESTAMPTZ,
  requested_by_label TEXT,                   -- external requester description
  received_via TEXT,                         -- 'client_portal' | 'email' | 'phone' | 'post'
  request_details TEXT,
  response_summary TEXT,
  response_bundle_path TEXT,                 -- storage path if export bundle generated
  rejection_reason TEXT,
  handled_by UUID,
  handled_by_label TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX aml_pr_status_idx ON aml.privacy_requests (status, received_at DESC);

GRANT SELECT ON aml.privacy_requests TO authenticated;
GRANT ALL ON aml.privacy_requests TO service_role;
ALTER TABLE aml.privacy_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_pr_read" ON aml.privacy_requests FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_pr_write" ON aml.privacy_requests FOR ALL TO authenticated
  USING (public.has_aml_role(auth.uid(), 'analyst') OR public.has_aml_role(auth.uid(), 'reviewer') OR public.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (public.has_aml_role(auth.uid(), 'analyst') OR public.has_aml_role(auth.uid(), 'reviewer') OR public.has_aml_role(auth.uid(), 'mlro'));

-- ============ tipping_off_rules ============
CREATE TABLE aml.tipping_off_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surface TEXT NOT NULL,                     -- 'client_portal' | 'email' | 'notification' | 'sms' | 'agent_response'
  pattern TEXT NOT NULL,                     -- case-insensitive substring or /regex/
  is_regex BOOLEAN NOT NULL DEFAULT false,
  suppression_mode TEXT NOT NULL DEFAULT 'block'
    CHECK (suppression_mode IN ('block','redact','warn')),
  replacement_copy TEXT,                     -- safe copy for redact/warn
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON aml.tipping_off_rules TO authenticated;
GRANT ALL ON aml.tipping_off_rules TO service_role;
ALTER TABLE aml.tipping_off_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_tor_read" ON aml.tipping_off_rules FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_tor_write" ON aml.tipping_off_rules FOR ALL TO authenticated
  USING (public.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (public.has_aml_role(auth.uid(), 'mlro'));

-- Seed default tipping-off suppression rules
INSERT INTO aml.tipping_off_rules (surface, pattern, is_regex, suppression_mode, replacement_copy, note) VALUES
  ('client_portal', 'suspicious matter', false, 'block',  NULL, 'Never reveal SMR consideration to client'),
  ('client_portal', 'AUSTRAC',           false, 'block',  NULL, 'Never reference regulator lodgement to client'),
  ('client_portal', 'money laundering',  false, 'redact', 'compliance review', 'Use neutral compliance-review language'),
  ('email',         'SMR',               false, 'block',  NULL, 'Block outbound emails referencing SMR'),
  ('email',         'terrorism financing', false, 'block', NULL, 'Block outbound emails referencing TF'),
  ('notification',  'suspicious',        false, 'warn',   NULL, 'Warn author before sending'),
  ('agent_response','SMR',               false, 'block',  NULL, 'Agent must never surface SMR status to client-facing users');

-- ============ records_audit_events (hash chain, schema-scoped) ============
CREATE TABLE aml.records_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,                    -- 'schedule','hold','scan','privacy','tipping_off'
  summary TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID,
  actor_label TEXT,
  prev_hash TEXT,
  row_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX aml_rae_created_idx ON aml.records_audit_events (created_at DESC);

GRANT SELECT ON aml.records_audit_events TO authenticated;
GRANT ALL ON aml.records_audit_events TO service_role;
ALTER TABLE aml.records_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_rae_read" ON aml.records_audit_events FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
-- writes only via service_role (edge fn)

-- ============ updated_at triggers ============
CREATE TRIGGER trg_aml_rs_updated  BEFORE UPDATE ON aml.retention_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_aml_lh_updated  BEFORE UPDATE ON aml.legal_holds         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_aml_rsc_updated BEFORE UPDATE ON aml.retention_scans     FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_aml_pr_updated  BEFORE UPDATE ON aml.privacy_requests    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_aml_tor_updated BEFORE UPDATE ON aml.tipping_off_rules   FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Phase 4: Identity Verification, PEP & Sanctions Integrations
-- ============================================================

-- ---------- identity_checks ----------
CREATE TABLE IF NOT EXISTS aml.identity_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  subject_label TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'simulator',
  provider_reference TEXT,
  method TEXT NOT NULL DEFAULT 'document_and_liveness',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','verified','failed','expired','manual_review','cancelled')),
  overall_score NUMERIC,
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by UUID,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  mc_job_id TEXT,
  mc_tokens_committed INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_idv_case ON aml.identity_checks(case_id);
CREATE INDEX IF NOT EXISTS idx_aml_idv_status ON aml.identity_checks(status);

GRANT SELECT, INSERT, UPDATE ON aml.identity_checks TO authenticated;
GRANT ALL ON aml.identity_checks TO service_role;
ALTER TABLE aml.identity_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml idv read"   ON aml.identity_checks FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml idv write"  ON aml.identity_checks FOR INSERT TO authenticated
  WITH CHECK (public.has_aml_role(auth.uid(), 'analyst')
           OR public.has_aml_role(auth.uid(), 'reviewer')
           OR public.has_aml_role(auth.uid(), 'mlro'));
CREATE POLICY "aml idv update" ON aml.identity_checks FOR UPDATE TO authenticated
  USING (public.has_aml_role(auth.uid(), 'analyst')
      OR public.has_aml_role(auth.uid(), 'reviewer')
      OR public.has_aml_role(auth.uid(), 'mlro'));

-- ---------- identity_documents ----------
CREATE TABLE IF NOT EXISTS aml.identity_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_check_id UUID NOT NULL REFERENCES aml.identity_checks(id) ON DELETE CASCADE,
  doc_kind TEXT NOT NULL,
  storage_path TEXT,
  filename TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
  score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_iddoc_check ON aml.identity_documents(identity_check_id);

GRANT SELECT, INSERT, UPDATE ON aml.identity_documents TO authenticated;
GRANT ALL ON aml.identity_documents TO service_role;
ALTER TABLE aml.identity_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml iddoc read" ON aml.identity_documents FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml iddoc write" ON aml.identity_documents FOR ALL TO authenticated
  USING (public.has_aml_role(auth.uid(), 'analyst')
      OR public.has_aml_role(auth.uid(), 'reviewer')
      OR public.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (public.has_aml_role(auth.uid(), 'analyst')
           OR public.has_aml_role(auth.uid(), 'reviewer')
           OR public.has_aml_role(auth.uid(), 'mlro'));

-- ---------- screening_checks ----------
CREATE TABLE IF NOT EXISTS aml.screening_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  subject_label TEXT NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'individual',
  provider TEXT NOT NULL DEFAULT 'simulator',
  provider_reference TEXT,
  scope TEXT[] NOT NULL DEFAULT ARRAY['pep','sanctions','adverse_media']::text[],
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','clear','matched','review','failed','cancelled')),
  requested_by UUID,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  mc_job_id TEXT,
  mc_tokens_committed INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_scr_case ON aml.screening_checks(case_id);
CREATE INDEX IF NOT EXISTS idx_aml_scr_status ON aml.screening_checks(status);

GRANT SELECT, INSERT, UPDATE ON aml.screening_checks TO authenticated;
GRANT ALL ON aml.screening_checks TO service_role;
ALTER TABLE aml.screening_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml scr read"  ON aml.screening_checks FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml scr write" ON aml.screening_checks FOR ALL TO authenticated
  USING (public.has_aml_role(auth.uid(), 'analyst')
      OR public.has_aml_role(auth.uid(), 'reviewer')
      OR public.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (public.has_aml_role(auth.uid(), 'analyst')
           OR public.has_aml_role(auth.uid(), 'reviewer')
           OR public.has_aml_role(auth.uid(), 'mlro'));

-- ---------- screening_matches ----------
CREATE TABLE IF NOT EXISTS aml.screening_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_check_id UUID NOT NULL REFERENCES aml.screening_checks(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL CHECK (match_type IN ('pep','sanctions','adverse_media','watchlist','other')),
  list_name TEXT,
  matched_name TEXT NOT NULL,
  score NUMERIC,
  jurisdiction TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','confirmed','dismissed','escalated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_match_case ON aml.screening_matches(case_id);
CREATE INDEX IF NOT EXISTS idx_aml_match_status ON aml.screening_matches(status);

GRANT SELECT, INSERT, UPDATE ON aml.screening_matches TO authenticated;
GRANT ALL ON aml.screening_matches TO service_role;
ALTER TABLE aml.screening_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml match read"  ON aml.screening_matches FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml match write" ON aml.screening_matches FOR ALL TO authenticated
  USING (public.has_aml_role(auth.uid(), 'analyst')
      OR public.has_aml_role(auth.uid(), 'reviewer')
      OR public.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (public.has_aml_role(auth.uid(), 'analyst')
           OR public.has_aml_role(auth.uid(), 'reviewer')
           OR public.has_aml_role(auth.uid(), 'mlro'));

-- ---------- match_resolutions ----------
CREATE TABLE IF NOT EXISTS aml.match_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES aml.screening_matches(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  disposition TEXT NOT NULL CHECK (disposition IN ('confirmed','dismissed','escalated')),
  rationale TEXT NOT NULL,
  resolved_by UUID,
  resolved_by_label TEXT,
  prev_hash TEXT,
  row_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_res_match ON aml.match_resolutions(match_id);
CREATE INDEX IF NOT EXISTS idx_aml_res_case ON aml.match_resolutions(case_id);

GRANT SELECT, INSERT ON aml.match_resolutions TO authenticated;
GRANT ALL ON aml.match_resolutions TO service_role;
ALTER TABLE aml.match_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml res read"  ON aml.match_resolutions FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml res write" ON aml.match_resolutions FOR INSERT TO authenticated
  WITH CHECK (public.has_aml_role(auth.uid(), 'analyst')
           OR public.has_aml_role(auth.uid(), 'reviewer')
           OR public.has_aml_role(auth.uid(), 'mlro'));

-- ---------- provider_events (signed webhooks) ----------
CREATE TABLE IF NOT EXISTS aml.provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  signature_ok BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  identity_check_id UUID REFERENCES aml.identity_checks(id) ON DELETE SET NULL,
  screening_check_id UUID REFERENCES aml.screening_checks(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_aml_pevt_type ON aml.provider_events(event_type);

GRANT SELECT ON aml.provider_events TO authenticated;
GRANT ALL ON aml.provider_events TO service_role;
ALTER TABLE aml.provider_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml pevt read" ON aml.provider_events FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));

-- ---------- updated_at triggers ----------
CREATE TRIGGER trg_aml_idv_updated  BEFORE UPDATE ON aml.identity_checks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_aml_scr_updated  BEFORE UPDATE ON aml.screening_checks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_aml_match_updated BEFORE UPDATE ON aml.screening_matches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Realtime ----------
ALTER PUBLICATION supabase_realtime ADD TABLE aml.identity_checks;
ALTER PUBLICATION supabase_realtime ADD TABLE aml.screening_checks;
ALTER PUBLICATION supabase_realtime ADD TABLE aml.screening_matches;

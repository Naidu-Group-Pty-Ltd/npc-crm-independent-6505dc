-- =========================================================
-- Solicitor Portal Phase 7 — Matter Intelligence
-- =========================================================

DO $$ BEGIN
  CREATE TYPE public.legal_contract_analysis_status AS ENUM ('draft', 'confirmed', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.legal_contract_analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legal_matter_id UUID NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  firm_id UUID REFERENCES public.solicitor_firms(id) ON DELETE SET NULL,
  document_id UUID REFERENCES public.legal_matter_documents(id) ON DELETE SET NULL,
  source_label TEXT,
  status public.legal_contract_analysis_status NOT NULL DEFAULT 'draft',
  model TEXT,
  summary TEXT,
  parties JSONB NOT NULL DEFAULT '[]'::jsonb,
  key_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  special_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  financials JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC,
  created_by_type TEXT NOT NULL DEFAULT 'solicitor_user',
  created_by_solicitor_user_id UUID REFERENCES public.solicitor_portal_users(id) ON DELETE SET NULL,
  created_by_staff_id UUID,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  confirmed_by_type TEXT,
  confirmed_by_id UUID,
  review_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT ALL ON public.legal_contract_analyses TO service_role;
ALTER TABLE public.legal_contract_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_contract_analyses_service_role_only
  ON public.legal_contract_analyses FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_legal_contract_analyses_matter
  ON public.legal_contract_analyses(legal_matter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_contract_analyses_firm
  ON public.legal_contract_analyses(firm_id, status);

DROP TRIGGER IF EXISTS trg_legal_contract_analyses_updated_at ON public.legal_contract_analyses;
CREATE TRIGGER trg_legal_contract_analyses_updated_at
  BEFORE UPDATE ON public.legal_contract_analyses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------
-- Pipeline board support on legal_matters
-- ---------------------------------------------------------
ALTER TABLE public.legal_matters
  ADD COLUMN IF NOT EXISTS kanban_position INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_legal_matters_pipeline
  ON public.legal_matters(status, kanban_position);

-- Keep stage_entered_at aligned with status transitions.
CREATE OR REPLACE FUNCTION public.legal_matters_touch_stage_entered_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.stage_entered_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_matters_stage_entered_at ON public.legal_matters;
CREATE TRIGGER trg_legal_matters_stage_entered_at
  BEFORE UPDATE ON public.legal_matters
  FOR EACH ROW EXECUTE FUNCTION public.legal_matters_touch_stage_entered_at();
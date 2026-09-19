-- ============================================================
-- Batch 7D.1 — Lender Integrations Schema
-- ============================================================

-- ENUMS
DO $$ BEGIN
  CREATE TYPE public.lender_submission_status AS ENUM (
    'draft','pre_assessment','submitted','conditional_approval',
    'unconditional_approval','loan_docs_issued','settled','declined','withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.lender_doc_status AS ENUM ('required','received','verified','waived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.lender_loan_purpose AS ENUM ('OWNER_OCCUPIED','INVESTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.lender_repayment_type AS ENUM ('PRINCIPAL_AND_INTEREST','INTEREST_ONLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 1) Lender favourites
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lender_favourites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  lender_id TEXT NOT NULL,
  lender_name TEXT NOT NULL,
  notes TEXT,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, lender_id)
);
CREATE INDEX IF NOT EXISTS idx_lender_favourites_user ON public.lender_favourites(user_id);
ALTER TABLE public.lender_favourites ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2) Lender rate alerts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lender_rate_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  lender_id TEXT NOT NULL,
  lender_name TEXT NOT NULL,
  threshold_rate NUMERIC(6,3) NOT NULL,
  loan_purpose public.lender_loan_purpose,
  repayment_type public.lender_repayment_type,
  lvr_max NUMERIC(5,2),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  last_triggered_rate NUMERIC(6,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lender_rate_alerts_user ON public.lender_rate_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_lender_rate_alerts_lender ON public.lender_rate_alerts(lender_id) WHERE is_enabled;
ALTER TABLE public.lender_rate_alerts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3) Lender submissions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lender_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.client_deals(id) ON DELETE SET NULL,
  lender_id TEXT NOT NULL,
  lender_name TEXT NOT NULL,
  product_name TEXT,
  loan_amount NUMERIC(14,2),
  lvr NUMERIC(5,2),
  interest_rate NUMERIC(6,3),
  comparison_rate NUMERIC(6,3),
  loan_purpose public.lender_loan_purpose,
  repayment_type public.lender_repayment_type,
  loan_term_years INT,
  status public.lender_submission_status NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  assessed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  decline_reason TEXT,
  assigned_broker_id UUID,
  external_reference TEXT,
  notes TEXT,
  ghl_pipeline_stage_id TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lender_submissions_client ON public.lender_submissions(client_id);
CREATE INDEX IF NOT EXISTS idx_lender_submissions_deal ON public.lender_submissions(deal_id);
CREATE INDEX IF NOT EXISTS idx_lender_submissions_status ON public.lender_submissions(status);
CREATE INDEX IF NOT EXISTS idx_lender_submissions_broker ON public.lender_submissions(assigned_broker_id);
ALTER TABLE public.lender_submissions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4) Submission documents
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lender_submission_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.lender_submissions(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  doc_name TEXT NOT NULL,
  status public.lender_doc_status NOT NULL DEFAULT 'required',
  storage_path TEXT,
  file_size BIGINT,
  mime_type TEXT,
  uploaded_at TIMESTAMPTZ,
  uploaded_by UUID,
  verified_at TIMESTAMPTZ,
  verified_by UUID,
  notes TEXT,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lender_submission_documents_submission ON public.lender_submission_documents(submission_id);
ALTER TABLE public.lender_submission_documents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5) Submission timeline (audit feed)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lender_submission_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.lender_submissions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_label TEXT NOT NULL,
  actor_id UUID,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lender_submission_timeline_submission ON public.lender_submission_timeline(submission_id, created_at DESC);
ALTER TABLE public.lender_submission_timeline ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6) Comparison sheets
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lender_comparison_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.client_deals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lender_ids TEXT[] NOT NULL DEFAULT '{}',
  rate_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  filters JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  shared_with_client BOOLEAN NOT NULL DEFAULT false,
  pdf_storage_path TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lender_comparison_sheets_client ON public.lender_comparison_sheets(client_id);
CREATE INDEX IF NOT EXISTS idx_lender_comparison_sheets_deal ON public.lender_comparison_sheets(deal_id);
ALTER TABLE public.lender_comparison_sheets ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS — service_role only (per project standard)
-- All access mediated by edge functions via invokeSecureFunction
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'lender_favourites','lender_rate_alerts','lender_submissions',
    'lender_submission_documents','lender_submission_timeline','lender_comparison_sheets'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "service_role_all_%s" ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY "service_role_all_%s" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)$p$, t, t);
  END LOOP;
END $$;

-- ============================================================
-- updated_at triggers
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'lender_favourites','lender_rate_alerts','lender_submissions',
    'lender_submission_documents','lender_comparison_sheets'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

-- ============================================================
-- Status change trigger -> timeline + notification
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_lender_submission_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT;
  v_client_name TEXT;
BEGIN
  -- Only on actual status change (or initial insert)
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    v_label := CASE NEW.status
      WHEN 'draft' THEN 'Submission drafted'
      WHEN 'pre_assessment' THEN 'Pre-assessment with lender'
      WHEN 'submitted' THEN 'Submitted to lender'
      WHEN 'conditional_approval' THEN 'Conditional approval received'
      WHEN 'unconditional_approval' THEN 'Unconditional approval received'
      WHEN 'loan_docs_issued' THEN 'Loan documents issued'
      WHEN 'settled' THEN 'Loan settled'
      WHEN 'declined' THEN 'Submission declined'
      WHEN 'withdrawn' THEN 'Submission withdrawn'
      ELSE NEW.status::text
    END;

    INSERT INTO public.lender_submission_timeline (submission_id, event_type, event_label, actor_id, payload)
    VALUES (
      NEW.id,
      CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'status_change' END,
      v_label,
      COALESCE(NEW.assigned_broker_id, NEW.created_by),
      jsonb_build_object(
        'from', CASE WHEN TG_OP='UPDATE' THEN OLD.status::text ELSE NULL END,
        'to', NEW.status::text,
        'lender_name', NEW.lender_name
      )
    );

    -- Auto-stamp timestamps
    IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN NEW.submitted_at := now(); END IF;
    IF NEW.status IN ('conditional_approval','unconditional_approval') AND NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
    IF NEW.status = 'settled' AND NEW.settled_at IS NULL THEN NEW.settled_at := now(); END IF;

    -- Notification (best-effort; fail-soft)
    BEGIN
      SELECT (primary_first_name || ' ' || primary_surname) INTO v_client_name
      FROM public.clients WHERE id = NEW.client_id;

      INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
      VALUES (
        COALESCE(NEW.assigned_broker_id, NEW.created_by),
        'lender_submission_status',
        format('%s — %s', NEW.lender_name, v_label),
        format('%s submission for %s', NEW.lender_name, COALESCE(v_client_name, 'client')),
        format('/clients/%s?tab=submissions&highlight=%s', NEW.client_id, NEW.id),
        jsonb_build_object('submission_id', NEW.id, 'status', NEW.status::text)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'submission notification skipped: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lender_submission_status_change ON public.lender_submissions;
CREATE TRIGGER trg_lender_submission_status_change
BEFORE INSERT OR UPDATE OF status ON public.lender_submissions
FOR EACH ROW EXECUTE FUNCTION public.fn_lender_submission_status_change();

-- ============================================================
-- Realtime publication
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'lender_favourites','lender_rate_alerts','lender_submissions',
    'lender_submission_documents','lender_submission_timeline','lender_comparison_sheets'
  ]) LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
             WHEN others THEN RAISE NOTICE 'realtime add skipped for %: %', t, SQLERRM;
    END;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;

-- ============================================================
-- Storage bucket for lender submission documents
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('lender-docs', 'lender-docs', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Notifications type allowlist (best-effort: append to check)
-- ============================================================
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass;

  IF v_def IS NOT NULL AND v_def NOT LIKE '%lender_submission_status%' THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
    -- Recreate with appended values; uses existing values + new ones.
    -- We rebuild as a permissive list by extracting current values then unioning.
    EXECUTE format(
      'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[%s, %L, %L]))',
      (
        SELECT string_agg(quote_literal(v), ',')
        FROM (
          SELECT unnest(regexp_matches(v_def, '''([^'']+)''', 'g')) AS v
        ) s
      ),
      'lender_submission_status',
      'lender_rate_alert'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notifications_type_check update skipped: %', SQLERRM;
END $$;
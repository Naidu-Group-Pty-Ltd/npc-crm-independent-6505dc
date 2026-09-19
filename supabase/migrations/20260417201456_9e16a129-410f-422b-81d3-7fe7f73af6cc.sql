-- Phase 5B: Finance Portal Document Vault

-- 1. Documents table
CREATE TABLE IF NOT EXISTS public.finance_portal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  uploaded_by_finance_user_id UUID REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  uploaded_by_internal_user_id UUID REFERENCES public.custom_users(id) ON DELETE SET NULL,
  uploader_type TEXT NOT NULL DEFAULT 'finance_partner' CHECK (uploader_type IN ('finance_partner','internal','client')),
  category TEXT NOT NULL DEFAULT 'other',
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  description TEXT,
  visible_to_client BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fpd_client_id ON public.finance_portal_documents(client_id);
CREATE INDEX IF NOT EXISTS idx_fpd_category ON public.finance_portal_documents(category);
CREATE INDEX IF NOT EXISTS idx_fpd_uploaded_by_finance ON public.finance_portal_documents(uploaded_by_finance_user_id);
CREATE INDEX IF NOT EXISTS idx_fpd_created_at ON public.finance_portal_documents(created_at DESC);

ALTER TABLE public.finance_portal_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on finance_portal_documents" ON public.finance_portal_documents;
CREATE POLICY "Service role full access on finance_portal_documents"
  ON public.finance_portal_documents
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_fpd_updated_at ON public.finance_portal_documents;
CREATE TRIGGER trg_fpd_updated_at
  BEFORE UPDATE ON public.finance_portal_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Private storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('finance-portal-documents', 'finance-portal-documents', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS — service role only (all access via edge function signed URLs)
DROP POLICY IF EXISTS "Service role manages finance portal documents" ON storage.objects;
CREATE POLICY "Service role manages finance portal documents"
  ON storage.objects
  FOR ALL
  USING (bucket_id = 'finance-portal-documents' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'finance-portal-documents' AND auth.role() = 'service_role');
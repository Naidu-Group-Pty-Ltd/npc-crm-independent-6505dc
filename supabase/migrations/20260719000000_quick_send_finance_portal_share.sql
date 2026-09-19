-- Quick Send to Finance is an internal portal hand-off, not a personal email.
-- These fields scope a Command Centre document to one authorised portal user
-- and make retries idempotent without changing existing document behaviour.
ALTER TABLE public.finance_portal_documents
  ADD COLUMN IF NOT EXISTS storage_bucket text NOT NULL DEFAULT 'finance-portal-documents',
  ADD COLUMN IF NOT EXISTS shared_with_finance_user_id uuid REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS share_correlation_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fpd_finance_share_correlation
  ON public.finance_portal_documents (client_id, shared_with_finance_user_id, share_correlation_id)
  WHERE deleted_at IS NULL AND share_correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fpd_finance_share_recipient
  ON public.finance_portal_documents (shared_with_finance_user_id, client_id)
  WHERE deleted_at IS NULL;

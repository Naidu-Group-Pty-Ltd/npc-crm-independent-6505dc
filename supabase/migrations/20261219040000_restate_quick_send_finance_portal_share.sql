-- @effect: select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_portal_documents' and column_name = 'shared_with_finance_user_id'
--
-- Restates `20260719000000_quick_send_finance_portal_share`: the three
-- columns and two indexes that Quick Send to Finance writes and the Finance
-- Portal's document list filters on.
--
-- `finance-portal-documents` filters every document list, preview and
-- download on `shared_with_finance_user_id` and throws when the query fails.
-- `share-report-with-finance` inserts all three columns. Both have done so
-- since PR #2690 (merged 17 Sep 2026), which added this code and
-- `20260719000000` together. On a database without the columns, the Finance
-- Portal's document list and Quick Send both fail.
--
-- `20260921100000` dropped the columns because they were "referenced nowhere
-- in `src/` or `supabase/functions/`". The tree it was committed from says
-- otherwise: its copy of `finance-portal-documents` names
-- `shared_with_finance_user_id` six times, and `share-report-with-finance`
-- names it twice. The prime re-applied `20260719000000` on 22 Sep 2026 (run
-- 35712338709, from `main`), which put the columns back there. The clones
-- then diverged by delivery order, not by any decision (measured 23 Sep
-- 2026): NPC Test and Preflight have the columns again, while
-- `npc-client-dashboard` and the CRM clone do not.
--
-- This brings all five databases to the state the code needs and the prime
-- already runs. It adds two nullable columns, one column with a default, and
-- two partial indexes, and it changes what no existing row means: a NULL
-- `shared_with_finance_user_id` is read as "visible to any authorised
-- assignee", which is how every existing document is already read.
-- Idempotent: every statement is a no-op where the columns already stand.
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

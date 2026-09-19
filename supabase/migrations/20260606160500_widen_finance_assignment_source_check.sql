-- Fix: finance portal "Add client" (and CSV import) failed with a generic
-- "Internal server error" because inserting into finance_portal_client_assignments
-- used auto_link_source values ('finance_portal_created', 'csv_import') that were
-- not permitted by the finance_portal_assignments_source_check CHECK constraint
-- (originally only 'client_field' | 'deal' | 'manual'). Widen the allowed set so
-- these legitimate provenance values pass.
ALTER TABLE public.finance_portal_client_assignments
  DROP CONSTRAINT IF EXISTS finance_portal_assignments_source_check;

ALTER TABLE public.finance_portal_client_assignments
  ADD CONSTRAINT finance_portal_assignments_source_check
  CHECK (
    auto_link_source IS NULL
    OR auto_link_source IN ('client_field', 'deal', 'manual', 'finance_portal_created', 'csv_import')
  );

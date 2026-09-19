ALTER TABLE public.finance_portal_client_assignments DROP CONSTRAINT finance_portal_assignments_source_check;
ALTER TABLE public.finance_portal_client_assignments ADD CONSTRAINT finance_portal_assignments_source_check CHECK (auto_link_source IS NULL OR auto_link_source = ANY (ARRAY['client_field','deal','manual','finance_portal_created','csv_import']));

-- Remove orphaned finance portal assignments and add cascade FK
DELETE FROM public.finance_portal_client_assignments a
WHERE NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = a.client_id);

ALTER TABLE public.finance_portal_client_assignments
  ADD CONSTRAINT finance_portal_client_assignments_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
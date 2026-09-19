ALTER TABLE public.transaction_cases DROP CONSTRAINT transaction_cases_client_id_fkey;
ALTER TABLE public.transaction_cases ADD CONSTRAINT transaction_cases_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

ALTER TABLE public.portal_operational_events DROP CONSTRAINT portal_operational_events_case_id_fkey;
ALTER TABLE public.portal_operational_events ADD CONSTRAINT portal_operational_events_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.transaction_cases(id) ON DELETE CASCADE;
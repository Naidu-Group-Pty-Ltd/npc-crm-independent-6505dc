-- Add missing foreign key from finance_portal_users to finance_agent_contacts.
-- Without this FK, PostgREST embed syntax (used by accept-invite, login, etc.)
-- fails to resolve the relationship, causing valid invite tokens to be rejected.

-- First, clean up any orphaned rows that would block the FK constraint.
DELETE FROM public.finance_portal_users
WHERE finance_contact_id IS NOT NULL
  AND finance_contact_id NOT IN (SELECT id FROM public.finance_agent_contacts);

ALTER TABLE public.finance_portal_users
  ADD CONSTRAINT finance_portal_users_finance_contact_id_fkey
  FOREIGN KEY (finance_contact_id)
  REFERENCES public.finance_agent_contacts(id)
  ON DELETE CASCADE;

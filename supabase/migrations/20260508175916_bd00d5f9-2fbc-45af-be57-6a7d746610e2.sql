-- Clear placeholder emails (real clients that genuinely have no email)
UPDATE public.clients
   SET primary_email = NULL
 WHERE primary_email LIKE 'legacy-%@migrated.placeholder.local';

-- Reset the 7 stragglers still on legacy IDs (their new-account target is held by another client)
UPDATE public.clients c
   SET ghl_contact_id = NULL,
       ghl_sync_status = 'pending'
  FROM public.ghl_id_mapping m
 WHERE m.resource_type = 'contact'
   AND m.old_ghl_id = c.ghl_contact_id
   AND EXISTS (
     SELECT 1 FROM public.clients c2
      WHERE c2.ghl_contact_id = m.new_ghl_id AND c2.id <> c.id
   );
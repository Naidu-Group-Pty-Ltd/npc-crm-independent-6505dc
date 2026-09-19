-- Add unique constraint on ghl_contact_id to prevent duplicates and enable proper upserts
ALTER TABLE public.clients 
ADD CONSTRAINT clients_ghl_contact_id_unique UNIQUE (ghl_contact_id);
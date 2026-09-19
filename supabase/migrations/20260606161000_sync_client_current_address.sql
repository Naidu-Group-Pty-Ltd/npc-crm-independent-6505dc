-- Fix: the Command Center client "Personal" tab reads clients.current_address,
-- but the current residential address is captured in client_address_history (the
-- is_current row) by the address-history UI across all three portals and was
-- never mirrored back to clients.current_address — so the Personal tab showed a
-- blank current address.
--
-- Solution: keep clients.current_address (+ country / living_situation /
-- residential_status) in sync with the primary applicant's current
-- address-history row via a trigger, and backfill existing clients once.

-- 1. Trigger function: when a primary current address row is written, mirror it
--    onto the clients record.
CREATE OR REPLACE FUNCTION public.sync_client_current_address()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_current IS TRUE
     AND NEW.contact_type = 'primary'
     AND NEW.additional_contact_id IS NULL THEN
    UPDATE public.clients
       SET current_address    = COALESCE(NEW.address, current_address),
           country            = COALESCE(NEW.country, country),
           living_situation   = COALESCE(NEW.living_situation, living_situation),
           residential_status = COALESCE(NEW.residential_status, residential_status),
           updated_at         = now()
     WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_client_current_address ON public.client_address_history;
CREATE TRIGGER trg_sync_client_current_address
  AFTER INSERT OR UPDATE OF address, country, living_situation, residential_status,
                            is_current, contact_type, additional_contact_id
  ON public.client_address_history
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_client_current_address();

-- 2. One-time backfill for clients whose current_address is empty but who have a
--    current primary address on record.
UPDATE public.clients c
SET current_address    = COALESCE(NULLIF(c.current_address, ''), ah.address),
    country            = COALESCE(NULLIF(c.country, ''), ah.country),
    living_situation   = COALESCE(NULLIF(c.living_situation, ''), ah.living_situation),
    residential_status = COALESCE(NULLIF(c.residential_status, ''), ah.residential_status),
    updated_at         = now()
FROM (
  SELECT DISTINCT ON (client_id)
         client_id, address, country, living_situation, residential_status
  FROM public.client_address_history
  WHERE is_current IS TRUE
    AND contact_type = 'primary'
    AND additional_contact_id IS NULL
  ORDER BY client_id, start_date DESC NULLS LAST, created_at DESC
) ah
WHERE c.id = ah.client_id
  AND (c.current_address IS NULL OR c.current_address = '');

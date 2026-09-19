
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS current_suburb text,
  ADD COLUMN IF NOT EXISTS current_state text,
  ADD COLUMN IF NOT EXISTS current_postcode text,
  ADD COLUMN IF NOT EXISTS secondary_current_suburb text,
  ADD COLUMN IF NOT EXISTS secondary_current_state text,
  ADD COLUMN IF NOT EXISTS secondary_current_postcode text;

CREATE OR REPLACE FUNCTION public.propagate_client_address_to_purchase_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
BEGIN
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.property_address,'') <> ''
     AND COALESCE(NEW.property_suburb,'') <> ''
     AND COALESCE(NEW.property_state,'') <> ''
     AND COALESCE(NEW.property_postcode,'') <> '' THEN
    RETURN NEW;
  END IF;

  SELECT current_address, current_suburb, current_state, current_postcode
    INTO c
    FROM public.clients
    WHERE id = NEW.client_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.property_address,'') = '' AND c.current_address IS NOT NULL THEN
    NEW.property_address := c.current_address;
  END IF;
  IF COALESCE(NEW.property_suburb,'') = '' AND c.current_suburb IS NOT NULL THEN
    NEW.property_suburb := c.current_suburb;
  END IF;
  IF COALESCE(NEW.property_state,'') = '' AND c.current_state IS NOT NULL THEN
    NEW.property_state := c.current_state;
  END IF;
  IF COALESCE(NEW.property_postcode,'') = '' AND c.current_postcode IS NOT NULL THEN
    NEW.property_postcode := c.current_postcode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_client_address ON public.purchase_files;
CREATE TRIGGER trg_propagate_client_address
BEFORE INSERT ON public.purchase_files
FOR EACH ROW EXECUTE FUNCTION public.propagate_client_address_to_purchase_file();

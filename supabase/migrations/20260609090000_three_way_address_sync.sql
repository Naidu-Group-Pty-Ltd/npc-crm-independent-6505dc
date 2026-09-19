-- Three-way current address sync across Command Centre, Finance Portal and Client Portal.
-- Source of truth remains client_address_history for history, while clients.* stores
-- the current primary address snapshot used by Command Centre and pipeline views.

ALTER TABLE public.client_address_history
  ADD COLUMN IF NOT EXISTS current_suburb text,
  ADD COLUMN IF NOT EXISTS current_state text,
  ADD COLUMN IF NOT EXISTS current_postcode text;

ALTER TABLE public.client_additional_contacts
  ADD COLUMN IF NOT EXISTS current_suburb text,
  ADD COLUMN IF NOT EXISTS current_state text,
  ADD COLUMN IF NOT EXISTS current_postcode text;

CREATE INDEX IF NOT EXISTS idx_client_address_history_current_primary
  ON public.client_address_history (client_id, is_current, contact_type, start_date DESC, created_at DESC)
  WHERE contact_type = 'primary' AND additional_contact_id IS NULL;

CREATE OR REPLACE FUNCTION public.address_values_match(
  a_address text,
  a_suburb text,
  a_state text,
  a_postcode text,
  a_country text,
  b_address text,
  b_suburb text,
  b_state text,
  b_postcode text,
  b_country text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(a_address, ''))) = lower(trim(coalesce(b_address, '')))
     AND lower(trim(coalesce(a_suburb, ''))) = lower(trim(coalesce(b_suburb, '')))
     AND upper(trim(coalesce(a_state, ''))) = upper(trim(coalesce(b_state, '')))
     AND trim(coalesce(a_postcode, '')) = trim(coalesce(b_postcode, ''))
     AND lower(trim(coalesce(a_country, 'Australia'))) = lower(trim(coalesce(b_country, 'Australia')));
$$;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_current_primary_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_current IS TRUE THEN
    IF NEW.contact_type = 'primary' AND NEW.additional_contact_id IS NULL THEN
      UPDATE public.client_address_history
         SET is_current = false,
             end_date = COALESCE(end_date, COALESCE((NEW.start_date - INTERVAL '1 day')::date, CURRENT_DATE)),
             updated_at = now()
       WHERE client_id = NEW.client_id
         AND contact_type = 'primary'
         AND additional_contact_id IS NULL
         AND id <> NEW.id
         AND is_current IS TRUE;
    ELSIF NEW.contact_type = 'secondary' AND NEW.additional_contact_id IS NULL THEN
      UPDATE public.client_address_history
         SET is_current = false,
             end_date = COALESCE(end_date, COALESCE((NEW.start_date - INTERVAL '1 day')::date, CURRENT_DATE)),
             updated_at = now()
       WHERE client_id = NEW.client_id
         AND contact_type = 'secondary'
         AND additional_contact_id IS NULL
         AND id <> NEW.id
         AND is_current IS TRUE;
    ELSIF NEW.additional_contact_id IS NOT NULL THEN
      UPDATE public.client_address_history
         SET is_current = false,
             end_date = COALESCE(end_date, COALESCE((NEW.start_date - INTERVAL '1 day')::date, CURRENT_DATE)),
             updated_at = now()
       WHERE client_id = NEW.client_id
         AND additional_contact_id = NEW.additional_contact_id
         AND id <> NEW.id
         AND is_current IS TRUE;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_current_primary_address ON public.client_address_history;
CREATE TRIGGER trg_prevent_duplicate_current_primary_address
  BEFORE INSERT OR UPDATE OF is_current, contact_type, additional_contact_id, start_date
  ON public.client_address_history
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_current_primary_address();

CREATE OR REPLACE FUNCTION public.sync_client_current_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  latest RECORD;
BEGIN
  SELECT * INTO latest
  FROM public.client_address_history
  WHERE client_id = COALESCE(NEW.client_id, OLD.client_id)
    AND is_current IS TRUE
    AND contact_type = 'primary'
    AND additional_contact_id IS NULL
  ORDER BY start_date DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.clients
       SET current_address    = NULLIF(latest.address, ''),
           current_suburb     = NULLIF(latest.current_suburb, ''),
           current_state      = NULLIF(upper(latest.current_state), ''),
           current_postcode   = NULLIF(latest.current_postcode, ''),
           country            = COALESCE(NULLIF(latest.country, ''), country, 'Australia'),
           living_situation   = NULLIF(latest.living_situation, ''),
           residential_status = NULLIF(latest.residential_status, ''),
           updated_at         = now()
     WHERE id = latest.client_id;
  ELSE
    UPDATE public.clients
       SET current_address = NULL,
           current_suburb = NULL,
           current_state = NULL,
           current_postcode = NULL,
           updated_at = now()
     WHERE id = COALESCE(NEW.client_id, OLD.client_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_client_current_address ON public.client_address_history;
CREATE TRIGGER trg_sync_client_current_address
  AFTER INSERT OR UPDATE OF address, current_suburb, current_state, current_postcode, country,
                            living_situation, residential_status, is_current, contact_type,
                            additional_contact_id, start_date
  ON public.client_address_history
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_client_current_address();

DROP TRIGGER IF EXISTS trg_sync_client_current_address_delete ON public.client_address_history;
CREATE TRIGGER trg_sync_client_current_address_delete
  AFTER DELETE ON public.client_address_history
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_client_current_address();

CREATE OR REPLACE FUNCTION public.sync_clients_primary_address_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_current RECORD;
  new_address text;
  new_suburb text;
  new_state text;
  new_postcode text;
  new_country text;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  new_address := NULLIF(trim(coalesce(NEW.current_address, '')), '');
  new_suburb := NULLIF(trim(coalesce(NEW.current_suburb, '')), '');
  new_state := NULLIF(upper(trim(coalesce(NEW.current_state, ''))), '');
  new_postcode := NULLIF(trim(coalesce(NEW.current_postcode, '')), '');
  new_country := COALESCE(NULLIF(trim(coalesce(NEW.country, '')), ''), 'Australia');

  IF new_address IS NULL
     AND new_suburb IS NULL
     AND new_state IS NULL
     AND new_postcode IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO existing_current
  FROM public.client_address_history
  WHERE client_id = NEW.id
    AND is_current IS TRUE
    AND contact_type = 'primary'
    AND additional_contact_id IS NULL
  ORDER BY start_date DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND AND public.address_values_match(
    existing_current.address, existing_current.current_suburb, existing_current.current_state, existing_current.current_postcode, existing_current.country,
    new_address, new_suburb, new_state, new_postcode, new_country
  ) THEN
    UPDATE public.client_address_history
       SET country = new_country,
           living_situation = NULLIF(NEW.living_situation, ''),
           residential_status = NULLIF(NEW.residential_status, ''),
           updated_at = now()
     WHERE id = existing_current.id;
    RETURN NEW;
  END IF;

  UPDATE public.client_address_history
     SET is_current = false,
         end_date = COALESCE(end_date, CURRENT_DATE),
         updated_at = now()
   WHERE client_id = NEW.id
     AND contact_type = 'primary'
     AND additional_contact_id IS NULL
     AND is_current IS TRUE;

  INSERT INTO public.client_address_history (
    client_id, contact_type, address, current_suburb, current_state, current_postcode,
    country, living_situation, residential_status, start_date, end_date, is_current,
    notes
  ) VALUES (
    NEW.id, 'primary', new_address, new_suburb, new_state, new_postcode,
    new_country, NULLIF(NEW.living_situation, ''), NULLIF(NEW.residential_status, ''),
    CURRENT_DATE, NULL, true, 'Synced from Command Centre primary address'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_clients_primary_address_history ON public.clients;
CREATE TRIGGER trg_sync_clients_primary_address_history
  AFTER INSERT OR UPDATE OF current_address, current_suburb, current_state, current_postcode,
                            country, living_situation, residential_status
  ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_clients_primary_address_history();

-- Backfill address-history structured fields from current client snapshot where
-- those structured fields were captured only on clients.
UPDATE public.client_address_history ah
SET current_suburb = COALESCE(NULLIF(ah.current_suburb, ''), NULLIF(c.current_suburb, '')),
    current_state = COALESCE(NULLIF(ah.current_state, ''), NULLIF(c.current_state, '')),
    current_postcode = COALESCE(NULLIF(ah.current_postcode, ''), NULLIF(c.current_postcode, '')),
    updated_at = now()
FROM public.clients c
WHERE ah.client_id = c.id
  AND ah.is_current IS TRUE
  AND ah.contact_type = 'primary'
  AND ah.additional_contact_id IS NULL;

-- Re-sync current client snapshots from history after the structured backfill.
UPDATE public.clients c
SET current_address    = ah.address,
    current_suburb     = ah.current_suburb,
    current_state      = ah.current_state,
    current_postcode   = ah.current_postcode,
    country            = COALESCE(ah.country, c.country, 'Australia'),
    living_situation   = ah.living_situation,
    residential_status = ah.residential_status,
    updated_at         = now()
FROM (
  SELECT DISTINCT ON (client_id)
         client_id, address, current_suburb, current_state, current_postcode,
         country, living_situation, residential_status
  FROM public.client_address_history
  WHERE is_current IS TRUE
    AND contact_type = 'primary'
    AND additional_contact_id IS NULL
  ORDER BY client_id, start_date DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
) ah
WHERE c.id = ah.client_id;

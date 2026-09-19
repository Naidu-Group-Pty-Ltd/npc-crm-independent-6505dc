
-- Function to extract email address from a string like "Name <email@example.com>" or plain "email@example.com"
CREATE OR REPLACE FUNCTION public.extract_email_address(raw_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  extracted text;
BEGIN
  IF raw_text IS NULL OR raw_text = '' THEN
    RETURN NULL;
  END IF;
  -- Try to extract email from angle brackets: "Name <email@example.com>"
  extracted := substring(raw_text from '<([^>]+)>');
  IF extracted IS NOT NULL THEN
    RETURN lower(trim(extracted));
  END IF;
  -- Otherwise treat the whole string as an email
  RETURN lower(trim(raw_text));
END;
$$;

-- Trigger function to auto-link emails to clients based on email address matching
CREATE OR REPLACE FUNCTION public.auto_link_email_to_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matched_client_id uuid;
  all_addresses text[];
  addr text;
  extracted text;
BEGIN
  -- Don't overwrite manually assigned client_id
  IF NEW.client_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Collect all email addresses from sender, to, cc, bcc
  all_addresses := ARRAY[]::text[];

  -- Extract sender email
  IF NEW.sender IS NOT NULL AND NEW.sender != '' THEN
    extracted := public.extract_email_address(NEW.sender);
    IF extracted IS NOT NULL THEN
      all_addresses := array_append(all_addresses, extracted);
    END IF;
  END IF;

  -- Extract to_recipients emails
  IF NEW.to_recipients IS NOT NULL THEN
    FOREACH addr IN ARRAY NEW.to_recipients LOOP
      extracted := public.extract_email_address(addr);
      IF extracted IS NOT NULL THEN
        all_addresses := array_append(all_addresses, extracted);
      END IF;
    END LOOP;
  END IF;

  -- Extract cc_recipients emails
  IF NEW.cc_recipients IS NOT NULL THEN
    FOREACH addr IN ARRAY NEW.cc_recipients LOOP
      extracted := public.extract_email_address(addr);
      IF extracted IS NOT NULL THEN
        all_addresses := array_append(all_addresses, extracted);
      END IF;
    END LOOP;
  END IF;

  -- Extract bcc_recipients emails
  IF NEW.bcc_recipients IS NOT NULL THEN
    FOREACH addr IN ARRAY NEW.bcc_recipients LOOP
      extracted := public.extract_email_address(addr);
      IF extracted IS NOT NULL THEN
        all_addresses := array_append(all_addresses, extracted);
      END IF;
    END LOOP;
  END IF;

  -- Match against clients table (primary_email or secondary_email)
  -- Prioritise sender match first, then any other field
  -- First try sender only
  IF NEW.sender IS NOT NULL THEN
    extracted := public.extract_email_address(NEW.sender);
    IF extracted IS NOT NULL THEN
      SELECT id INTO matched_client_id
      FROM public.clients
      WHERE lower(primary_email) = extracted
         OR lower(secondary_email) = extracted
      LIMIT 1;
    END IF;
  END IF;

  -- If no sender match, try all other addresses
  IF matched_client_id IS NULL AND array_length(all_addresses, 1) > 0 THEN
    SELECT id INTO matched_client_id
    FROM public.clients
    WHERE lower(primary_email) = ANY(all_addresses)
       OR lower(secondary_email) = ANY(all_addresses)
    LIMIT 1;
  END IF;

  -- Assign if found
  IF matched_client_id IS NOT NULL THEN
    NEW.client_id := matched_client_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger (fires BEFORE INSERT so we can modify NEW)
DROP TRIGGER IF EXISTS trg_auto_link_email_to_client ON public.email_copilot_emails;
CREATE TRIGGER trg_auto_link_email_to_client
  BEFORE INSERT ON public.email_copilot_emails
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_email_to_client();

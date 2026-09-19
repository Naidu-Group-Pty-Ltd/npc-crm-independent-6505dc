
-- Update the auto_link_email_to_client trigger to propagate client_id from conversation threads
CREATE OR REPLACE FUNCTION public.auto_link_email_to_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- PASS 1: Direct email address matching against clients table
  -- Prioritise sender match first
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

  -- PASS 2: Conversation-level propagation
  -- If no direct match found, inherit client_id from another email in the same conversation thread
  IF matched_client_id IS NULL AND NEW.conversation_id IS NOT NULL AND NEW.conversation_id != '' THEN
    SELECT client_id INTO matched_client_id
    FROM public.email_copilot_emails
    WHERE conversation_id = NEW.conversation_id
      AND client_id IS NOT NULL
    ORDER BY received_at DESC
    LIMIT 1;
  END IF;

  -- Assign if found
  IF matched_client_id IS NOT NULL THEN
    NEW.client_id := matched_client_id;
  END IF;

  RETURN NEW;
END;
$function$;

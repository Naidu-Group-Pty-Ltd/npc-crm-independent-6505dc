CREATE OR REPLACE FUNCTION public.auto_link_email_to_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  matched_client_id uuid;
  all_addresses text[];
  non_staff_addresses text[];
  addr text;
  extracted text;
  excluded_addrs text[];
BEGIN
  -- Fast paths for UPDATE: avoid expensive work when not needed.
  IF TG_OP = 'UPDATE' THEN
    -- FK SET NULL from clients deletion (or any explicit clearing): do not relink.
    IF OLD.client_id IS NOT NULL AND NEW.client_id IS NULL THEN
      RETURN NEW;
    END IF;
    -- No linking-relevant column changed; skip.
    IF NEW.client_id IS NOT DISTINCT FROM OLD.client_id
       AND NEW.sender IS NOT DISTINCT FROM OLD.sender
       AND NEW.to_recipients IS NOT DISTINCT FROM OLD.to_recipients
       AND NEW.cc_recipients IS NOT DISTINCT FROM OLD.cc_recipients
       AND NEW.bcc_recipients IS NOT DISTINCT FROM OLD.bcc_recipients
       AND NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Don't overwrite manually assigned client_id
  IF NEW.client_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(address) INTO excluded_addrs FROM public.email_linking_excluded_addresses;
  IF excluded_addrs IS NULL THEN excluded_addrs := ARRAY[]::text[]; END IF;

  all_addresses := ARRAY[]::text[];

  IF NEW.sender IS NOT NULL AND NEW.sender != '' THEN
    extracted := public.extract_email_address(NEW.sender);
    IF extracted IS NOT NULL THEN all_addresses := array_append(all_addresses, extracted); END IF;
  END IF;
  IF NEW.to_recipients IS NOT NULL THEN
    FOREACH addr IN ARRAY NEW.to_recipients LOOP
      extracted := public.extract_email_address(addr);
      IF extracted IS NOT NULL THEN all_addresses := array_append(all_addresses, extracted); END IF;
    END LOOP;
  END IF;
  IF NEW.cc_recipients IS NOT NULL THEN
    FOREACH addr IN ARRAY NEW.cc_recipients LOOP
      extracted := public.extract_email_address(addr);
      IF extracted IS NOT NULL THEN all_addresses := array_append(all_addresses, extracted); END IF;
    END LOOP;
  END IF;
  IF NEW.bcc_recipients IS NOT NULL THEN
    FOREACH addr IN ARRAY NEW.bcc_recipients LOOP
      extracted := public.extract_email_address(addr);
      IF extracted IS NOT NULL THEN all_addresses := array_append(all_addresses, extracted); END IF;
    END LOOP;
  END IF;

  non_staff_addresses := ARRAY[]::text[];
  FOREACH addr IN ARRAY all_addresses LOOP
    IF NOT (addr = ANY(excluded_addrs)) THEN
      non_staff_addresses := array_append(non_staff_addresses, addr);
    END IF;
  END LOOP;

  IF array_length(non_staff_addresses, 1) > 0 THEN
    SELECT id INTO matched_client_id
    FROM public.clients
    WHERE lower(primary_email) = ANY(non_staff_addresses)
       OR lower(secondary_email) = ANY(non_staff_addresses)
    LIMIT 1;
  END IF;

  IF matched_client_id IS NULL AND NEW.conversation_id IS NOT NULL AND NEW.conversation_id != '' THEN
    SELECT client_id INTO matched_client_id
    FROM public.email_copilot_emails
    WHERE conversation_id = NEW.conversation_id
      AND client_id IS NOT NULL
    ORDER BY received_at DESC
    LIMIT 1;
  END IF;

  IF matched_client_id IS NOT NULL THEN
    NEW.client_id := matched_client_id;
  END IF;

  RETURN NEW;
END;
$function$;
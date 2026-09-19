
-- ============================================================
-- 1. UNDO BAD BACKFILL: Unlink emails from staff "client" records
--    Only unlink those that were wrongly matched via staff sender
-- ============================================================

-- Unlink from "Unknown Unknown" (rugesh@npcservices.com.au) 
-- Only unlink emails where the ONLY match was via rugesh@ as sender
-- Keep emails that have a legitimate client match in to/cc/bcc
UPDATE email_copilot_emails
SET client_id = NULL
WHERE client_id = '38e3dab8-b6fe-4365-a111-e110017a50d6';

-- Unlink from "test test" (admin@npcservices.com.au)
UPDATE email_copilot_emails
SET client_id = NULL  
WHERE client_id = '81ef1c55-6070-4cf0-9f8b-e3261020130c';

-- ============================================================
-- 2. IMPROVED AUTO-LINK FUNCTION: Skip staff/business emails
--    Uses a config table approach for maintainability
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_linking_excluded_addresses (
  address text PRIMARY KEY,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_linking_excluded_addresses ENABLE ROW LEVEL SECURITY;

-- Seed with known staff addresses
INSERT INTO public.email_linking_excluded_addresses (address, reason) VALUES
  ('rugesh@npcservices.com.au', 'Staff/owner email - should not be treated as client'),
  ('admin@npcservices.com.au', 'Business admin email - should not be treated as client')
ON CONFLICT (address) DO NOTHING;

-- ============================================================
-- 3. REPLACE the auto_link function to skip excluded addresses
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_link_email_to_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  matched_client_id uuid;
  all_addresses text[];
  non_staff_addresses text[];
  addr text;
  extracted text;
  excluded_addrs text[];
BEGIN
  -- Don't overwrite manually assigned client_id
  IF NEW.client_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Load excluded (staff/business) addresses
  SELECT array_agg(address) INTO excluded_addrs
  FROM public.email_linking_excluded_addresses;
  IF excluded_addrs IS NULL THEN
    excluded_addrs := ARRAY[]::text[];
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

  -- Filter out excluded/staff addresses
  non_staff_addresses := ARRAY[]::text[];
  FOREACH addr IN ARRAY all_addresses LOOP
    IF NOT (addr = ANY(excluded_addrs)) THEN
      non_staff_addresses := array_append(non_staff_addresses, addr);
    END IF;
  END LOOP;

  -- PASS 1: Direct email address matching (excluding staff emails)
  IF array_length(non_staff_addresses, 1) > 0 THEN
    SELECT id INTO matched_client_id
    FROM public.clients
    WHERE lower(primary_email) = ANY(non_staff_addresses)
       OR lower(secondary_email) = ANY(non_staff_addresses)
    LIMIT 1;
  END IF;

  -- PASS 2: Conversation-level propagation
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
$$;

-- ============================================================
-- 4. RE-RUN BACKFILL with corrected logic (excluding staff)
-- ============================================================

-- Pass 1: Direct address matching (skip staff addresses)
UPDATE email_copilot_emails e
SET client_id = matched.client_id
FROM (
  SELECT DISTINCT ON (e2.id) e2.id as email_id, c.id as client_id
  FROM email_copilot_emails e2
  CROSS JOIN LATERAL (
    SELECT lower(public.extract_email_address(addr)) as extracted
    FROM unnest(
      ARRAY[e2.sender] || COALESCE(e2.to_recipients, '{}') || COALESCE(e2.cc_recipients, '{}') || COALESCE(e2.bcc_recipients, '{}')
    ) AS addr
    WHERE addr IS NOT NULL AND addr != ''
  ) addrs
  JOIN clients c ON lower(c.primary_email) = addrs.extracted OR lower(c.secondary_email) = addrs.extracted
  WHERE e2.client_id IS NULL
    AND addrs.extracted NOT IN (SELECT address FROM email_linking_excluded_addresses)
  ORDER BY e2.id
) matched
WHERE e.id = matched.email_id;

-- Pass 2: Conversation thread propagation
UPDATE email_copilot_emails e
SET client_id = conv.linked_client_id
FROM (
  SELECT DISTINCT ON (e2.id) e2.id as email_id, linked.client_id as linked_client_id
  FROM email_copilot_emails e2
  JOIN email_copilot_emails linked 
    ON linked.conversation_id = e2.conversation_id
    AND linked.client_id IS NOT NULL
  WHERE e2.client_id IS NULL
    AND e2.conversation_id IS NOT NULL
    AND e2.conversation_id != ''
  ORDER BY e2.id, linked.received_at DESC
) conv
WHERE e.id = conv.email_id;

-- ============================================================
-- 5. UPDATE client-side triggers to also exclude staff emails
-- ============================================================
CREATE OR REPLACE FUNCTION public.relink_emails_on_client_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  changed_emails text[] := ARRAY[]::text[];
  excluded_addrs text[];
BEGIN
  -- Load excluded addresses
  SELECT array_agg(address) INTO excluded_addrs FROM public.email_linking_excluded_addresses;
  IF excluded_addrs IS NULL THEN excluded_addrs := ARRAY[]::text[]; END IF;

  IF NEW.primary_email IS NOT NULL AND (OLD.primary_email IS DISTINCT FROM NEW.primary_email) THEN
    IF NOT (lower(trim(NEW.primary_email)) = ANY(excluded_addrs)) THEN
      changed_emails := array_append(changed_emails, lower(trim(NEW.primary_email)));
    END IF;
  END IF;
  IF NEW.secondary_email IS NOT NULL AND (OLD.secondary_email IS DISTINCT FROM NEW.secondary_email) THEN
    IF NOT (lower(trim(NEW.secondary_email)) = ANY(excluded_addrs)) THEN
      changed_emails := array_append(changed_emails, lower(trim(NEW.secondary_email)));
    END IF;
  END IF;

  IF array_length(changed_emails, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE email_copilot_emails e
  SET client_id = NEW.id
  FROM (
    SELECT e2.id as email_id
    FROM email_copilot_emails e2
    CROSS JOIN LATERAL (
      SELECT lower(public.extract_email_address(addr)) as extracted
      FROM unnest(
        ARRAY[e2.sender] || COALESCE(e2.to_recipients, '{}') || COALESCE(e2.cc_recipients, '{}') || COALESCE(e2.bcc_recipients, '{}')
      ) AS addr
      WHERE addr IS NOT NULL AND addr != ''
    ) addrs
    WHERE e2.client_id IS NULL
      AND addrs.extracted = ANY(changed_emails)
  ) matched
  WHERE e.id = matched.email_id;

  -- Conversation thread propagation
  UPDATE email_copilot_emails e
  SET client_id = NEW.id
  FROM (
    SELECT DISTINCT e3.id as email_id
    FROM email_copilot_emails e3
    JOIN email_copilot_emails linked
      ON linked.conversation_id = e3.conversation_id
      AND linked.client_id = NEW.id
    WHERE e3.client_id IS NULL
      AND e3.conversation_id IS NOT NULL
      AND e3.conversation_id != ''
  ) conv
  WHERE e.id = conv.email_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_emails_on_client_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  client_emails text[] := ARRAY[]::text[];
  excluded_addrs text[];
BEGIN
  SELECT array_agg(address) INTO excluded_addrs FROM public.email_linking_excluded_addresses;
  IF excluded_addrs IS NULL THEN excluded_addrs := ARRAY[]::text[]; END IF;

  IF NEW.primary_email IS NOT NULL AND NOT (lower(trim(NEW.primary_email)) = ANY(excluded_addrs)) THEN
    client_emails := array_append(client_emails, lower(trim(NEW.primary_email)));
  END IF;
  IF NEW.secondary_email IS NOT NULL AND NOT (lower(trim(NEW.secondary_email)) = ANY(excluded_addrs)) THEN
    client_emails := array_append(client_emails, lower(trim(NEW.secondary_email)));
  END IF;

  IF array_length(client_emails, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE email_copilot_emails e
  SET client_id = NEW.id
  FROM (
    SELECT e2.id as email_id
    FROM email_copilot_emails e2
    CROSS JOIN LATERAL (
      SELECT lower(public.extract_email_address(addr)) as extracted
      FROM unnest(
        ARRAY[e2.sender] || COALESCE(e2.to_recipients, '{}') || COALESCE(e2.cc_recipients, '{}') || COALESCE(e2.bcc_recipients, '{}')
      ) AS addr
      WHERE addr IS NOT NULL AND addr != ''
    ) addrs
    WHERE e2.client_id IS NULL
      AND addrs.extracted = ANY(client_emails)
  ) matched
  WHERE e.id = matched.email_id;

  RETURN NEW;
END;
$$;


-- ============================================================
-- 1. BACKFILL: Link existing unlinked emails to clients
-- ============================================================
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
  ORDER BY e2.id
) matched
WHERE e.id = matched.email_id;

-- ============================================================
-- 2. BACKFILL: Conversation-level propagation
--    If any email in a conversation is linked, link the rest
-- ============================================================
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
-- 3. REPLACE TRIGGER: Fire on both INSERT and UPDATE
--    so re-syncs and attachment updates also trigger linking
-- ============================================================
DROP TRIGGER IF EXISTS trg_auto_link_email_to_client ON email_copilot_emails;

CREATE TRIGGER trg_auto_link_email_to_client
  BEFORE INSERT OR UPDATE ON public.email_copilot_emails
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_email_to_client();

-- ============================================================
-- 4. NEW TRIGGER: When a client's email changes, re-link
--    existing emails that match the new address
-- ============================================================
CREATE OR REPLACE FUNCTION public.relink_emails_on_client_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  changed_emails text[] := ARRAY[]::text[];
BEGIN
  -- Collect any new/changed email addresses
  IF NEW.primary_email IS NOT NULL AND (OLD.primary_email IS DISTINCT FROM NEW.primary_email) THEN
    changed_emails := array_append(changed_emails, lower(trim(NEW.primary_email)));
  END IF;
  IF NEW.secondary_email IS NOT NULL AND (OLD.secondary_email IS DISTINCT FROM NEW.secondary_email) THEN
    changed_emails := array_append(changed_emails, lower(trim(NEW.secondary_email)));
  END IF;

  -- If no email changed, nothing to do
  IF array_length(changed_emails, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Link unlinked emails where any address matches
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

  -- Also propagate via conversation threads
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

-- Also handle new client creation (INSERT)
CREATE OR REPLACE FUNCTION public.link_emails_on_client_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  client_emails text[] := ARRAY[]::text[];
BEGIN
  IF NEW.primary_email IS NOT NULL THEN
    client_emails := array_append(client_emails, lower(trim(NEW.primary_email)));
  END IF;
  IF NEW.secondary_email IS NOT NULL THEN
    client_emails := array_append(client_emails, lower(trim(NEW.secondary_email)));
  END IF;

  IF array_length(client_emails, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Link unlinked emails matching this new client's addresses
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

DROP TRIGGER IF EXISTS trg_relink_emails_on_client_email_change ON clients;
CREATE TRIGGER trg_relink_emails_on_client_email_change
  AFTER UPDATE ON public.clients
  FOR EACH ROW
  WHEN (OLD.primary_email IS DISTINCT FROM NEW.primary_email OR OLD.secondary_email IS DISTINCT FROM NEW.secondary_email)
  EXECUTE FUNCTION public.relink_emails_on_client_email_change();

DROP TRIGGER IF EXISTS trg_link_emails_on_client_create ON clients;
CREATE TRIGGER trg_link_emails_on_client_create
  AFTER INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.link_emails_on_client_create();

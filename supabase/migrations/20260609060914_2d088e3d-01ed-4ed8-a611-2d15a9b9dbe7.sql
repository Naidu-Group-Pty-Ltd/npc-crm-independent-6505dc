CREATE TABLE IF NOT EXISTS public.email_copilot_email_addresses (
  email_id uuid NOT NULL REFERENCES public.email_copilot_emails(id) ON DELETE CASCADE,
  address text NOT NULL,
  address_kind text NOT NULL DEFAULT 'participant',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email_id, address, address_kind)
);

GRANT ALL ON public.email_copilot_email_addresses TO service_role;

ALTER TABLE public.email_copilot_email_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage email participant addresses"
ON public.email_copilot_email_addresses
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_email_copilot_email_addresses_address
ON public.email_copilot_email_addresses (address);

CREATE INDEX IF NOT EXISTS idx_email_copilot_email_addresses_email_id
ON public.email_copilot_email_addresses (email_id);

CREATE INDEX IF NOT EXISTS idx_email_copilot_emails_client_conversation
ON public.email_copilot_emails (client_id, conversation_id)
WHERE conversation_id IS NOT NULL AND conversation_id <> '';

CREATE OR REPLACE FUNCTION public.refresh_email_copilot_email_addresses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.email_copilot_email_addresses
  WHERE email_id = NEW.id;

  INSERT INTO public.email_copilot_email_addresses (email_id, address, address_kind)
  SELECT DISTINCT NEW.id, normalized.address, normalized.address_kind
  FROM (
    SELECT public.extract_email_address(NEW.sender) AS address, 'sender'::text AS address_kind
    WHERE NEW.sender IS NOT NULL AND NEW.sender <> ''

    UNION ALL

    SELECT public.extract_email_address(addr), 'to'::text
    FROM unnest(COALESCE(NEW.to_recipients, ARRAY[]::text[])) AS addr
    WHERE addr IS NOT NULL AND addr <> ''

    UNION ALL

    SELECT public.extract_email_address(addr), 'cc'::text
    FROM unnest(COALESCE(NEW.cc_recipients, ARRAY[]::text[])) AS addr
    WHERE addr IS NOT NULL AND addr <> ''

    UNION ALL

    SELECT public.extract_email_address(addr), 'bcc'::text
    FROM unnest(COALESCE(NEW.bcc_recipients, ARRAY[]::text[])) AS addr
    WHERE addr IS NOT NULL AND addr <> ''
  ) normalized
  WHERE normalized.address IS NOT NULL AND normalized.address <> '';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_email_copilot_email_addresses ON public.email_copilot_emails;
CREATE TRIGGER trg_refresh_email_copilot_email_addresses
AFTER INSERT OR UPDATE OF sender, to_recipients, cc_recipients, bcc_recipients
ON public.email_copilot_emails
FOR EACH ROW
EXECUTE FUNCTION public.refresh_email_copilot_email_addresses();

INSERT INTO public.email_copilot_email_addresses (email_id, address, address_kind)
SELECT DISTINCT email_id, address, address_kind
FROM (
  SELECT e.id AS email_id, public.extract_email_address(e.sender) AS address, 'sender'::text AS address_kind
  FROM public.email_copilot_emails e
  WHERE e.sender IS NOT NULL AND e.sender <> ''

  UNION ALL

  SELECT e.id, public.extract_email_address(addr), 'to'::text
  FROM public.email_copilot_emails e
  CROSS JOIN LATERAL unnest(COALESCE(e.to_recipients, ARRAY[]::text[])) AS addr
  WHERE addr IS NOT NULL AND addr <> ''

  UNION ALL

  SELECT e.id, public.extract_email_address(addr), 'cc'::text
  FROM public.email_copilot_emails e
  CROSS JOIN LATERAL unnest(COALESCE(e.cc_recipients, ARRAY[]::text[])) AS addr
  WHERE addr IS NOT NULL AND addr <> ''

  UNION ALL

  SELECT e.id, public.extract_email_address(addr), 'bcc'::text
  FROM public.email_copilot_emails e
  CROSS JOIN LATERAL unnest(COALESCE(e.bcc_recipients, ARRAY[]::text[])) AS addr
  WHERE addr IS NOT NULL AND addr <> ''
) extracted
WHERE address IS NOT NULL AND address <> ''
ON CONFLICT DO NOTHING;

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

  UPDATE public.email_copilot_emails e
  SET client_id = NEW.id
  WHERE e.client_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.email_copilot_email_addresses a
      WHERE a.email_id = e.id
        AND a.address = ANY(client_emails)
    );

  RETURN NEW;
END;
$$;

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

  UPDATE public.email_copilot_emails e
  SET client_id = NEW.id
  WHERE e.client_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.email_copilot_email_addresses a
      WHERE a.email_id = e.id
        AND a.address = ANY(changed_emails)
    );

  UPDATE public.email_copilot_emails e
  SET client_id = NEW.id
  WHERE e.client_id IS NULL
    AND e.conversation_id IS NOT NULL
    AND e.conversation_id <> ''
    AND EXISTS (
      SELECT 1
      FROM public.email_copilot_emails linked
      WHERE linked.client_id = NEW.id
        AND linked.conversation_id = e.conversation_id
    );

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'email_copilot_email_addresses'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.email_copilot_email_addresses;
    END IF;
  END IF;
END;
$$;
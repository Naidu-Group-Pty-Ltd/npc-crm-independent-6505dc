-- ============================================================================
-- Builders Network — the clone-side mirror (extraction plan §7 Phase 3).
--
-- ADDITIVE ONLY, and dark by default: everything here sits behind
-- feature_flags.builder_network_enabled = false, read SERVER-SIDE (a browser
-- read of feature_flags returns [] for anon and coerces every flag false —
-- the trap this platform has hit three times). Nothing existing is touched;
-- every statement is guarded; nothing is dropped.
--
-- What the mirror is: this workspace's own record of its connections to the
-- Builders Network, and the two delivery queues between them. THE MIRROR IS
-- A BOUNDARY, NOT A CACHE — the network's row is authoritative for
-- connection state, and a webhook is not delivery: inbound events LAND here
-- and a sweep converges them into the marketplace's own tables.
--
-- The transport secret (symmetric per-connection HMAC) is written into
-- `outbound_hmac_secret` by Mission Control's provisioning machinery — MC
-- already holds this workspace's service credentials; it never holds the
-- network's. RLS is service-role-only on every table here.
-- ============================================================================

-- The flag, present and OFF. jsonb false, matching the platform's shape.
INSERT INTO public.feature_flags (key, value, description)
VALUES (
  'builder_network_enabled',
  'false'::jsonb,
  'Builders Network sync (clone side). OFF: the inbound door refuses by name and the outbox drain skips. Read server-side only.'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.builder_network_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The network's workspace_connections.id — the shared name for this link.
  network_connection_id uuid NOT NULL UNIQUE,
  builder_org_label text,
  state text NOT NULL DEFAULT 'invited'
    CHECK (state IN ('invited', 'active', 'revoked')),
  scopes text[] NOT NULL DEFAULT '{}',
  -- Symmetric transport secret; both directions sign ${timestamp}.${rawBody}.
  outbound_hmac_secret text,
  -- Where THIS workspace delivers: the network's builder-network-inbound.
  network_inbound_url text
    CHECK (network_inbound_url IS NULL OR network_inbound_url ~ '^https://'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT builder_network_connections_revocation_stamp
    CHECK ((state <> 'revoked') OR (revoked_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.builder_network_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL
    REFERENCES public.builder_network_connections(id) ON DELETE CASCADE,
  aggregate text NOT NULL DEFAULT 'builder_network',
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_version bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT builder_network_outbox_dedupe_key UNIQUE (dedupe_key),
  CONSTRAINT builder_network_outbox_delivery_stamp
    CHECK ((status <> 'delivered') OR (delivered_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS builder_network_outbox_claim_idx
  ON public.builder_network_outbox (status, available_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.builder_network_inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL
    REFERENCES public.builder_network_connections(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_version bigint NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT builder_network_inbound_events_dedupe_key UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS builder_network_inbound_events_unprocessed_idx
  ON public.builder_network_inbound_events (received_at)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.builder_network_stamps (
  connection_id uuid NOT NULL
    REFERENCES public.builder_network_connections(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('inbound', 'outbound')),
  stamp jsonb NOT NULL,
  source_version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, side)
);

-- Service-role only, all four: the browser never reads the sync plane.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'builder_network_connections', 'builder_network_outbox',
    'builder_network_inbound_events', 'builder_network_stamps'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_service ON public.%I AS PERMISSIVE FOR ALL TO service_role USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- The claim, the network worker's idiom exactly (SKIP LOCKED + lock lease +
-- attempts bumped AT claim).
CREATE OR REPLACE FUNCTION public.builder_network_claim_outbox(
  _worker_id text,
  _limit integer DEFAULT 25
) RETURNS SETOF public.builder_network_outbox
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.builder_network_outbox o
     SET locked_at = now(),
         locked_by = _worker_id,
         attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT c.id FROM public.builder_network_outbox c
      WHERE c.status = 'pending'
        AND c.available_at <= now()
        AND (c.locked_at IS NULL OR c.locked_at < now() - interval '10 minutes')
      ORDER BY c.created_at
      LIMIT greatest(1, least(_limit, 100))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*;
END;
$$;

REVOKE ALL ON FUNCTION public.builder_network_claim_outbox(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_network_claim_outbox(text, integer) TO service_role;

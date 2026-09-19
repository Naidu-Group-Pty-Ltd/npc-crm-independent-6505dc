
CREATE TABLE IF NOT EXISTS public.storage_object_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  object_path text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  client_id uuid,
  owner_user_id uuid,
  sensitivity text NOT NULL DEFAULT 'sensitive'
    CHECK (sensitivity IN ('sensitive','restricted','internal','public_asset')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, object_path)
);

CREATE INDEX IF NOT EXISTS storage_object_bindings_client_idx
  ON public.storage_object_bindings (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS storage_object_bindings_resource_idx
  ON public.storage_object_bindings (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS storage_object_bindings_owner_idx
  ON public.storage_object_bindings (owner_user_id) WHERE owner_user_id IS NOT NULL;

-- Service-role-only. No anon/authenticated grants: this table is an
-- authorization ledger and must only be read/written via edge functions.
GRANT ALL ON public.storage_object_bindings TO service_role;

ALTER TABLE public.storage_object_bindings ENABLE ROW LEVEL SECURITY;

-- Explicit deny for everyone except service_role (which bypasses RLS).
DROP POLICY IF EXISTS "deny_all_non_service" ON public.storage_object_bindings;
CREATE POLICY "deny_all_non_service"
  ON public.storage_object_bindings
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.storage_object_bindings IS
  'WP-06: canonical binding between a storage object and its authoritative resource. Written only by edge functions (service role); read by secure-storage resolver.';

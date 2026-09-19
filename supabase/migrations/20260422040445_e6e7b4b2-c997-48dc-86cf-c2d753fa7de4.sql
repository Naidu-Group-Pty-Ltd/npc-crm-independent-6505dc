ALTER TABLE public.finance_portal_documents
  ADD COLUMN IF NOT EXISTS source_surface public.record_source_surface,
  ADD COLUMN IF NOT EXISTS source_actor_type public.record_source_actor_type,
  ADD COLUMN IF NOT EXISTS source_actor_name text,
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS source_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sync_status public.sync_status_type NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS version_group_id uuid,
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_entity_id uuid,
  ADD COLUMN IF NOT EXISTS conflict_reason text,
  ADD COLUMN IF NOT EXISTS conflict_group text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_finance_portal_documents_client_content_hash
  ON public.finance_portal_documents (client_id, content_hash)
  WHERE deleted_at IS NULL AND content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_portal_documents_client_dedupe_key
  ON public.finance_portal_documents (client_id, dedupe_key)
  WHERE deleted_at IS NULL AND dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_portal_documents_version_group
  ON public.finance_portal_documents (version_group_id, version_number DESC)
  WHERE version_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_portal_documents_supersedes
  ON public.finance_portal_documents (supersedes_entity_id)
  WHERE supersedes_entity_id IS NOT NULL;
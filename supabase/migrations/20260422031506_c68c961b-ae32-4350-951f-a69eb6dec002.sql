DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'sync_status_type'
  ) THEN
    CREATE TYPE public.sync_status_type AS ENUM (
      'local',
      'synced',
      'duplicate',
      'superseded',
      'conflict'
    );
  END IF;
END$$;

ALTER TABLE public.client_files
  ADD COLUMN IF NOT EXISTS sync_origin_id uuid,
  ADD COLUMN IF NOT EXISTS sync_origin_table text,
  ADD COLUMN IF NOT EXISTS sync_origin_surface public.record_source_surface,
  ADD COLUMN IF NOT EXISTS sync_status public.sync_status_type NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS version_group_id uuid,
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_file_id uuid,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error text;

ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS sync_origin_id uuid,
  ADD COLUMN IF NOT EXISTS sync_origin_table text,
  ADD COLUMN IF NOT EXISTS sync_origin_surface public.record_source_surface,
  ADD COLUMN IF NOT EXISTS sync_status public.sync_status_type NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS version_group_id uuid,
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_note_id uuid,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error text;

ALTER TABLE public.client_activities
  ADD COLUMN IF NOT EXISTS sync_origin_id uuid,
  ADD COLUMN IF NOT EXISTS sync_origin_table text,
  ADD COLUMN IF NOT EXISTS sync_origin_surface public.record_source_surface,
  ADD COLUMN IF NOT EXISTS sync_status public.sync_status_type NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS related_record_id uuid,
  ADD COLUMN IF NOT EXISTS related_record_table text,
  ADD COLUMN IF NOT EXISTS event_timestamp timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error text;

CREATE TABLE IF NOT EXISTS public.client_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  entity_table text NOT NULL,
  entity_id uuid NOT NULL,
  entity_type text NOT NULL,
  source_surface public.record_source_surface NOT NULL,
  source_actor_type public.record_source_actor_type NOT NULL,
  source_actor_name text,
  source_reference text,
  source_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_status public.sync_status_type NOT NULL DEFAULT 'local',
  dedupe_key text,
  content_hash text,
  version_group_id uuid,
  version_number integer NOT NULL DEFAULT 1,
  conflict_group text,
  conflict_reason text,
  supersedes_entity_id uuid,
  propagated_to jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_sync_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'client_sync_events'
      AND policyname = 'Service role can manage client sync events'
  ) THEN
    CREATE POLICY "Service role can manage client sync events"
    ON public.client_sync_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_client_files_client_uploaded_at_source
  ON public.client_files (client_id, uploaded_at DESC, source_surface);
CREATE INDEX IF NOT EXISTS idx_client_files_dedupe_key
  ON public.client_files (client_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_client_files_version_group
  ON public.client_files (client_id, version_group_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_client_files_sync_origin
  ON public.client_files (sync_origin_table, sync_origin_id);

CREATE INDEX IF NOT EXISTS idx_client_notes_client_created_at_source
  ON public.client_notes (client_id, created_at DESC, source_surface);
CREATE INDEX IF NOT EXISTS idx_client_notes_dedupe_key
  ON public.client_notes (client_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_client_notes_version_group
  ON public.client_notes (client_id, version_group_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_client_notes_sync_origin
  ON public.client_notes (sync_origin_table, sync_origin_id);

CREATE INDEX IF NOT EXISTS idx_client_activities_client_event_time
  ON public.client_activities (client_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_client_activities_related_record
  ON public.client_activities (related_record_table, related_record_id);
CREATE INDEX IF NOT EXISTS idx_client_activities_source_surface
  ON public.client_activities (client_id, source_surface, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_client_sync_events_client_created_at
  ON public.client_sync_events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_sync_events_entity
  ON public.client_sync_events (entity_table, entity_id);
CREATE INDEX IF NOT EXISTS idx_client_sync_events_dedupe
  ON public.client_sync_events (client_id, entity_table, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_client_sync_events_version_group
  ON public.client_sync_events (client_id, version_group_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_client_sync_events_status
  ON public.client_sync_events (client_id, sync_status, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_client_sync_events_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_client_sync_events_updated_at ON public.client_sync_events;
CREATE TRIGGER trg_touch_client_sync_events_updated_at
BEFORE UPDATE ON public.client_sync_events
FOR EACH ROW
EXECUTE FUNCTION public.touch_client_sync_events_updated_at();

UPDATE public.client_files
SET version_group_id = COALESCE(version_group_id, id),
    sync_origin_id = COALESCE(sync_origin_id, id),
    sync_origin_table = COALESCE(sync_origin_table, 'client_files'),
    sync_origin_surface = COALESCE(sync_origin_surface, source_surface),
    dedupe_key = COALESCE(dedupe_key, md5(concat_ws('|', client_id::text, lower(coalesce(file_name, '')), coalesce(file_size::text, ''), coalesce(file_type, '')))),
    content_hash = COALESCE(content_hash, md5(concat_ws('|', lower(coalesce(file_name, '')), coalesce(file_size::text, ''), coalesce(file_type, '')))),
    last_synced_at = COALESCE(last_synced_at, uploaded_at)
WHERE version_group_id IS NULL
   OR sync_origin_id IS NULL
   OR sync_origin_table IS NULL
   OR sync_origin_surface IS NULL
   OR dedupe_key IS NULL
   OR content_hash IS NULL
   OR last_synced_at IS NULL;

UPDATE public.client_notes
SET version_group_id = COALESCE(version_group_id, id),
    sync_origin_id = COALESCE(sync_origin_id, id),
    sync_origin_table = COALESCE(sync_origin_table, 'client_notes'),
    sync_origin_surface = COALESCE(sync_origin_surface, source_surface),
    dedupe_key = COALESCE(dedupe_key, md5(concat_ws('|', client_id::text, lower(coalesce(note_type, '')), lower(left(coalesce(content, ''), 500))))),
    content_hash = COALESCE(content_hash, md5(concat_ws('|', lower(coalesce(note_type, '')), lower(coalesce(content, ''))))),
    last_synced_at = COALESCE(last_synced_at, created_at)
WHERE version_group_id IS NULL
   OR sync_origin_id IS NULL
   OR sync_origin_table IS NULL
   OR sync_origin_surface IS NULL
   OR dedupe_key IS NULL
   OR content_hash IS NULL
   OR last_synced_at IS NULL;

UPDATE public.client_activities
SET sync_origin_id = COALESCE(sync_origin_id, id),
    sync_origin_table = COALESCE(sync_origin_table, 'client_activities'),
    sync_origin_surface = COALESCE(sync_origin_surface, source_surface),
    last_synced_at = COALESCE(last_synced_at, event_timestamp)
WHERE sync_origin_id IS NULL
   OR sync_origin_table IS NULL
   OR sync_origin_surface IS NULL
   OR last_synced_at IS NULL;
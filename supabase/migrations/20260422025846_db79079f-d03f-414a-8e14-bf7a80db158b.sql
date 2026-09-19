CREATE TYPE public.record_source_surface AS ENUM ('internal_dashboard', 'finance_portal', 'client_portal', 'automation', 'external_system');

CREATE TYPE public.record_source_actor_type AS ENUM ('internal_user', 'finance_user', 'client_user', 'system');

ALTER TABLE public.client_files
  ADD COLUMN source_surface public.record_source_surface NOT NULL DEFAULT 'internal_dashboard',
  ADD COLUMN source_actor_type public.record_source_actor_type NOT NULL DEFAULT 'internal_user',
  ADD COLUMN source_actor_name text,
  ADD COLUMN source_reference text,
  ADD COLUMN source_details jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.client_notes
  ADD COLUMN source_surface public.record_source_surface NOT NULL DEFAULT 'internal_dashboard',
  ADD COLUMN source_actor_type public.record_source_actor_type NOT NULL DEFAULT 'internal_user',
  ADD COLUMN source_actor_name text,
  ADD COLUMN source_reference text,
  ADD COLUMN source_details jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.client_activities
  ADD COLUMN source_surface public.record_source_surface NOT NULL DEFAULT 'internal_dashboard',
  ADD COLUMN source_actor_type public.record_source_actor_type NOT NULL DEFAULT 'internal_user',
  ADD COLUMN source_actor_name text,
  ADD COLUMN source_reference text,
  ADD COLUMN source_details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX idx_client_files_client_uploaded_at_source
  ON public.client_files (client_id, uploaded_at DESC, source_surface);

CREATE INDEX idx_client_notes_client_created_at_source
  ON public.client_notes (client_id, created_at DESC, source_surface);

CREATE INDEX idx_client_activities_client_created_at_source
  ON public.client_activities (client_id, created_at DESC, source_surface);
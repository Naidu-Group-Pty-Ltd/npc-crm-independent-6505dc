-- Client notes contain confidential communications and must not be exposed through
-- a browser-accessible Realtime publication.
DROP POLICY IF EXISTS "Allow all operations on client_notes" ON public.client_notes;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'client_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.client_notes;
  END IF;
END
$$;

ALTER TABLE public.client_notes REPLICA IDENTITY DEFAULT;

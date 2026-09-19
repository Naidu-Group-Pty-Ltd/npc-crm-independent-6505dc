-- Allow the 'bulk_conversation_sync_completed' notification type.
-- The one-time bulk conversation sync now inserts a notification when a batch
-- finishes so staff get user-facing feedback in the Command Center.
-- Follows the existing dynamic pattern: append the value to the current
-- notifications_type_check constraint rather than redefining the whole list.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'notifications' AND c.conname = 'notifications_type_check';

  IF v_def IS NOT NULL AND position('bulk_conversation_sync_completed' in v_def) = 0 THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
    EXECUTE 'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (' ||
      regexp_replace(v_def, '^CHECK \((.*)\)$', '\1') ||
      ' OR type IN (''bulk_conversation_sync_completed''))';
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- if notifications table or constraint doesn't exist in this shape, skip silently
  NULL;
END $$;

-- Backfill of 21 unapplied post-baseline migrations (all idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS + CREATE). See /tmp/combined.sql

-- ============================================================
-- 20260606160000_bulk_conversation_sync_notification_type.sql
-- ============================================================
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
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- 20260606160500_widen_finance_assignment_source_check.sql
-- ============================================================
ALTER TABLE public.finance_portal_client_assignments
  DROP CONSTRAINT IF EXISTS finance_portal_assignments_source_check;
ALTER TABLE public.finance_portal_client_assignments
  ADD CONSTRAINT finance_portal_assignments_source_check
  CHECK (auto_link_source IS NULL OR auto_link_source IN ('client_field','deal','manual','finance_portal_created','csv_import'));
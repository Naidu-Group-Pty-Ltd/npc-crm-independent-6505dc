-- Migration: Prepare Extensions Schema for Future Migration
-- Purpose: Ensure extensions schema exists and document extension migration plan
-- Security: Prepare for moving extensions out of public schema
-- Date: 2025-01-24
-- 
-- NOTE: This migration does NOT move extensions (requires downtime).
-- It prepares the schema and documents the migration plan.

BEGIN;

-- ============================================
-- STEP 1: Ensure extensions schema exists
-- ============================================
CREATE SCHEMA IF NOT EXISTS extensions;

-- ============================================
-- STEP 2: Grant proper permissions to extensions schema
-- ============================================
-- Allow service_role, authenticated, and anon to use the schema
-- (needed for functions that use extensions)
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- ============================================
-- STEP 3: Create documentation table for extension migration tracking
-- ============================================
CREATE TABLE IF NOT EXISTS extension_migration_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_name TEXT NOT NULL UNIQUE,
  "current_schema" TEXT NOT NULL,
  target_schema TEXT NOT NULL DEFAULT 'extensions',
  status TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, completed, deferred
  migration_plan TEXT,
  risks TEXT,
  estimated_downtime TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert current extension status
INSERT INTO extension_migration_status (extension_name, "current_schema", target_schema, status, migration_plan, risks, estimated_downtime)
VALUES
  (
    'vector',
    'public',
    'extensions',
    'deferred',
    '1. Backup database
2. Identify all tables/columns using vector type
3. Identify all indexes using vector
4. Schedule maintenance window
5. Drop extension (will drop all vector columns/indexes)
6. Recreate extension in extensions schema
7. Recreate all vector columns
8. Recreate all vector indexes
9. Test thoroughly
10. Update application code if needed',
    'HIGH: Dropping extension will remove all vector columns and indexes. Requires careful planning and testing.',
    '30-60 minutes (depending on data volume)'
  ),
  (
    'pg_net',
    'public',
    'extensions',
    'deferred',
    '1. Backup database
2. Verify pg_net functions are in net schema (already done)
3. Schedule maintenance window
4. Drop extension
5. Recreate extension in extensions schema
6. Verify functions still work
7. Test thoroughly',
    'MEDIUM: Functions are already in net schema, but extension metadata is in public. Lower risk than vector.',
    '10-15 minutes'
  )
ON CONFLICT (extension_name) DO NOTHING;

-- ============================================
-- STEP 4: Create helper function to check extension usage
-- ============================================
CREATE OR REPLACE FUNCTION extensions.check_vector_usage()
RETURNS TABLE (
  table_schema TEXT,
  table_name TEXT,
  column_name TEXT,
  data_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.table_schema::TEXT,
    c.table_name::TEXT,
    c.column_name::TEXT,
    c.data_type::TEXT
  FROM information_schema.columns c
  WHERE c.udt_name = 'vector'
  ORDER BY c.table_schema, c.table_name, c.column_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION extensions.check_vector_usage() TO postgres, service_role;

-- ============================================
-- STEP 5: Create helper function to check vector indexes
-- ============================================
CREATE OR REPLACE FUNCTION extensions.check_vector_indexes()
RETURNS TABLE (
  schemaname TEXT,
  tablename TEXT,
  indexname TEXT,
  indexdef TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pi.schemaname::TEXT,
    pi.tablename::TEXT,
    pi.indexname::TEXT,
    pi.indexdef::TEXT
  FROM pg_indexes pi
  WHERE pi.indexdef LIKE '%vector%'
     OR pi.indexdef LIKE '%ivfflat%'
     OR pi.indexdef LIKE '%hnsw%'
  ORDER BY pi.schemaname, pi.tablename, pi.indexname;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION extensions.check_vector_indexes() TO postgres, service_role;

-- ============================================
-- Security Model Explanation
-- ============================================
-- This migration prepares for moving extensions out of public schema:
-- 1. Ensures extensions schema exists with proper permissions
-- 2. Documents extension migration status and plans
-- 3. Provides helper functions to check extension usage
-- 4. Does NOT move extensions (requires maintenance window)
--
-- Next steps:
-- 1. Review extension_migration_status table
-- 2. Plan maintenance window
-- 3. Test migration in staging
-- 4. Execute migration during maintenance window

COMMIT;


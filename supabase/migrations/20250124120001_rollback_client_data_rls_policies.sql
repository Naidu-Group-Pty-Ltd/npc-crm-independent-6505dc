-- SYNTAX NOTE (added later): this file was written with
--   CREATE POLICY IF NOT EXISTS ...
-- which PostgreSQL has never supported, in any version. `CREATE POLICY` has no
-- IF NOT EXISTS clause, so every statement below was a parse error (42601) and
-- this migration could never have run. Verified against PostgreSQL 17.
--
-- It is harmless in practice — clone backends are built by catalog
-- introspection and have this version stamped in their ledger, so it is never
-- replayed — but the pattern gets copied, and a NEW migration written this way
-- fails `applyPrimeMigrations`, which halts incremental sync to every clone on
-- the first failure. Rewritten to DROP IF EXISTS + CREATE, which is what the
-- author meant and what the rest of this corpus uses.
-- Rollback Migration: Restore Original Client Data RLS Policies
-- Purpose: Rollback the security changes if needed
-- Date: 2025-01-24
-- 
-- WARNING: This restores permissive policies that were removed for security.
-- Only use this if you need to rollback the security changes.

BEGIN;

-- ============================================
-- ROLLBACK: Restore original permissive policies
-- ============================================
-- Note: These policies were removed for security reasons.
-- Restoring them makes the data accessible again but less secure.

-- client_activities: Restore "Allow all access"
DROP POLICY IF EXISTS "Allow all access to client_activities" ON client_activities;
CREATE POLICY "Allow all access to client_activities"
ON client_activities
FOR ALL
USING (true)
WITH CHECK (true);

-- client_files: Restore "Allow all access"
DROP POLICY IF EXISTS "Allow all access to client_files" ON client_files;
CREATE POLICY "Allow all access to client_files"
ON client_files
FOR ALL
USING (true)
WITH CHECK (true);

-- client_notes: Restore "Allow all operations"
DROP POLICY IF EXISTS "Allow all operations on client_notes" ON client_notes;
CREATE POLICY "Allow all operations on client_notes"
ON client_notes
FOR ALL
USING (true)
WITH CHECK (true);

-- client_tag_assignments: Restore "Allow all access"
DROP POLICY IF EXISTS "Allow all access to client_tag_assignments" ON client_tag_assignments;
CREATE POLICY "Allow all access to client_tag_assignments"
ON client_tag_assignments
FOR ALL
USING (true)
WITH CHECK (true);

-- client_tags: Restore "Allow all access"
DROP POLICY IF EXISTS "Allow all access to client_tags" ON client_tags;
CREATE POLICY "Allow all access to client_tags"
ON client_tags
FOR ALL
USING (true)
WITH CHECK (true);

-- client_branding_profiles: Restore original policies
DROP POLICY IF EXISTS "Branding profiles are publicly readable" ON client_branding_profiles;
CREATE POLICY "Branding profiles are publicly readable"
ON client_branding_profiles
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Allow branding profile inserts" ON client_branding_profiles;
CREATE POLICY "Allow branding profile inserts"
ON client_branding_profiles
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow branding profile updates" ON client_branding_profiles;
CREATE POLICY "Allow branding profile updates"
ON client_branding_profiles
FOR UPDATE
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow branding profile deletes" ON client_branding_profiles;
CREATE POLICY "Allow branding profile deletes"
ON client_branding_profiles
FOR DELETE
USING (true);

-- ============================================
-- Security Warning
-- ============================================
-- These policies restore permissive access to client data.
-- This means any authenticated user can access all client data.
-- 
-- Use this rollback only if:
-- 1. The security changes are causing issues
-- 2. You need immediate access restored
-- 3. You plan to fix the issues and re-apply security later
--
-- After rollback, ensure edge functions still enforce proper access control.

COMMIT;


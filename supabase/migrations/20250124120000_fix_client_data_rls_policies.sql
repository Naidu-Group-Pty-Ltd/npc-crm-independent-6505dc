-- Migration: Fix RLS Policies for Client Data Tables
-- Purpose: Remove overly permissive policies and restrict access to service_role only
-- Security: All access must go through authenticated edge functions
-- Date: 2025-01-24

BEGIN;

-- ============================================
-- CRITICAL FIX: Remove overly permissive policies
-- ============================================

-- client_activities: Remove "Allow all access" policy
DROP POLICY IF EXISTS "Allow all access to client_activities" ON client_activities;

-- client_files: Remove "Allow all access" policy
DROP POLICY IF EXISTS "Allow all access to client_files" ON client_files;

-- client_notes: Remove "Allow all operations" policy
DROP POLICY IF EXISTS "Allow all operations on client_notes" ON client_notes;

-- client_tag_assignments: Remove "Allow all access" policy
DROP POLICY IF EXISTS "Allow all access to client_tag_assignments" ON client_tag_assignments;

-- client_tags: Remove "Allow all access" policy
DROP POLICY IF EXISTS "Allow all access to client_tags" ON client_tags;

-- client_branding_profiles: Remove overly permissive public policies
-- Note: These may have been intentionally public, but we'll restrict for security
-- If branding profiles need to be public, we can add specific read-only policies later
DROP POLICY IF EXISTS "Allow branding profile deletes" ON client_branding_profiles;
DROP POLICY IF EXISTS "Allow branding profile updates" ON client_branding_profiles;
DROP POLICY IF EXISTS "Branding profiles are publicly readable" ON client_branding_profiles;
DROP POLICY IF EXISTS "Allow branding profile inserts" ON client_branding_profiles;

-- ============================================
-- Security Model Explanation
-- ============================================
-- After removing overly permissive policies:
-- - RLS is enabled on all tables (default deny)
-- - Service role policies remain (edge functions use service_role)
-- - No public/anon policies = default deny for direct database access
-- - All access must go through authenticated edge functions
-- 
-- This is the correct security model for custom authentication:
-- 1. Edge functions authenticate users via custom session tokens
-- 2. Edge functions use service_role (bypasses RLS)
-- 3. Direct database queries are blocked (no policies for public role)
-- 4. Users cannot bypass edge function authentication

-- ============================================
-- NOTES:
-- ============================================
-- 1. Service role policies remain intact - edge functions can still access
-- 2. Direct database queries via Supabase client are now blocked
-- 3. All access must go through authenticated edge functions
-- 4. Edge functions use service_role which bypasses RLS (intended behavior)
-- 5. This works with custom authentication system
--
-- Testing:
-- - Edge functions should continue to work (they use service_role)
-- - Direct queries via Supabase client should be blocked
-- - Verify no application functionality is broken

COMMIT;


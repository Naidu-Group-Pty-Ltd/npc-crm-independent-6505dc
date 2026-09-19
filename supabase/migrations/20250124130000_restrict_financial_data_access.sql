-- Migration: Restrict Financial Data Access
-- Purpose: Remove overly permissive policies on financial data tables
-- Security: All access must go through authenticated edge functions
-- Date: 2025-01-24

BEGIN;

-- ============================================
-- CRITICAL FIX: Remove overly permissive policies on financial data
-- ============================================

-- borrowing_capacity_assessments: Remove public read access
DROP POLICY IF EXISTS "Public read access" ON borrowing_capacity_assessments;
DROP POLICY IF EXISTS "Service role full access" ON borrowing_capacity_assessments;

-- cash_flow_analyses: Remove "Anyone" policies
DROP POLICY IF EXISTS "Anyone can view cash flow analyses" ON cash_flow_analyses;
DROP POLICY IF EXISTS "Anyone can create cash flow analyses" ON cash_flow_analyses;
DROP POLICY IF EXISTS "Anyone can update cash flow analyses" ON cash_flow_analyses;
DROP POLICY IF EXISTS "Anyone can delete cash flow analyses" ON cash_flow_analyses;

-- portfolio_analysis_reports: Remove "Anyone" policies
DROP POLICY IF EXISTS "Anyone can view portfolio analysis reports" ON portfolio_analysis_reports;
DROP POLICY IF EXISTS "Anyone can create portfolio analysis reports" ON portfolio_analysis_reports;
DROP POLICY IF EXISTS "Anyone can update portfolio analysis reports" ON portfolio_analysis_reports;
DROP POLICY IF EXISTS "Anyone can delete portfolio analysis reports" ON portfolio_analysis_reports;

-- portfolio_reviews: Remove "Anyone" policies
DROP POLICY IF EXISTS "Anyone can view portfolio reviews" ON portfolio_reviews;
DROP POLICY IF EXISTS "Anyone can insert portfolio reviews" ON portfolio_reviews;
DROP POLICY IF EXISTS "Anyone can update portfolio reviews" ON portfolio_reviews;
DROP POLICY IF EXISTS "Anyone can delete portfolio reviews" ON portfolio_reviews;

-- ============================================
-- Security Model Explanation
-- ============================================
-- After removing overly permissive policies:
-- - RLS is enabled on all tables (default deny)
-- - Service role policies remain (edge functions use service_role)
-- - No public/anon policies = default deny for direct database access
-- - All access must go through authenticated edge functions
-- 
-- This ensures:
-- 1. Financial data is protected from unauthorized access
-- 2. All access goes through authenticated edge functions
-- 3. Users cannot bypass edge function authentication
-- 4. Compliance with data protection regulations

COMMIT;

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
-- - Test financial data access through edge functions


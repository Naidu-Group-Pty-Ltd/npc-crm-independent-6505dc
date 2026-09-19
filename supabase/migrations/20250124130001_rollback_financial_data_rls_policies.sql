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
-- Rollback Migration: Restore Original Financial Data RLS Policies
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

-- borrowing_capacity_assessments: Restore original policies
DROP POLICY IF EXISTS "Public read access" ON borrowing_capacity_assessments;
CREATE POLICY "Public read access"
ON borrowing_capacity_assessments
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Service role full access" ON borrowing_capacity_assessments;
CREATE POLICY "Service role full access"
ON borrowing_capacity_assessments
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- cash_flow_analyses: Restore "Anyone" policies
DROP POLICY IF EXISTS "Anyone can view cash flow analyses" ON cash_flow_analyses;
CREATE POLICY "Anyone can view cash flow analyses"
ON cash_flow_analyses
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Anyone can create cash flow analyses" ON cash_flow_analyses;
CREATE POLICY "Anyone can create cash flow analyses"
ON cash_flow_analyses
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update cash flow analyses" ON cash_flow_analyses;
CREATE POLICY "Anyone can update cash flow analyses"
ON cash_flow_analyses
FOR UPDATE
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can delete cash flow analyses" ON cash_flow_analyses;
CREATE POLICY "Anyone can delete cash flow analyses"
ON cash_flow_analyses
FOR DELETE
USING (true);

-- portfolio_analysis_reports: Restore "Anyone" policies
DROP POLICY IF EXISTS "Anyone can view portfolio analysis reports" ON portfolio_analysis_reports;
CREATE POLICY "Anyone can view portfolio analysis reports"
ON portfolio_analysis_reports
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Anyone can create portfolio analysis reports" ON portfolio_analysis_reports;
CREATE POLICY "Anyone can create portfolio analysis reports"
ON portfolio_analysis_reports
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update portfolio analysis reports" ON portfolio_analysis_reports;
CREATE POLICY "Anyone can update portfolio analysis reports"
ON portfolio_analysis_reports
FOR UPDATE
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can delete portfolio analysis reports" ON portfolio_analysis_reports;
CREATE POLICY "Anyone can delete portfolio analysis reports"
ON portfolio_analysis_reports
FOR DELETE
USING (true);

-- portfolio_reviews: Restore "Anyone" policies
DROP POLICY IF EXISTS "Anyone can view portfolio reviews" ON portfolio_reviews;
CREATE POLICY "Anyone can view portfolio reviews"
ON portfolio_reviews
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Anyone can insert portfolio reviews" ON portfolio_reviews;
CREATE POLICY "Anyone can insert portfolio reviews"
ON portfolio_reviews
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update portfolio reviews" ON portfolio_reviews;
CREATE POLICY "Anyone can update portfolio reviews"
ON portfolio_reviews
FOR UPDATE
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can delete portfolio reviews" ON portfolio_reviews;
CREATE POLICY "Anyone can delete portfolio reviews"
ON portfolio_reviews
FOR DELETE
USING (true);

-- ============================================
-- Security Warning
-- ============================================
-- These policies restore permissive access to financial data.
-- This means any authenticated user can access all financial data.
-- 
-- Use this rollback only if:
-- 1. The security changes are causing issues
-- 2. You need immediate access restored
-- 3. You plan to fix the issues and re-apply security later
--
-- After rollback, ensure edge functions still enforce proper access control.

COMMIT;


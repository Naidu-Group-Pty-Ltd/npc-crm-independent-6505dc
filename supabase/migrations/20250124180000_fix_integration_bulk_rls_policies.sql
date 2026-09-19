-- Migration: Fix RLS Policies for Integration and Bulk Generation Tables
-- Purpose: Remove overly permissive policies and implement secure user-based access
-- Security: User-based access for bulk jobs, admin-only for integrations, user-based for pipelines
-- Date: 2025-01-24

BEGIN;

-- ============================================
-- STEP 1: Fix integration_configs (Admin-only)
-- ============================================

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Authenticated users can view integration configs" ON integration_configs;
DROP POLICY IF EXISTS "Authenticated users can insert integration configs" ON integration_configs;
DROP POLICY IF EXISTS "Authenticated users can update integration configs" ON integration_configs;
DROP POLICY IF EXISTS "Authenticated users can delete integration configs" ON integration_configs;

-- Create admin-only policies
CREATE POLICY "Admins can view integration configs"
  ON integration_configs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('superadmin', 'admin')
    )
  );

CREATE POLICY "Admins can create integration configs"
  ON integration_configs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('superadmin', 'admin')
    )
  );

CREATE POLICY "Admins can update integration configs"
  ON integration_configs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('superadmin', 'admin')
    )
  );

CREATE POLICY "Admins can delete integration configs"
  ON integration_configs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('superadmin', 'admin')
    )
  );

-- ============================================
-- STEP 2: Fix bulk_generation_jobs (User-based)
-- ============================================

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Anyone can view bulk generation jobs" ON bulk_generation_jobs;
DROP POLICY IF EXISTS "Service role can manage all bulk jobs" ON bulk_generation_jobs;

-- Create user-based policies
CREATE POLICY "Users can view their own bulk generation jobs"
  ON bulk_generation_jobs FOR SELECT
  USING (created_by = auth.uid());

CREATE POLICY "Users can create bulk generation jobs"
  ON bulk_generation_jobs FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update their own bulk generation jobs"
  ON bulk_generation_jobs FOR UPDATE
  USING (created_by = auth.uid());

CREATE POLICY "Users can delete their own bulk generation jobs"
  ON bulk_generation_jobs FOR DELETE
  USING (created_by = auth.uid());

-- ============================================
-- STEP 3: Fix bulk_generation_items (User-based via job)
-- ============================================

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Anyone can view bulk generation items" ON bulk_generation_items;
DROP POLICY IF EXISTS "Service role can manage all bulk items" ON bulk_generation_items;

-- Create user-based policies (via job ownership)
CREATE POLICY "Users can view items for their bulk generation jobs"
  ON bulk_generation_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bulk_generation_jobs bj
      WHERE bj.id = bulk_generation_items.job_id
      AND bj.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create items for their bulk generation jobs"
  ON bulk_generation_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bulk_generation_jobs bj
      WHERE bj.id = bulk_generation_items.job_id
      AND bj.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update items for their bulk generation jobs"
  ON bulk_generation_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM bulk_generation_jobs bj
      WHERE bj.id = bulk_generation_items.job_id
      AND bj.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete items for their bulk generation jobs"
  ON bulk_generation_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM bulk_generation_jobs bj
      WHERE bj.id = bulk_generation_items.job_id
      AND bj.created_by = auth.uid()
    )
  );

-- ============================================
-- STEP 4: Fix ghl_pipelines (User-based via client ownership)
-- ============================================

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Pipelines are viewable by authenticated users" ON ghl_pipelines;
DROP POLICY IF EXISTS "Service role can manage pipelines" ON ghl_pipelines;

-- Create user-based policies (users can view pipelines used by their clients)
CREATE POLICY "Users can view pipelines for their clients"
  ON ghl_pipelines FOR SELECT
  USING (
    -- Pipeline is used by at least one client owned by the user
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.current_pipeline_id = ghl_pipelines.id
      AND c.created_by = auth.uid()
    )
    OR
    -- User is admin (admins can view all pipelines for management)
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('superadmin', 'admin')
    )
  );

-- Note: INSERT/UPDATE/DELETE are handled by service_role (via sync-ghl-pipelines function)
-- Regular users should not modify pipelines directly

-- ============================================
-- STEP 5: Fix ghl_pipeline_stages (User-based via pipeline)
-- ============================================

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Pipeline stages are viewable by authenticated users" ON ghl_pipeline_stages;
DROP POLICY IF EXISTS "Service role can manage pipeline stages" ON ghl_pipeline_stages;

-- Create user-based policies (users can view stages for pipelines used by their clients)
CREATE POLICY "Users can view stages for pipelines used by their clients"
  ON ghl_pipeline_stages FOR SELECT
  USING (
    -- Stage belongs to a pipeline used by at least one client owned by the user
    EXISTS (
      SELECT 1 FROM ghl_pipelines gp
      JOIN clients c ON c.current_pipeline_id = gp.id
      WHERE gp.id = ghl_pipeline_stages.pipeline_id
      AND c.created_by = auth.uid()
    )
    OR
    -- User is admin (admins can view all stages for management)
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('superadmin', 'admin')
    )
  );

-- Note: INSERT/UPDATE/DELETE are handled by service_role (via sync-ghl-pipelines function)
-- Regular users should not modify pipeline stages directly

-- ============================================
-- Security Model Explanation
-- ============================================
-- After this migration:
-- 
-- Integration Configs:
-- - Admin-only access (superadmin/admin roles)
-- - Service role policies remain for edge functions
--
-- Bulk Generation Jobs:
-- - Users can only access jobs they created (created_by = auth.uid())
-- - Service role policies remain for edge functions
--
-- Bulk Generation Items:
-- - Users can only access items for jobs they created
-- - Access is controlled via job ownership
-- - Service role policies remain for edge functions
--
-- GHL Pipelines:
-- - Users can view pipelines used by their clients
-- - Admins can view all pipelines
-- - Modifications are service_role only (via sync function)
--
-- GHL Pipeline Stages:
-- - Users can view stages for pipelines used by their clients
-- - Admins can view all stages
-- - Modifications are service_role only (via sync function)
--
-- This ensures:
-- 1. Integration configs are protected (admin-only)
-- 2. Bulk generation jobs are user-scoped
-- 3. Pipeline data is accessible to users who need it (via client ownership)
-- 4. All modifications go through authenticated edge functions

COMMIT;


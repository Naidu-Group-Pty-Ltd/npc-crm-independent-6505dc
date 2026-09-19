-- Migration Template for RLS Policy Fixes
-- Copy this template and modify for each table that needs policy fixes
-- File naming: YYYYMMDDHHMMSS_descriptive_name.sql

BEGIN;

-- ============================================
-- STEP 1: Drop existing permissive policies
-- ============================================
-- List all policies that need to be removed
-- Example:
-- DROP POLICY IF EXISTS "Policy name" ON table_name;
-- DROP POLICY IF EXISTS "Another policy" ON table_name;

-- ============================================
-- STEP 2: Create secure SELECT policy
-- ============================================
-- Choose appropriate pattern based on table:

-- Pattern A: User owns the resource
CREATE POLICY "Users can view their own [resource]"
  ON [table_name] FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM [parent_table] p
      WHERE p.id = [table_name].[foreign_key]
      AND p.created_by = auth.uid()::text
    )
  );

-- Pattern B: User created the resource
CREATE POLICY "Users can view resources they created"
  ON [table_name] FOR SELECT
  USING (created_by = auth.uid()::text);

-- Pattern C: Authenticated users only
CREATE POLICY "Authenticated users can view [resource]"
  ON [table_name] FOR SELECT
  USING (auth.role() = 'authenticated');

-- Pattern D: Admin or owner
CREATE POLICY "Users can view their own or if admin"
  ON [table_name] FOR SELECT
  USING (
    created_by = auth.uid()::text OR
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('superadmin', 'admin')
    )
  );

-- ============================================
-- STEP 3: Create secure INSERT policy
-- ============================================
CREATE POLICY "Users can create [resource]"
  ON [table_name] FOR INSERT
  WITH CHECK (
    -- Add appropriate checks:
    -- - User owns parent resource
    -- - User is authenticated
    -- - User has required role
    -- - created_by matches auth.uid()
    auth.role() = 'authenticated'
    AND created_by = auth.uid()::text
  );

-- ============================================
-- STEP 4: Create secure UPDATE policy
-- ============================================
CREATE POLICY "Users can update their own [resource]"
  ON [table_name] FOR UPDATE
  USING (
    -- Add appropriate checks (same as SELECT)
    created_by = auth.uid()::text
  )
  WITH CHECK (
    -- Ensure updated data still meets criteria
    created_by = auth.uid()::text
  );

-- ============================================
-- STEP 5: Create secure DELETE policy
-- ============================================
CREATE POLICY "Users can delete their own [resource]"
  ON [table_name] FOR DELETE
  USING (
    -- Add appropriate checks (same as SELECT)
    created_by = auth.uid()::text
  );

-- ============================================
-- STEP 6: Keep service role policies (if needed)
-- ============================================
-- Service role policies are usually fine as-is
-- They use service_role which bypasses RLS
-- Only modify if absolutely necessary

-- ============================================
-- STEP 7: Test queries
-- ============================================
-- After applying, test with:
-- 
-- -- As regular user
-- SET ROLE authenticated;
-- SET request.jwt.claims = '{"sub": "user-uuid-here"}';
-- SELECT * FROM [table_name]; -- Should only see own data
-- 
-- -- As service role
-- SET ROLE service_role;
-- SELECT * FROM [table_name]; -- Should see all data

COMMIT;

-- ============================================
-- NOTES:
-- ============================================
-- 1. Always test in staging first
-- 2. Backup before applying
-- 3. Verify service role still works
-- 4. Check for dependent policies
-- 5. Document any special cases
-- 6. Update this template if new patterns emerge


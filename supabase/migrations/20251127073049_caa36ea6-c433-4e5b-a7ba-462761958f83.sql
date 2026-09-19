
-- Step 1: Set generated_by to NULL for records that don't have a matching user in custom_users
UPDATE investment_reports 
SET generated_by = NULL 
WHERE generated_by IS NOT NULL 
  AND generated_by NOT IN (SELECT id FROM custom_users);

-- Step 2: Drop the existing foreign key constraint that references auth.users
ALTER TABLE investment_reports 
DROP CONSTRAINT IF EXISTS investment_reports_generated_by_fkey;

-- Step 3: Add new foreign key constraint that references custom_users
-- with ON DELETE SET NULL to handle user deletions gracefully
ALTER TABLE investment_reports 
ADD CONSTRAINT investment_reports_generated_by_fkey 
FOREIGN KEY (generated_by) 
REFERENCES custom_users(id) 
ON DELETE SET NULL;

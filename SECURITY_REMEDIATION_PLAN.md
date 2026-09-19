# Security Remediation Implementation Plan
**Project:** NPC Property Dashboard  
**Date:** January 2025  
**Current Security Score:** 42/100  
**Target Security Score:** 85/100  

---

## Overview

This plan addresses critical security vulnerabilities identified in the Supabase security audit. The remediation is divided into 4 stages, prioritized by risk and impact.

**Estimated Timeline:** 12-16 weeks  
**Risk Level:** High → Medium → Low

---

## Stage 1: Critical Immediate Fixes (Week 1)
**Priority:** CRITICAL  
**Target Completion:** 7 days  
**Expected Score Improvement:** 42 → 55/100

### 1.1 Enable JWT Verification on Critical Edge Functions
**Risk:** High - Unauthenticated access to sensitive operations

#### Tasks:
1. **Identify critical functions requiring immediate JWT protection:**
   - `get-client-data`
   - `secure-storage`
   - `manage-client-data`
   - `get-investment-reports`
   - `manage-investment-reports`
   - `get-call-logs`
   - `manage-call-logs`
   - `get-activity-logs`
   - `admin-user-management`
   - `admin-password-reset`

2. **Enable JWT verification:**
   ```bash
   # For each function, update via Supabase CLI or Dashboard
   # Example for get-client-data:
   supabase functions deploy get-client-data --verify-jwt
   ```

3. **Update function code to handle JWT:**
   ```typescript
   // Add to function entry point
   import { createClient } from '@supabase/supabase-js'
   
   const supabaseUrl = Deno.env.get('SUPABASE_URL')!
   const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
   
   // Get JWT from Authorization header
   const authHeader = req.headers.get('Authorization')
   const token = authHeader?.replace('Bearer ', '')
   
   // Verify JWT and get user
   const supabase = createClient(supabaseUrl, supabaseAnonKey, {
     global: { headers: { Authorization: `Bearer ${token}` } }
   })
   
   const { data: { user }, error } = await supabase.auth.getUser(token)
   if (error || !user) {
     return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
   }
   ```

4. **Testing:**
   - Verify functions reject requests without valid JWT
   - Verify functions accept requests with valid JWT
   - Test with expired tokens
   - Test with invalid tokens

**Success Criteria:**
- ✅ All 10 critical functions require JWT
- ✅ Unauthenticated requests return 401
- ✅ No breaking changes to existing authenticated flows

---

### 1.2 Fix RLS Policies for Sensitive Client Data Tables
**Risk:** Critical - Unauthorized access to PII and financial data

#### Migration Script:
```sql
-- Migration: fix_client_data_rls_policies
-- File: supabase/migrations/YYYYMMDDHHMMSS_fix_client_data_rls.sql

BEGIN;

-- 1. Drop overly permissive policies
DROP POLICY IF EXISTS "Allow all access to client_files" ON client_files;
DROP POLICY IF EXISTS "Allow all operations on client_notes" ON client_notes;
DROP POLICY IF EXISTS "Allow all access to client_activities" ON client_activities;
DROP POLICY IF EXISTS "Allow all access to client_tag_assignments" ON client_tag_assignments;
DROP POLICY IF EXISTS "Allow all access to client_tags" ON client_tags;

-- 2. Create secure policies for client_files
CREATE POLICY "Users can view their own client files"
  ON client_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_files.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can insert files for their clients"
  ON client_files FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_files.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can update their own client files"
  ON client_files FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_files.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can delete their own client files"
  ON client_files FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_files.client_id
      AND c.created_by = auth.uid()::text
    )
  );

-- 3. Create secure policies for client_notes
CREATE POLICY "Users can view notes for their clients"
  ON client_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_notes.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can create notes for their clients"
  ON client_notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_notes.client_id
      AND c.created_by = auth.uid()::text
    )
    AND created_by = auth.uid()::text
  );

CREATE POLICY "Users can update notes for their clients"
  ON client_notes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_notes.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can delete notes for their clients"
  ON client_notes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_notes.client_id
      AND c.created_by = auth.uid()::text
    )
  );

-- 4. Create secure policies for client_activities
CREATE POLICY "Users can view activities for their clients"
  ON client_activities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_activities.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can create activities for their clients"
  ON client_activities FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_activities.client_id
      AND c.created_by = auth.uid()::text
    )
    AND created_by = auth.uid()::text
  );

-- 5. Create secure policies for client_tags
CREATE POLICY "Authenticated users can view all tags"
  ON client_tags FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can create tags"
  ON client_tags FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND created_by = auth.uid()::text
  );

CREATE POLICY "Users can update their own tags"
  ON client_tags FOR UPDATE
  USING (created_by = auth.uid()::text);

CREATE POLICY "Users can delete their own tags"
  ON client_tags FOR DELETE
  USING (created_by = auth.uid()::text);

-- 6. Create secure policies for client_tag_assignments
CREATE POLICY "Users can view tag assignments for their clients"
  ON client_tag_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_tag_assignments.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can assign tags to their clients"
  ON client_tag_assignments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_tag_assignments.client_id
      AND c.created_by = auth.uid()::text
    )
    AND assigned_by = auth.uid()::text
  );

CREATE POLICY "Users can remove tags from their clients"
  ON client_tag_assignments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_tag_assignments.client_id
      AND c.created_by = auth.uid()::text
    )
  );

COMMIT;
```

#### Testing:
- Verify users can only access their own client data
- Verify users cannot access other users' client data
- Test with service role (should still work)
- Test edge cases (null values, deleted clients)

**Success Criteria:**
- ✅ Users can only access client data they created
- ✅ No unauthorized access possible
- ✅ Service role operations still function

---

### 1.3 Restrict Financial Data Access
**Risk:** Critical - Unauthorized access to sensitive financial information

#### Migration Script:
```sql
-- Migration: fix_financial_data_rls_policies
-- File: supabase/migrations/YYYYMMDDHHMMSS_fix_financial_data_rls.sql

BEGIN;

-- 1. Fix client_income policies
DROP POLICY IF EXISTS "Allow all access to client_income" ON client_income;

CREATE POLICY "Users can view income for their clients"
  ON client_income FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_income.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can manage income for their clients"
  ON client_income FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_income.client_id
      AND c.created_by = auth.uid()::text
    )
  );

-- 2. Fix client_assets policies
DROP POLICY IF EXISTS "Allow all access to client_assets" ON client_assets;

CREATE POLICY "Users can view assets for their clients"
  ON client_assets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_assets.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can manage assets for their clients"
  ON client_assets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_assets.client_id
      AND c.created_by = auth.uid()::text
    )
  );

-- 3. Fix client_liabilities policies
DROP POLICY IF EXISTS "Allow all access to client_liabilities" ON client_liabilities;

CREATE POLICY "Users can view liabilities for their clients"
  ON client_liabilities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_liabilities.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can manage liabilities for their clients"
  ON client_liabilities FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_liabilities.client_id
      AND c.created_by = auth.uid()::text
    )
  );

-- 4. Fix client_expenses policies
DROP POLICY IF EXISTS "Allow all access to client_expenses" ON client_expenses;

CREATE POLICY "Users can view expenses for their clients"
  ON client_expenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_expenses.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can manage expenses for their clients"
  ON client_expenses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_expenses.client_id
      AND c.created_by = auth.uid()::text
    )
  );

-- 5. Fix borrowing_capacity_assessments policies
-- Keep service role policy, but add user-based policy
CREATE POLICY "Users can view assessments for their clients"
  ON borrowing_capacity_assessments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = borrowing_capacity_assessments.client_id
      AND c.created_by = auth.uid()::text
    )
  );

COMMIT;
```

**Success Criteria:**
- ✅ Financial data only accessible to client owners
- ✅ No unauthorized access to income, assets, liabilities
- ✅ Borrowing capacity assessments protected

---

### 1.4 Enable Leaked Password Protection
**Risk:** Medium - Users can use compromised passwords

#### Steps:
1. Navigate to Supabase Dashboard → Authentication → Settings
2. Enable "Leaked Password Protection"
3. Configure to check against HaveIBeenPwned database
4. Set appropriate threshold (recommended: block known compromised passwords)

**Success Criteria:**
- ✅ Leaked password protection enabled
- ✅ Users cannot register with compromised passwords
- ✅ Existing users prompted to change compromised passwords

---

## Stage 2: High Priority Fixes (Weeks 2-4)
**Priority:** HIGH  
**Target Completion:** 3 weeks  
**Expected Score Improvement:** 55 → 70/100

### 2.1 Audit and Secure All Edge Functions
**Risk:** High - Unknown authentication status of 70+ functions

#### Tasks:

1. **Create audit checklist:**
   ```
   - Function name
   - Current verify_jwt status
   - Custom auth implementation?
   - Required authentication level (public/authenticated/admin)
   - Sensitive operations?
   - Data accessed?
   ```

2. **Categorize functions:**
   - **Public (no auth needed):** Webhook receivers, public APIs
   - **Authenticated (JWT required):** User data access, reports
   - **Admin (JWT + role check):** User management, system config

3. **Implementation plan:**
   ```typescript
   // Template for authenticated functions
   import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
   import { createClient } from '@supabase/supabase-js';
   
   serve(async (req) => {
     // Get JWT from header
     const authHeader = req.headers.get('Authorization');
     if (!authHeader?.startsWith('Bearer ')) {
       return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
         status: 401,
         headers: { 'Content-Type': 'application/json' }
       });
     }
     
     const token = authHeader.replace('Bearer ', '');
     const supabase = createClient(
       Deno.env.get('SUPABASE_URL')!,
       Deno.env.get('SUPABASE_ANON_KEY')!,
       { global: { headers: { Authorization: `Bearer ${token}` } } }
     );
     
     // Verify user
     const { data: { user }, error } = await supabase.auth.getUser(token);
     if (error || !user) {
       return new Response(JSON.stringify({ error: 'Invalid token' }), { 
         status: 401,
         headers: { 'Content-Type': 'application/json' }
       });
     }
     
     // Function logic here
     // ...
   });
   ```

4. **Batch update functions:**
   - Week 2: Data access functions (20 functions)
   - Week 3: Report generation functions (25 functions)
   - Week 4: Integration/webhook functions (25 functions)

**Success Criteria:**
- ✅ All functions categorized and documented
- ✅ Authentication implemented on all required functions
- ✅ No unauthorized access possible

---

### 2.2 Fix Email and Communication Data RLS
**Risk:** High - Email content accessible without authorization

#### Migration Script:
```sql
-- Migration: fix_email_rls_policies
-- File: supabase/migrations/YYYYMMDDHHMMSS_fix_email_rls.sql

BEGIN;

-- 1. Fix email_copilot_emails policies
DROP POLICY IF EXISTS "Allow public delete access to emails" ON email_copilot_emails;
DROP POLICY IF EXISTS "Allow public insert access to emails" ON email_copilot_emails;
DROP POLICY IF EXISTS "Allow public update access to emails" ON email_copilot_emails;

CREATE POLICY "Users can view emails for their clients"
  ON email_copilot_emails FOR SELECT
  USING (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = email_copilot_emails.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can create emails for their clients"
  ON email_copilot_emails FOR INSERT
  WITH CHECK (
    (client_id IS NULL OR
     EXISTS (
       SELECT 1 FROM clients c
       WHERE c.id = email_copilot_emails.client_id
       AND c.created_by = auth.uid()::text
     ))
    AND created_by = auth.uid()::text
  );

CREATE POLICY "Users can update emails for their clients"
  ON email_copilot_emails FOR UPDATE
  USING (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = email_copilot_emails.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can delete emails for their clients"
  ON email_copilot_emails FOR DELETE
  USING (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = email_copilot_emails.client_id
      AND c.created_by = auth.uid()::text
    )
  );

-- 2. Fix email_copilot_sent_replies policies
DROP POLICY IF EXISTS "Allow insert access to sent replies" ON email_copilot_sent_replies;

CREATE POLICY "Users can create sent replies"
  ON email_copilot_sent_replies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM email_copilot_emails e
      WHERE e.id = email_copilot_sent_replies.original_email_id
      AND (e.client_id IS NULL OR
           EXISTS (
             SELECT 1 FROM clients c
             WHERE c.id = e.client_id
             AND c.created_by = auth.uid()::text
           ))
    )
  );

-- 3. Fix vapi_call_logs policies (if needed)
-- Service role policies are fine, but add user-based read access if needed

COMMIT;
```

**Success Criteria:**
- ✅ Email data only accessible to authorized users
- ✅ Users can only access emails for their clients
- ✅ No unauthorized email access

---

### 2.3 Fix Report and Analysis Data RLS
**Risk:** High - Investment reports and comparisons accessible without authorization

#### Migration Script:
```sql
-- Migration: fix_reports_rls_policies
-- File: supabase/migrations/YYYYMMDDHHMMSS_fix_reports_rls.sql

BEGIN;

-- 1. Fix investment_reports policies
-- Add user-based read access (keep service role for generation)
CREATE POLICY "Users can view reports they generated"
  ON investment_reports FOR SELECT
  USING (
    generated_by::text = auth.uid()::text OR
    EXISTS (
      SELECT 1 FROM client_properties cp
      JOIN clients c ON c.id = cp.client_id
      WHERE cp.id = investment_reports.client_property_id
      AND c.created_by = auth.uid()::text
    )
  );

-- 2. Fix property_comparisons policies
DROP POLICY IF EXISTS "All authenticated users can create comparisons" ON property_comparisons;
DROP POLICY IF EXISTS "All authenticated users can delete all comparisons" ON property_comparisons;
DROP POLICY IF EXISTS "All authenticated users can update all comparisons" ON property_comparisons;

CREATE POLICY "Users can view their own comparisons"
  ON property_comparisons FOR SELECT
  USING (created_by::text = auth.uid()::text);

CREATE POLICY "Users can create comparisons"
  ON property_comparisons FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND created_by = auth.uid()::text
  );

CREATE POLICY "Users can update their own comparisons"
  ON property_comparisons FOR UPDATE
  USING (created_by::text = auth.uid()::text);

CREATE POLICY "Users can delete their own comparisons"
  ON property_comparisons FOR DELETE
  USING (created_by::text = auth.uid()::text);

-- 3. Fix cash_flow_analyses policies
DROP POLICY IF EXISTS "Anyone can create cash flow analyses" ON cash_flow_analyses;
DROP POLICY IF EXISTS "Anyone can delete cash flow analyses" ON cash_flow_analyses;
DROP POLICY IF EXISTS "Anyone can update cash flow analyses" ON cash_flow_analyses;

CREATE POLICY "Users can view their own cash flow analyses"
  ON cash_flow_analyses FOR SELECT
  USING (created_by::text = auth.uid()::text);

CREATE POLICY "Users can create cash flow analyses"
  ON cash_flow_analyses FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND created_by = auth.uid()::text
  );

CREATE POLICY "Users can update their own cash flow analyses"
  ON cash_flow_analyses FOR UPDATE
  USING (created_by::text = auth.uid()::text);

CREATE POLICY "Users can delete their own cash flow analyses"
  ON cash_flow_analyses FOR DELETE
  USING (created_by::text = auth.uid()::text);

-- 4. Fix portfolio_reviews policies
DROP POLICY IF EXISTS "Anyone can insert portfolio reviews" ON portfolio_reviews;
DROP POLICY IF EXISTS "Anyone can update portfolio reviews" ON portfolio_reviews;
DROP POLICY IF EXISTS "Anyone can delete portfolio reviews" ON portfolio_reviews;

CREATE POLICY "Users can view reviews for their clients"
  ON portfolio_reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = portfolio_reviews.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can create reviews for their clients"
  ON portfolio_reviews FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = portfolio_reviews.client_id
      AND c.created_by = auth.uid()::text
    )
    AND reviewer_id = auth.uid()::text
  );

CREATE POLICY "Users can update reviews for their clients"
  ON portfolio_reviews FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = portfolio_reviews.client_id
      AND c.created_by = auth.uid()::text
    )
  );

CREATE POLICY "Users can delete reviews for their clients"
  ON portfolio_reviews FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = portfolio_reviews.client_id
      AND c.created_by = auth.uid()::text
    )
  );

COMMIT;
```

**Success Criteria:**
- ✅ Reports only accessible to creators or client owners
- ✅ Comparisons restricted to creators
- ✅ Portfolio reviews restricted to client owners

---

### 2.4 Move Extensions Out of Public Schema
**Risk:** Medium - Extensions accessible by any user

#### Migration Script:
```sql
-- Migration: move_extensions_to_dedicated_schema
-- File: supabase/migrations/YYYYMMDDHHMMSS_move_extensions.sql

BEGIN;

-- 1. Create extensions schema
CREATE SCHEMA IF NOT EXISTS extensions;

-- 2. Move vector extension
-- Note: This requires recreating the extension
-- First, check what uses vector extension
DO $$
BEGIN
  -- Drop extension from public
  DROP EXTENSION IF EXISTS vector CASCADE;
  
  -- Recreate in extensions schema
  CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;
  
  -- Update any tables/columns that use vector type
  -- This will need to be done carefully to avoid data loss
END $$;

-- 3. Move pg_net extension
DO $$
BEGIN
  DROP EXTENSION IF EXISTS pg_net CASCADE;
  CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
END $$;

-- 4. Grant necessary permissions
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

COMMIT;
```

**⚠️ WARNING:** This migration may require downtime and careful testing. Test in staging first.

**Success Criteria:**
- ✅ Extensions moved to dedicated schema
- ✅ No functionality broken
- ✅ Proper permissions granted

---

## Stage 3: Medium Priority Improvements (Weeks 5-8)
**Priority:** MEDIUM  
**Target Completion:** 4 weeks  
**Expected Score Improvement:** 70 → 80/100

### 3.1 Upgrade Postgres Version
**Risk:** Medium - Security patches available

#### Steps:
1. **Check current version:**
   ```sql
   SELECT version();
   ```

2. **Review Supabase upgrade documentation:**
   - Check for breaking changes
- Review migration guide
   - Plan maintenance window

3. **Create backup:**
   - Full database backup
   - Test restore procedure

4. **Schedule upgrade:**
   - Coordinate with team
   - Plan for rollback if needed
   - Monitor for issues post-upgrade

**Success Criteria:**
- ✅ Postgres upgraded to latest patched version
- ✅ No functionality broken
- ✅ Performance maintained or improved

---

### 3.2 Implement Role-Based Access Control (RBAC)
**Risk:** Medium - Current permission system may have gaps

#### Implementation:
1. **Create RBAC helper functions:**
   ```sql
   -- Function to check if user is admin
   CREATE OR REPLACE FUNCTION is_admin(user_id UUID)
   RETURNS BOOLEAN AS $$
   BEGIN
     RETURN EXISTS (
       SELECT 1 FROM user_roles ur
       WHERE ur.user_id = is_admin.user_id
       AND ur.role IN ('superadmin', 'admin')
     );
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;

   -- Function to check if user owns client
   CREATE OR REPLACE FUNCTION owns_client(user_id UUID, client_id UUID)
   RETURNS BOOLEAN AS $$
   BEGIN
     RETURN EXISTS (
       SELECT 1 FROM clients c
       WHERE c.id = owns_client.client_id
       AND c.created_by = owns_client.user_id::text
     );
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;
   ```

2. **Update RLS policies to use RBAC functions:**
   ```sql
   -- Example: Update clients table policy
   CREATE POLICY "Users can view their own clients or if admin"
     ON clients FOR SELECT
     USING (
       created_by = auth.uid()::text OR
       is_admin(auth.uid())
     );
   ```

**Success Criteria:**
- ✅ RBAC functions implemented
- ✅ Policies use RBAC functions
- ✅ Admin access properly controlled

---

### 3.3 Secure Auto-Report and Automation Tables
**Risk:** Medium - Automation settings accessible without proper controls

#### Migration Script:
```sql
-- Migration: fix_automation_rls_policies
-- File: supabase/migrations/YYYYMMDDHHMMSS_fix_automation_rls.sql

BEGIN;

-- 1. Fix auto_report_switches policies
DROP POLICY IF EXISTS "Anyone can create switches" ON auto_report_switches;
DROP POLICY IF EXISTS "Anyone can update switches" ON auto_report_switches;
DROP POLICY IF EXISTS "Anyone can delete switches" ON auto_report_switches;

CREATE POLICY "Users can view switches"
  ON auto_report_switches FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can create switches"
  ON auto_report_switches FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND created_by = auth.uid()::text
  );

CREATE POLICY "Users can update their own switches"
  ON auto_report_switches FOR UPDATE
  USING (created_by = auth.uid()::text);

CREATE POLICY "Users can delete their own switches"
  ON auto_report_switches FOR DELETE
  USING (created_by = auth.uid()::text);

-- 2. Fix global_report_settings policies
DROP POLICY IF EXISTS "Anyone can insert global report settings" ON global_report_settings;
DROP POLICY IF EXISTS "Anyone can update global report settings" ON global_report_settings;

CREATE POLICY "Authenticated users can view global settings"
  ON global_report_settings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage global settings"
  ON global_report_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('superadmin', 'admin')
    )
  );

COMMIT;
```

**Success Criteria:**
- ✅ Automation settings properly restricted
- ✅ Only authorized users can modify automation
- ✅ Global settings admin-only

---

### 3.4 Implement Audit Logging for Sensitive Operations
**Risk:** Low-Medium - No audit trail for security events

#### Implementation:
1. **Create audit log table:**
   ```sql
   CREATE TABLE IF NOT EXISTS security_audit_log (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID REFERENCES custom_users(id),
     action_type TEXT NOT NULL,
     resource_type TEXT NOT NULL,
     resource_id UUID,
     ip_address INET,
     user_agent TEXT,
     details JSONB,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE INDEX idx_security_audit_user ON security_audit_log(user_id);
   CREATE INDEX idx_security_audit_action ON security_audit_log(action_type);
   CREATE INDEX idx_security_audit_created ON security_audit_log(created_at);
   ```

2. **Create audit trigger function:**
   ```sql
   CREATE OR REPLACE FUNCTION log_security_event()
   RETURNS TRIGGER AS $$
   BEGIN
     INSERT INTO security_audit_log (
       user_id,
       action_type,
       resource_type,
       resource_id,
       details
     ) VALUES (
       auth.uid(),
       TG_OP,
       TG_TABLE_NAME,
       COALESCE(NEW.id, OLD.id),
       jsonb_build_object(
         'old', row_to_json(OLD),
         'new', row_to_json(NEW)
       )
     );
     RETURN COALESCE(NEW, OLD);
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;
   ```

3. **Apply triggers to sensitive tables:**
   ```sql
   CREATE TRIGGER audit_clients_changes
     AFTER INSERT OR UPDATE OR DELETE ON clients
     FOR EACH ROW EXECUTE FUNCTION log_security_event();

   CREATE TRIGGER audit_financial_changes
     AFTER INSERT OR UPDATE OR DELETE ON client_income
     FOR EACH ROW EXECUTE FUNCTION log_security_event();
   -- Repeat for other sensitive tables
   ```

**Success Criteria:**
- ✅ Audit logging implemented
- ✅ Sensitive operations logged
- ✅ Logs accessible for review

---

## Stage 4: Long-term Hardening (Weeks 9-12+)
**Priority:** LOW-MEDIUM  
**Target Completion:** 4+ weeks  
**Expected Score Improvement:** 80 → 85/100

### 4.1 Implement Rate Limiting
**Risk:** Low - Potential for abuse

#### Implementation:
1. **Add rate limiting to edge functions:**
   ```typescript
   // Rate limiting middleware
   const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
   
   function checkRateLimit(userId: string, limit: number, windowMs: number): boolean {
     const now = Date.now();
     const key = userId;
     const record = rateLimitMap.get(key);
     
     if (!record || now > record.resetAt) {
       rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
       return true;
     }
     
     if (record.count >= limit) {
       return false;
     }
     
     record.count++;
     return true;
   }
   ```

2. **Apply to sensitive endpoints:**
   - Login attempts: 5 per minute
   - Report generation: 10 per hour
   - Data exports: 5 per day

**Success Criteria:**
- ✅ Rate limiting implemented
- ✅ Abuse prevented
- ✅ Legitimate users not impacted

---

### 4.2 Review and Optimize CORS Configuration
**Risk:** Low - Potential CORS misconfiguration

#### Tasks:
1. **Audit current CORS settings:**
   - Review allowed origins
   - Check credentials handling
   - Verify header permissions

2. **Tighten CORS policies:**
   ```typescript
   // Update createCorsHeaders function
   export function createCorsHeaders(origin: string | null): Record<string, string> {
     const allowedOrigins = [
       'https://npc-property-dashbord.lovable.app',
       'http://localhost:8080', // Development only
     ];
     
     // Remove wildcard patterns
     const allowedOrigin = origin && allowedOrigins.includes(origin)
       ? origin
       : null;
     
     if (!allowedOrigin) {
       return {
         'Access-Control-Allow-Origin': 'null',
         'Access-Control-Allow-Methods': 'OPTIONS',
       };
     }
     
     return {
       'Access-Control-Allow-Origin': allowedOrigin,
       'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
       'Access-Control-Allow-Headers': 'authorization, content-type, x-session-token',
       'Access-Control-Allow-Credentials': 'true',
       'Access-Control-Max-Age': '86400',
       'Vary': 'Origin',
     };
   }
   ```

**Success Criteria:**
- ✅ CORS properly configured
- ✅ No unnecessary origins allowed
- ✅ Credentials handled securely

---

### 4.3 Implement Data Encryption at Rest
**Risk:** Low - Additional security layer

#### Implementation:
1. **Review Supabase encryption:**
   - Verify database encryption enabled
   - Check backup encryption
   - Review storage encryption

2. **Implement field-level encryption for sensitive data:**
   ```typescript
   // Example: Encrypt sensitive fields before storage
   import { encrypt, decrypt } from './encryption';
   
   // Before inserting
   const encryptedIncome = await encrypt(clientIncome.toString());
   
   // After retrieving
   const decryptedIncome = await decrypt(encryptedIncome);
   ```

**Success Criteria:**
- ✅ Encryption verified
- ✅ Sensitive fields encrypted
- ✅ Performance acceptable

---

### 4.4 Security Monitoring and Alerting
**Risk:** Low - Need visibility into security events

#### Implementation:
1. **Set up security alerts:**
   - Failed login attempts
   - Unauthorized access attempts
   - Unusual data access patterns
   - Policy violations

2. **Create monitoring dashboard:**
   - Security event metrics
   - Access patterns
   - Anomaly detection

**Success Criteria:**
- ✅ Alerts configured
- ✅ Monitoring dashboard created
- ✅ Team notified of security events

---

## Testing Strategy

### Unit Tests
- Test each RLS policy with various user scenarios
- Test edge function authentication
- Test RBAC functions

### Integration Tests
- Test end-to-end user flows
- Test service role operations
- Test cross-table access patterns

### Security Tests
- Penetration testing
- Access control verification
- Authentication bypass attempts

### Rollback Plan
- Keep previous migrations
- Document rollback procedures
- Test rollback in staging

---

## Success Metrics

### Security Score Targets
- **Stage 1:** 42 → 55/100
- **Stage 2:** 55 → 70/100
- **Stage 3:** 70 → 80/100
- **Stage 4:** 80 → 85/100

### Key Performance Indicators
- Zero unauthorized data access
- All edge functions properly authenticated
- All RLS policies properly scoped
- No security incidents

---

## Risk Assessment

### High Risk Items
- RLS policy changes (could break functionality)
- Extension migration (requires downtime)
- Postgres upgrade (potential breaking changes)

### Mitigation Strategies
- Test all changes in staging first
- Implement gradual rollout
- Maintain rollback capability
- Monitor closely after each change

---

## Timeline Summary

| Stage | Duration | Priority | Score Improvement |
|-------|----------|----------|-------------------|
| Stage 1 | Week 1 | CRITICAL | 42 → 55 |
| Stage 2 | Weeks 2-4 | HIGH | 55 → 70 |
| Stage 3 | Weeks 5-8 | MEDIUM | 70 → 80 |
| Stage 4 | Weeks 9-12+ | LOW | 80 → 85 |

**Total Estimated Time:** 12-16 weeks

---

## Notes

- All migrations should be tested in staging before production
- Coordinate with team for maintenance windows
- Document all changes thoroughly
- Keep security audit trail
- Regular security reviews recommended

---

## Contact

For questions or issues during implementation, refer to:
- Supabase Documentation: https://supabase.com/docs
- Security Best Practices: https://supabase.com/docs/guides/database/security
- RLS Policy Guide: https://supabase.com/docs/guides/database/postgres/row-level-security


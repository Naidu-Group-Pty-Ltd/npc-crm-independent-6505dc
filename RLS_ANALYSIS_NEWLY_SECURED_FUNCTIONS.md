# RLS Policy Analysis - Tables Accessed by Newly Secured Functions

**Date:** 2025-01-24  
**Status:** ⚠️ **CRITICAL ISSUES FOUND**

---

## Executive Summary

After securing 17 high-priority edge functions, we checked the RLS policies on tables they access. **Found 7 tables with overly permissive policies** that allow public/authenticated users to bypass function authentication and access data directly.

**Recommendation:** Fix RLS policies BEFORE continuing with more edge functions. This ensures complete security coverage.

---

## Critical Issues Found

### 🔴 **CRITICAL - Public Access (qual: true)**

#### 1. **auto_report_master_settings**
- **Issue:** "Anyone can view master settings" (public role, qual: true)
- **Impact:** Anyone can view automation master settings
- **Used by:** `manage-automation-settings` (admin-only function)
- **Fix Required:** Remove public policy, restrict to admin-only

#### 2. **auto_report_switches**
- **Issue:** "Anyone can view/create/update/delete switches" (public role, qual: true)
- **Impact:** Anyone can manage automation switches
- **Used by:** `manage-automation-settings` (admin-only function)
- **Fix Required:** Remove public policies, restrict to admin-only

#### 3. **auto_report_processed_listings**
- **Issue:** "Anyone can view processed listings" (public role, qual: true)
- **Impact:** Anyone can view which listings have been processed
- **Used by:** `manage-automation-settings` (admin-only function)
- **Fix Required:** Remove public policy, restrict to admin-only

#### 4. **auto_report_generation_log**
- **Issue:** "Anyone can view generation log" (public role, qual: true)
- **Impact:** Anyone can view automation generation logs
- **Used by:** `get-system-logs` (admin-only function)
- **Fix Required:** Remove public policy, restrict to admin-only

#### 5. **api_health_log**
- **Issue:** "Anyone can view API health logs" (public role, qual: true)
- **Impact:** Anyone can view API health monitoring data
- **Used by:** `get-system-logs` (admin-only function)
- **Fix Required:** Remove public policy, restrict to admin-only

#### 6. **document_chunks**
- **Issue:** Multiple overly permissive policies:
  - "Document chunks are publicly readable" (public role, qual: true)
  - "Anyone can create/delete document chunks" (public role, qual: true)
- **Impact:** Anyone can read/modify document chunks used for RAG
- **Used by:** `parse-template-document`, `retrieve-template-context`
- **Fix Required:** Remove public policies, restrict to authenticated users with proper ownership checks

#### 7. **report_structure_templates**
- **Issue:** Multiple overly permissive policies:
  - "Templates are publicly readable" (public role, qual: true)
  - "Allow template inserts/updates/deletes" (public role, qual: true)
- **Impact:** Anyone can view/modify report templates
- **Used by:** `manage-templates`, `parse-template-document`, `retrieve-template-context`
- **Fix Required:** Remove public policies, restrict to authenticated users (admin for modifications)

---

### 🟡 **MEDIUM - Authenticated Access (Still Too Permissive)**

#### 8. **ghl_pipelines** and **ghl_pipeline_stages**
- **Issue:** "Pipelines are viewable by authenticated users" (public role, qual: true)
- **Impact:** All authenticated users can view all pipelines
- **Used by:** `sync-ghl-pipelines`, `update-ghl-opportunity-stage`
- **Fix Required:** Consider restricting to users who own clients in those pipelines

#### 9. **integration_configs**
- **Issue:** "Authenticated users can view/insert/update/delete integration configs" (public role, qual: true)
- **Impact:** All authenticated users can manage integration configs
- **Used by:** `manage-templates`
- **Fix Required:** Restrict to admin-only

#### 10. **bulk_generation_jobs** and **bulk_generation_items**
- **Issue:** "Anyone can view bulk generation jobs/items" (anon,authenticated roles, qual: true)
- **Impact:** All users can view all bulk generation jobs
- **Used by:** `manage-templates`
- **Fix Required:** Restrict to users who created the jobs

---

## ✅ Tables with Proper RLS (Already Fixed)

1. **investment_reports** - ✅ User-based policies (users can only access their own reports)
2. **property_comparisons** - ✅ User-based policies (users can only access their own comparisons)
3. **vapi_call_logs** - ✅ Authenticated users can view (appropriate for call logs)

---

## Security Impact

### Current Risk:
Even though we've secured the edge functions, users can still:
1. **Bypass function authentication** by querying tables directly via Supabase client
2. **Access sensitive automation settings** without admin privileges
3. **View/modify document chunks** used for RAG retrieval
4. **Access system logs** without admin privileges
5. **Modify report templates** without proper authorization

### After Fix:
- All access must go through authenticated edge functions
- Direct database access will be blocked by RLS
- Complete security coverage

---

## Recommended Fix Priority

### Priority 1 (Critical - Fix Immediately):
1. `auto_report_master_settings` - Admin-only
2. `auto_report_switches` - Admin-only
3. `auto_report_processed_listings` - Admin-only
4. `auto_report_generation_log` - Admin-only
5. `api_health_log` - Admin-only
6. `document_chunks` - Authenticated users with ownership checks
7. `report_structure_templates` - Authenticated users (admin for modifications)

### Priority 2 (Medium - Fix Soon):
8. `ghl_pipelines` / `ghl_pipeline_stages` - User-based access
9. `integration_configs` - Admin-only
10. `bulk_generation_jobs` / `bulk_generation_items` - User-based access

---

## Next Steps

1. **Create migration** to fix Priority 1 tables
2. **Test RLS policies** after migration
3. **Continue with edge functions** after RLS is secure
4. **Fix Priority 2 tables** in next batch

---

## Tables Summary

| Table | Current RLS | Required RLS | Priority |
|-------|-------------|--------------|----------|
| `auto_report_master_settings` | Public read | Admin-only | 🔴 Critical |
| `auto_report_switches` | Public all | Admin-only | 🔴 Critical |
| `auto_report_processed_listings` | Public read | Admin-only | 🔴 Critical |
| `auto_report_generation_log` | Public read | Admin-only | 🔴 Critical |
| `api_health_log` | Public read | Admin-only | 🔴 Critical |
| `document_chunks` | Public all | User-based | 🔴 Critical |
| `report_structure_templates` | Public all | User-based (admin modify) | 🔴 Critical |
| `ghl_pipelines` | Authenticated read | User-based | 🟡 Medium |
| `ghl_pipeline_stages` | Authenticated read | User-based | 🟡 Medium |
| `integration_configs` | Authenticated all | Admin-only | 🟡 Medium |
| `bulk_generation_jobs` | Authenticated read | User-based | 🟡 Medium |
| `bulk_generation_items` | Authenticated read | User-based | 🟡 Medium |

---

## Conclusion

**We should fix RLS policies BEFORE continuing with more edge functions.** This ensures that:
1. Security is complete (both function-level and database-level)
2. Users cannot bypass function authentication
3. Sensitive data is properly protected

The edge functions we've secured are good, but without proper RLS, the security model is incomplete.


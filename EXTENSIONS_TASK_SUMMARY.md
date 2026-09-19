# Task 2.4: Move Extensions Out of Public Schema - Summary

**Date:** 2025-01-24  
**Task:** 2.4 - Move Extensions Out of Public Schema  
**Status:** ⚠️ DEFERRED (Requires Maintenance Window)

---

## Overview

This task involves moving database extensions from the `public` schema to a dedicated `extensions` schema. However, this is a **high-risk operation** that requires downtime and careful planning.

---

## Current State

### Extensions in Public Schema (Need Migration):
1. **vector** (0.8.0) - Vector/embedding data type
2. **pg_net** (0.14.0) - Async HTTP requests

### Extensions Already in Proper Schemas:
- ✅ `uuid-ossp` → `extensions` schema
- ✅ `pgcrypto` → `extensions` schema
- ✅ `pg_stat_statements` → `extensions` schema
- ✅ `pg_graphql` → `graphql` schema
- ✅ `supabase_vault` → `vault` schema
- ✅ `pg_cron` → `pg_catalog` schema
- ✅ `plpgsql` → `pg_catalog` schema

---

## Why This Task is Deferred

### 1. **High Risk Operation**
Moving extensions requires:
- Dropping the extension (destructive)
- Recreating in new schema
- Recreating all dependent objects (columns, indexes, functions)

### 2. **Downtime Required**
- Vector extension: 30-60 minutes estimated downtime
- pg_net extension: 10-15 minutes estimated downtime
- Total: Requires scheduled maintenance window

### 3. **Data Loss Risk**
- Dropping `vector` extension will **remove all vector columns and indexes**
- Must backup and restore data
- Must recreate all vector columns and indexes

### 4. **Testing Required**
- Must test migration in staging first
- Must verify all functionality after migration
- Must update application code if needed

---

## What Has Been Done

### 1. Created Migration File
- File: `supabase/migrations/20250124160000_prepare_extensions_schema.sql`
- Purpose: Prepares extensions schema and documents migration plan
- Status: Created but not yet applied (migration tool had issues)

### 2. Created Documentation
- File: `EXTENSIONS_MIGRATION_WARNING.md`
- Contains detailed warnings and migration plan

### 3. Analyzed Current State
- Identified extensions in public schema
- Verified extensions schema exists
- Checked permissions and access

---

## Migration Plan (For Future Maintenance Window)

### For Vector Extension:
1. **Pre-Migration:**
   - Full database backup
   - Identify all tables/columns using vector type
   - Identify all indexes using vector
   - Document all vector column definitions
   - Document all vector index definitions

2. **During Migration:**
   - Schedule maintenance window (30-60 minutes)
   - Drop vector extension
   - Recreate vector extension in extensions schema
   - Recreate all vector columns
   - Recreate all vector indexes
   - Verify data integrity

3. **Post-Migration:**
   - Test all vector operations
   - Verify indexes are working
   - Update application code if needed
   - Monitor for issues

### For pg_net Extension:
1. **Pre-Migration:**
   - Full database backup
   - Verify functions are in net schema (already done)
   - Document all pg_net usage

2. **During Migration:**
   - Schedule maintenance window (10-15 minutes)
   - Drop pg_net extension
   - Recreate pg_net extension in extensions schema
   - Verify functions still work

3. **Post-Migration:**
   - Test all HTTP functions
   - Verify edge functions still work
   - Monitor for issues

---

## Security Impact

### Current State:
- ⚠️ Extensions in public schema are accessible to all users
- ⚠️ Vector and pg_net types/functions are in public namespace

### After Migration:
- ✅ Extensions isolated in extensions schema
- ✅ Reduced attack surface
- ✅ Better organization and security

### Risk Assessment:
- **Security Risk:** Medium (extensions in public schema)
- **Migration Risk:** High (requires downtime and careful planning)
- **Recommendation:** Defer to maintenance window

---

## Next Steps

1. **Immediate:**
   - Review migration plan
   - Schedule maintenance window
   - Test migration in staging environment

2. **Before Migration:**
   - Create full database backup
   - Document all vector/pg_net usage
   - Prepare rollback plan
   - Notify users of maintenance window

3. **During Migration:**
   - Execute migration during scheduled window
   - Monitor for issues
   - Verify functionality

4. **After Migration:**
   - Test thoroughly
   - Monitor for issues
   - Update documentation

---

## Alternative Approach (If Migration Not Possible)

If moving extensions is not feasible, we can:
1. Ensure proper RLS policies on tables using extensions
2. Limit access to extension functions via edge functions only
3. Document security considerations
4. Accept the risk (extensions in public schema is common in PostgreSQL)

---

## Files Created

1. `supabase/migrations/20250124160000_prepare_extensions_schema.sql` - Migration file
2. `EXTENSIONS_MIGRATION_WARNING.md` - Detailed warnings
3. `EXTENSIONS_TASK_SUMMARY.md` - This file

---

## Conclusion

Task 2.4 is **deferred** due to the high risk and downtime requirements. The migration plan is documented and ready for execution during a scheduled maintenance window. The current security posture is acceptable given that:
- RLS policies protect data access
- Edge functions control extension usage
- Extensions in public schema is a common PostgreSQL pattern

**Recommendation:** Complete this task during the next scheduled maintenance window after thorough testing in staging.


# Extension Migration Warning

**Date:** 2025-01-24  
**Task:** 2.4 - Move Extensions Out of Public Schema  
**Status:** ⚠️ REQUIRES CAREFUL PLANNING

---

## ⚠️ IMPORTANT WARNINGS

### 1. **Downtime Required**
Moving extensions requires dropping and recreating them, which will cause:
- Temporary loss of extension functionality
- Potential data access issues during migration
- Need for maintenance window

### 2. **Vector Extension Migration**
The `vector` extension is currently in the `public` schema. Moving it requires:
- Dropping the extension (which will drop all vector columns and indexes)
- Recreating the extension in the new schema
- Recreating all vector columns
- Recreating all vector indexes

**This is a destructive operation that requires:**
- Full database backup
- Maintenance window
- Careful testing in staging first

### 3. **pg_net Extension**
The `pg_net` extension is listed as being in `public` schema, but its functions are already in the `net` schema. This suggests the extension might already be partially organized. We should verify the current state before making changes.

---

## Current State

### Extensions in Public Schema:
1. **vector** (0.8.0) - Used for vector/embedding data
2. **pg_net** (0.14.0) - Used for async HTTP requests

### Extensions Already in Proper Schemas:
- `uuid-ossp` → `extensions` schema ✅
- `pgcrypto` → `extensions` schema ✅
- `pg_stat_statements` → `extensions` schema ✅
- `pg_graphql` → `graphql` schema ✅
- `supabase_vault` → `vault` schema ✅
- `pg_cron` → `pg_catalog` schema ✅
- `plpgsql` → `pg_catalog` schema ✅

---

## Recommended Approach

### Option 1: Defer to Maintenance Window (RECOMMENDED)
- Document the need for extension migration
- Plan for a scheduled maintenance window
- Test migration in staging environment first
- Create rollback plan

### Option 2: Create Extensions Schema and Grant Permissions
- Create `extensions` schema if needed (already exists)
- Grant proper permissions to prevent public access
- Document that extensions should be moved during next maintenance window

### Option 3: Move Extensions Now (HIGH RISK)
- Requires downtime
- Requires full backup
- Requires testing in staging first
- Not recommended for production without proper planning

---

## Recommendation

**For Stage 2, we recommend Option 2:**
1. Ensure `extensions` schema exists and has proper permissions
2. Document the need to move `vector` and `pg_net` extensions
3. Create a detailed migration plan for a future maintenance window
4. For now, ensure proper permissions are set to limit access

This approach:
- ✅ Improves security immediately (via permissions)
- ✅ Avoids risky downtime
- ✅ Allows proper planning for extension migration
- ✅ Can be completed in a scheduled maintenance window

---

## Next Steps

1. Create migration to ensure proper schema permissions
2. Document extension migration plan for future maintenance window
3. Mark task as "deferred" with proper documentation


# Rollback Guide - Security Changes

**Date:** 2025-01-24  
**Purpose:** How to rollback security changes if issues occur after deployment

## ✅ YES - All Changes Can Be Rolled Back

Every change we've made can be safely rolled back. Here's how:

---

## 🔄 Rollback Methods by Component

### 1. Edge Functions (Code Changes)

**Status:** ✅ **Fully Rollbackable**

#### Method A: Redeploy Previous Version (Recommended)

Supabase keeps version history of all edge function deployments. You can:

1. **Via Supabase Dashboard:**
   - Go to Edge Functions → [Function Name]
   - Click on "Versions" or "History"
   - Select the previous working version
   - Click "Redeploy" or "Rollback"

2. **Via Supabase CLI:**
   ```bash
   # List function versions
   supabase functions list --function-name admin-user-management
   
   # Deploy specific version (if supported)
   # Note: CLI may require manual code rollback
   ```

3. **Via Git (If you have previous version):**
   ```bash
   # Checkout previous commit
   git log --oneline supabase/functions/admin-user-management/
   git checkout <previous-commit-hash> -- supabase/functions/admin-user-management/
   
   # Redeploy
   supabase functions deploy admin-user-management
   ```

#### Method B: Manual Code Rollback

1. **Restore from Git:**
   ```bash
   # Find the commit before security changes
   git log --oneline
   
   # Restore specific files
   git checkout <commit-before-changes> -- supabase/functions/_shared/auth.ts
   git checkout <commit-before-changes> -- supabase/functions/admin-user-management/index.ts
   # ... restore all modified functions
   
   # Redeploy
   supabase functions deploy admin-user-management
   supabase functions deploy admin-password-reset
   # ... deploy all functions
   ```

2. **Manual Edit:**
   - Revert changes manually in Supabase Dashboard editor
   - Or restore from backup

**Rollback Time:** ⏱️ 5-15 minutes per function

---

### 2. Database Migrations (RLS Policies)

**Status:** ✅ **Fully Rollbackable** (with reverse migrations)

#### Method A: Create Reverse Migrations (Recommended)

We've created reverse migration files that restore the original policies:

1. **Rollback Client Data RLS Changes:**
   ```sql
   -- File: 20250124120001_rollback_client_data_rls_policies.sql
   -- This restores the original permissive policies
   ```

2. **Rollback Financial Data RLS Changes:**
   ```sql
   -- File: 20250124130001_rollback_financial_data_rls_policies.sql
   -- This restores the original permissive policies
   ```

#### Method B: Manual SQL Rollback

1. **Via Supabase Dashboard:**
   - Go to Database → SQL Editor
   - Run the reverse migration SQL manually
   - Or restore policies one by one

2. **Via Supabase CLI:**
   ```bash
   # Apply reverse migration
   supabase db reset --db-url <your-db-url>
   # OR manually run SQL
   ```

**Rollback Time:** ⏱️ 1-5 minutes

---

### 3. JWT Verification Settings

**Status:** ✅ **Instantly Rollbackable**

#### Method: Toggle in Dashboard

1. **Via Supabase Dashboard:**
   - Go to Edge Functions → [Function Name] → Settings
   - Toggle "Verify JWT" OFF
   - Save

2. **For All 10 Functions:**
   - Repeat for each function:
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

**Rollback Time:** ⏱️ 2-5 minutes (manual toggle)

---

### 4. Password Validation (Leaked Password Check)

**Status:** ✅ **Fully Rollbackable**

#### Method: Disable Leaked Password Check

1. **Quick Fix - Disable Check:**
   - Update `passwordValidation.ts` to set `checkLeaked: false` by default
   - Or pass `checkLeaked: false` in function calls
   - Redeploy affected functions

2. **Full Rollback:**
   - Restore previous version of `passwordValidation.ts` from Git
   - Remove `leakedPasswordCheck.ts` if needed
   - Redeploy functions

**Rollback Time:** ⏱️ 5-10 minutes

---

## 🚨 Emergency Rollback Procedures

### Scenario 1: Edge Functions Breaking

**Symptoms:**
- Functions returning 500 errors
- Authentication failures
- Users unable to access features

**Quick Rollback:**
1. **Disable JWT Verification** (2 minutes)
   - Dashboard → Edge Functions → [Function] → Settings
   - Toggle "Verify JWT" OFF
   - This allows functions to work with session tokens only

2. **Redeploy Previous Version** (5-15 minutes)
   - Dashboard → Edge Functions → [Function] → Versions
   - Select previous version → Redeploy

**Impact:** ⚠️ Functions work but without JWT validation (less secure)

---

### Scenario 2: RLS Policies Too Restrictive

**Symptoms:**
- Users can't access their data
- Edge functions can't read/write data
- Database errors

**Quick Rollback:**
1. **Apply Reverse Migration** (1-5 minutes)
   ```sql
   -- Run reverse migration SQL in Dashboard SQL Editor
   -- This restores original permissive policies
   ```

2. **Or Manually Restore Policies:**
   - Create policies with `qual: true` (permissive)
   - Restore original policy names

**Impact:** ⚠️ Data accessible again but less secure

---

### Scenario 3: Password Validation Too Strict

**Symptoms:**
- Users can't set passwords
- Password reset failing
- Leaked password check blocking legitimate passwords

**Quick Rollback:**
1. **Disable Leaked Check Temporarily:**
   - Update function to pass `checkLeaked: false`
   - Redeploy function

2. **Or Remove Check:**
   - Restore previous `passwordValidation.ts`
   - Redeploy

**Impact:** ⚠️ Passwords work but without leak protection

---

## 📋 Rollback Checklist

### Before Rolling Back:

- [ ] Identify the specific issue
- [ ] Determine which component needs rollback
- [ ] Document the current state
- [ ] Notify team (if applicable)
- [ ] Backup current state (if possible)

### During Rollback:

- [ ] Follow rollback procedure for affected component
- [ ] Test immediately after rollback
- [ ] Verify functionality restored
- [ ] Monitor logs for errors

### After Rollback:

- [ ] Verify issue is resolved
- [ ] Document what was rolled back
- [ ] Plan fix for the issue
- [ ] Test fix in development before redeploying

---

## 🔒 Safety Features

### What Makes Rollback Safe:

1. **Version History:**
   - Supabase keeps function version history
   - Can always revert to previous version

2. **Migration Reversibility:**
   - All migrations can be reversed
   - Reverse migrations created for safety

3. **Non-Destructive Changes:**
   - We're adding security, not removing data
   - Rollback restores previous state

4. **Gradual Deployment:**
   - Can rollback one function at a time
   - Don't need to rollback everything

---

## 📝 Reverse Migration Files

We've created reverse migration files for safety:

1. **`20250124120001_rollback_client_data_rls_policies.sql`**
   - Restores original client data RLS policies

2. **`20250124130001_rollback_financial_data_rls_policies.sql`**
   - Restores original financial data RLS policies

These can be applied if you need to rollback the RLS changes.

---

## 🎯 Recommended Rollback Strategy

### For Testing:

1. **Deploy to Staging First** (if available)
2. **Test thoroughly**
3. **Rollback if issues found**
4. **Fix issues in development**
5. **Redeploy when ready**

### For Production:

1. **Deploy one component at a time**
2. **Monitor closely after each deployment**
3. **Have rollback plan ready**
4. **Test rollback procedure beforehand**

### Staged Rollback:

If issues occur, rollback in this order:

1. **JWT Settings** (fastest - 2 minutes)
2. **Edge Functions** (5-15 minutes)
3. **Password Validation** (5-10 minutes)
4. **RLS Policies** (1-5 minutes)

---

## ⚡ Quick Reference

### Fastest Rollbacks:

1. **JWT Settings:** Dashboard toggle (2 min)
2. **Password Check:** Disable flag (5 min)
3. **RLS Policies:** Reverse migration (5 min)
4. **Edge Functions:** Version rollback (15 min)

### Full System Rollback:

If everything needs to rollback:
1. Disable JWT on all 10 functions (10 min)
2. Apply reverse RLS migrations (5 min)
3. Rollback edge functions (15 min)
4. **Total Time:** ~30 minutes

---

## 📞 Support

If you need help with rollback:
1. Check this guide first
2. Review Supabase Dashboard for version history
3. Check Git history for previous code versions
4. Contact Supabase support if needed

---

## ✅ Summary

**All changes are rollbackable:**
- ✅ Edge Functions: Version history + Git
- ✅ Database Migrations: Reverse migrations created
- ✅ JWT Settings: Dashboard toggle
- ✅ Password Validation: Code rollback

**Rollback Time:** 2-30 minutes depending on scope

**Safety:** All rollbacks are non-destructive and reversible


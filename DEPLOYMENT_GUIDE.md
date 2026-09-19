# Supabase Deployment Guide

## ⚠️ IMPORTANT: Changes Do NOT Auto-Deploy

**Committing Supabase changes to Git does NOT automatically deploy them to production.**

However, since you have **Supabase MCP server configured**, I can deploy changes directly using MCP tools when you explicitly request it.

### Current Status:
- ✅ **MCP Tools Available**: I can deploy edge functions and apply migrations via MCP
- ⚠️ **No Auto-Deploy**: Git commits still don't trigger automatic deployments
- 🔧 **Manual Deployment**: I can deploy when you ask, or you can use CLI/Dashboard

All Supabase changes require **explicit deployment** using one of the methods below.

---

## What We've Changed (Local Only)

### ✅ Edge Functions (Code Changes)
- **Location**: `supabase/functions/`
- **Files Changed**:
  - `_shared/auth.ts` - Enhanced authentication
  - `get-client-data/index.ts`
  - `secure-storage/index.ts`
  - `manage-client-data/index.ts`
  - `get-investment-reports/index.ts`
  - `manage-investment-reports/index.ts`
  - `get-call-logs/index.ts`
  - `manage-call-logs/index.ts`
  - `get-activity-logs/index.ts`
  - `admin-user-management/index.ts`
  - `admin-password-reset/index.ts`

### ⚠️ Config File (Local Development Only)
- **Location**: `supabase/config.toml`
- **Note**: This file is for **local development only**
- **Production config** is managed in Supabase Dashboard
- Changes to `config.toml` do NOT affect production automatically

### 📋 Database Migrations (Not Created Yet)
- **Location**: `supabase/migrations/`
- We'll create migrations for RLS policies in upcoming tasks

---

## Deployment Methods

### Option 1: Supabase CLI (Recommended for Edge Functions)

```bash
# 1. Install Supabase CLI (if not already installed)
npm install -g supabase

# 2. Link to your project
supabase link --project-ref dduzbchuswwbefdunfct

# 3. Deploy specific functions
supabase functions deploy get-client-data
supabase functions deploy secure-storage
supabase functions deploy manage-client-data
supabase functions deploy get-investment-reports
supabase functions deploy manage-investment-reports
supabase functions deploy get-call-logs
supabase functions deploy manage-call-logs
supabase functions deploy get-activity-logs
supabase functions deploy admin-user-management
supabase functions deploy admin-password-reset

# OR deploy all functions at once
supabase functions deploy
```

### Option 2: Supabase Dashboard

1. Go to https://supabase.com/dashboard/project/dduzbchuswwbefdunfct
2. Navigate to **Edge Functions**
3. For each function:
   - Click on the function name
   - Click **Deploy** or **Update**
   - Upload the function code manually

### Option 3: Enable JWT Verification (Dashboard)

**This is CRITICAL** - The `config.toml` changes won't apply automatically!

1. Go to Supabase Dashboard → **Edge Functions**
2. For each of the 10 functions, click on the function
3. Go to **Settings**
4. Enable **"Verify JWT"** toggle
5. Save

**Functions requiring JWT verification:**
- ✅ get-client-data
- ✅ secure-storage
- ✅ manage-client-data
- ✅ get-investment-reports
- ✅ manage-investment-reports
- ✅ get-call-logs
- ✅ manage-call-logs
- ✅ get-activity-logs
- ✅ admin-user-management
- ✅ admin-password-reset

---

## Deployment Checklist

### Before Deploying:
- [ ] Test all functions locally
- [ ] Review all code changes
- [ ] Ensure environment variables are set in production
- [ ] Backup production database (if needed)

### Deploy Edge Functions:
- [ ] Deploy `_shared/auth.ts` (automatically included with functions)
- [ ] Deploy all 10 updated functions
- [ ] Enable JWT verification in Dashboard for all 10 functions
- [ ] Test each function in production

### After Deploying:
- [ ] Verify functions work with JWT tokens
- [ ] Verify functions still work with session tokens (backward compatibility)
- [ ] Monitor logs for any errors
- [ ] Test critical user flows

---

## What Happens When You Commit?

### ✅ Safe to Commit:
- Edge function code (`supabase/functions/`)
- Migration files (`supabase/migrations/`)
- Config file (`supabase/config.toml`) - for version control only

### ⚠️ Does NOT Auto-Deploy:
- Edge functions need explicit deployment
- Config changes need manual application in Dashboard
- Migrations need explicit application

### 🔒 Production Safety:
- **Nothing deploys automatically**
- You have full control over when changes go live
- Test locally first, then deploy when ready

---

## Recommended Workflow

1. **Make changes locally** ✅ (What we're doing now)
2. **Test locally** ✅ (Using `supabase start` if needed)
3. **Commit to Git** ✅ (Safe - won't deploy)
4. **Review and approve** ✅ (Team review if needed)
5. **Deploy to staging** (If you have a staging environment)
6. **Test in staging**
7. **Deploy to production** (When ready)
8. **Monitor and verify**

---

## Current Status

- ✅ **Task 1.1 Complete**: All code changes made locally
- ⏳ **Not Deployed**: Changes are local only
- 🔒 **Production Safe**: No changes have been made to production
- 📝 **Ready for Review**: All changes are ready for testing and deployment

---

## Questions?

If you're unsure about deployment:
1. Test everything locally first
2. Deploy to a staging environment (if available)
3. Deploy one function at a time to production
4. Monitor closely after each deployment


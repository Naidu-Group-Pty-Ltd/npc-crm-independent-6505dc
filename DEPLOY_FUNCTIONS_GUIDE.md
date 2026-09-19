# How to Deploy Edge Functions on Supabase

**Date:** 2025-01-24  
**Purpose:** Step-by-step guide to deploy the 10 updated edge functions

---

## Method 1: Supabase Dashboard (Recommended - Easiest)

### Prerequisites
- Access to Supabase Dashboard
- Your project URL and credentials

### Step-by-Step Instructions

#### Step 1: Access Edge Functions
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **Edge Functions** in the left sidebar
4. You should see a list of all your functions

#### Step 2: Deploy Each Function

For each of the 10 functions, follow these steps:

**Option A: Update Existing Function (if function already exists)**
1. Click on the function name (e.g., `admin-user-management`)
2. Click **"Deploy"** or **"Update"** button
3. You'll see a code editor with the current function code
4. **Copy the entire contents** of the local function file:
   - Open: `supabase/functions/[function-name]/index.ts`
   - Copy all the code
5. **Paste it** into the Dashboard editor, replacing the existing code
6. Click **"Deploy"** or **"Save"**

**Option B: Create New Function (if function doesn't exist)**
1. Click **"Create Function"** or **"New Function"**
2. Enter the function name (e.g., `admin-user-management`)
3. Paste the code from `supabase/functions/[function-name]/index.ts`
4. Click **"Deploy"**

#### Step 3: Include Shared Files

**IMPORTANT:** Each function uses shared files from `_shared/` folder. You need to include these:

For each function, after pasting the main `index.ts` code:

1. **Check if Dashboard has a "Files" or "Dependencies" section**
2. **Add shared files** (if the Dashboard supports multiple files):
   - `_shared/auth.ts`
   - `_shared/password.ts`
   - `_shared/passwordValidation.ts`
   - `_shared/leakedPasswordCheck.ts` (for functions that use it)

**Note:** Some Dashboards automatically bundle shared files. If yours doesn't:
- You may need to use Supabase CLI (Method 2)
- Or inline the shared code (not recommended)

#### Step 4: Functions to Deploy

Deploy these 10 functions in this order (shared files are used by multiple functions):

1. ✅ `admin-user-management` (uses: auth.ts, password.ts, passwordValidation.ts, leakedPasswordCheck.ts)
2. ✅ `admin-password-reset` (uses: auth.ts, password.ts, passwordValidation.ts, leakedPasswordCheck.ts)
3. ✅ `get-client-data` (uses: auth.ts)
4. ✅ `secure-storage` (uses: auth.ts)
5. ✅ `manage-client-data` (uses: auth.ts)
6. ✅ `get-investment-reports` (uses: auth.ts)
7. ✅ `manage-investment-reports` (uses: auth.ts)
8. ✅ `get-call-logs` (uses: auth.ts)
9. ✅ `manage-call-logs` (uses: auth.ts)
10. ✅ `get-activity-logs` (uses: auth.ts)

#### Step 5: Enable JWT Verification

**CRITICAL:** After deploying each function:

1. Click on the deployed function
2. Go to **"Settings"** or **"Configuration"** tab
3. Find **"Verify JWT"** toggle
4. **Enable it** (turn it ON)
5. Click **"Save"**

Repeat for all 10 functions.

---

## Method 2: Supabase CLI (Recommended for Multiple Functions)

### Prerequisites
- Node.js installed
- Supabase CLI installed

### Install Supabase CLI

**Windows (PowerShell):**
```powershell
# Using npm
npm install -g supabase

# Or using Scoop
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

**macOS/Linux:**
```bash
# Using Homebrew (macOS)
brew install supabase/tap/supabase

# Or using npm
npm install -g supabase
```

### Verify Installation
```bash
supabase --version
```

### Step-by-Step Instructions

#### Step 1: Login to Supabase
```bash
supabase login
```
This will open a browser window for authentication.

#### Step 2: Link Your Project
```bash
cd C:\Users\ASUS\npc-property-dashbord
supabase link --project-ref dduzbchuswwbefdunfct
```

Replace `dduzbchuswwbefdunfct` with your actual project reference ID (found in Dashboard URL or project settings).

#### Step 3: Deploy Functions

Deploy all functions at once:
```bash
cd supabase

# Deploy each function (CLI automatically includes _shared/ files)
supabase functions deploy admin-user-management
supabase functions deploy admin-password-reset
supabase functions deploy get-client-data
supabase functions deploy secure-storage
supabase functions deploy manage-client-data
supabase functions deploy get-investment-reports
supabase functions deploy manage-investment-reports
supabase functions deploy get-call-logs
supabase functions deploy manage-call-logs
supabase functions deploy get-activity-logs
```

**Or deploy all at once:**
```bash
supabase functions deploy
```

#### Step 4: Enable JWT Verification

After deploying, you still need to enable JWT verification in Dashboard:
1. Go to Supabase Dashboard → Edge Functions
2. For each function, enable "Verify JWT" toggle

**OR** update `supabase/config.toml`:
```toml
[functions.admin-user-management]
verify_jwt = true

[functions.admin-password-reset]
verify_jwt = true

# ... etc for all 10 functions
```

Then push the config:
```bash
supabase db push
```

---

## Method 3: Using Git + Supabase CI/CD (Advanced)

If your project is connected to GitHub and has Supabase CI/CD enabled:

1. **Commit your changes:**
   ```bash
   git add supabase/functions/
   git commit -m "Deploy security updates to edge functions"
   git push
   ```

2. **Supabase will automatically deploy** functions from your repository

3. **Enable JWT verification** in Dashboard (still manual)

---

## Verification Steps

After deploying, verify each function:

### 1. Check Function Status
- Go to Dashboard → Edge Functions
- Verify all 10 functions show **"Active"** status
- Check for any error messages

### 2. Check Function Logs
- Click on each function
- Go to **"Logs"** tab
- Look for any deployment or runtime errors

### 3. Test a Function
```bash
# Test with curl (replace with your function URL)
curl -X POST https://dduzbchuswwbefdunfct.supabase.co/functions/v1/get-client-data \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listMode": true}'
```

### 4. Verify JWT Verification
- Check Dashboard → Edge Functions → [Function] → Settings
- Verify "Verify JWT" is **enabled** for all 10 functions

---

## Troubleshooting

### Issue: "Module not found" errors
**Solution:** 
- Ensure `_shared/` files are included
- Check file paths match imports (`../_shared/auth.ts`)
- Use Supabase CLI (it handles shared files automatically)

### Issue: Functions deploy but return 401
**Solution:**
- Check JWT verification is enabled
- Verify JWT token is being sent in Authorization header
- Check function logs for authentication errors

### Issue: Shared files not found
**Solution:**
- Use Supabase CLI (recommended)
- Or manually copy shared file contents into each function (not recommended)

### Issue: CLI not found
**Solution:**
- Install Supabase CLI (see Method 2)
- Or use Dashboard method (Method 1)

---

## Quick Reference: Function Files Location

All function files are in: `supabase/functions/`

```
supabase/functions/
├── admin-user-management/
│   └── index.ts
├── admin-password-reset/
│   └── index.ts
├── get-client-data/
│   └── index.ts
├── secure-storage/
│   └── index.ts
├── manage-client-data/
│   └── index.ts
├── get-investment-reports/
│   └── index.ts
├── manage-investment-reports/
│   └── index.ts
├── get-call-logs/
│   └── index.ts
├── manage-call-logs/
│   └── index.ts
├── get-activity-logs/
│   └── index.ts
└── _shared/
    ├── auth.ts
    ├── password.ts
    ├── passwordValidation.ts
    └── leakedPasswordCheck.ts
```

---

## Next Steps After Deployment

1. ✅ **Enable JWT verification** for all 10 functions
2. ✅ **Run manual tests** (see `MANUAL_TESTING_GUIDE.md`)
3. ✅ **Monitor function logs** for errors
4. ✅ **Test authentication** with real user accounts

---

## Need Help?

- **Supabase Docs:** https://supabase.com/docs/guides/functions
- **CLI Docs:** https://supabase.com/docs/reference/cli
- **Function Examples:** https://github.com/supabase/supabase/tree/master/examples/edge-functions


# Authentication Fixes - Critical Bug Resolution

**Date:** 2025-01-24  
**Status:** ✅ **FIXED** - Critical authentication bugs resolved

---

## 🔴 Critical Issues Fixed

### Issue 1: Session Authentication Failures ✅ FIXED

**Problem:**
- `verifyAuth` function was treating Supabase anon key (service token) as a user JWT
- When anon key was decoded, it had a `sub` claim that wasn't a user ID
- Function tried to look up non-existent user with `.single()`, causing "Cannot coerce" error

**Root Cause:**
```typescript
// OLD CODE (BUGGY):
const payload = JSON.parse(atob(parts[1]));
const userId = payload.sub;  // ❌ Could be anon key's sub, not a user ID!
const { data: user } = await supabase
  .from('custom_users')
  .select('username')
  .eq('id', userId)
  .single();  // ❌ Fails when userId is from anon key!
```

**Fix Applied:**
```typescript
// NEW CODE (FIXED):
const payload = JSON.parse(atob(parts[1]));
const userId = payload.sub;
const role = payload.role;

// ✅ Only process user JWTs, not service tokens
if (userId && role === 'authenticated') {
  const { data: user, error: userError } = await supabase
    .from('custom_users')
    .select('username, id')
    .eq('id', userId)
    .maybeSingle();  // ✅ Use maybeSingle() to avoid errors
  
  if (!userError && user) {
    return { error: null, userId, username: user.username, authMethod: 'jwt' };
  }
}
// ✅ Falls through to session token if JWT is service token or user not found
```

**Changes:**
1. ✅ Added check for `role === 'authenticated'` to only process user JWTs
2. ✅ Changed `.single()` to `.maybeSingle()` to avoid "Cannot coerce" errors
3. ✅ Added proper error handling and logging
4. ✅ Falls back to session token authentication when JWT is service token

---

### Issue 2: HttpOnly Cookie Not Being Sent ✅ IMPROVED

**Problem:**
- Cookies may not be sent cross-origin between *.lovable.app and *.supabase.co
- SameSite=None; Secure cookies may be blocked in some contexts
- No reliable fallback mechanism

**Fix Applied:**
1. ✅ Improved `extractSessionToken` priority:
   - Cookie (primary)
   - `x-session-token` header (reliable cross-origin fallback)
   - Body parameter
   - Authorization header (only if not a JWT)

2. ✅ Better JWT detection:
   - Checks if Authorization header token contains dots (JWT format)
   - Only treats non-JWT tokens as session tokens
   - Prevents confusion between JWTs and session tokens

**Changes:**
```typescript
// NEW: Better token extraction priority
export function extractSessionToken(headers: Headers, body?: { session_token?: string }): string | null {
  // 1. Cookie (primary method)
  // 2. x-session-token header (reliable cross-origin)
  // 3. Body parameter
  // 4. Authorization header (only if not a JWT)
  const authHeader = headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    // ✅ Only treat as session token if it doesn't look like a JWT
    if (!token.includes('.')) {
      return token;
    }
  }
}
```

---

### Issue 3: Error Handling Improvements ✅ FIXED

**Problem:**
- `.single()` throws errors when no rows found
- Errors weren't properly caught and handled
- Poor error messages

**Fix Applied:**
1. ✅ Changed all `.single()` to `.maybeSingle()` in:
   - `verifySession` function
   - `verifyAuth` JWT path
   - User lookup queries

2. ✅ Better error messages:
   - Specific error for "Session not found" (PGRST116)
   - Clear logging for debugging
   - Proper fallback to session token

**Changes:**
```typescript
// OLD: .single() throws error
const { data: session } = await supabase
  .from('user_sessions')
  .select('user_id, expires_at')
  .eq('session_token', sessionToken)
  .single();  // ❌ Throws if not found

// NEW: .maybeSingle() returns null
const { data: session, error: sessionError } = await supabase
  .from('user_sessions')
  .select('user_id, expires_at')
  .eq('session_token', sessionToken)
  .maybeSingle();  // ✅ Returns null if not found
```

---

## 📋 Summary of Changes

### File Modified: `supabase/functions/_shared/auth.ts`

**1. `verifyAuth` function (lines 69-116):**
- ✅ Added check for `role === 'authenticated'` to only process user JWTs
- ✅ Changed `.single()` to `.maybeSingle()` for user lookup
- ✅ Added proper error handling and logging
- ✅ Falls back to session token when JWT is service token

**2. `verifySession` function (lines 21-59):**
- ✅ Changed `.single()` to `.maybeSingle()` for session lookup
- ✅ Changed `.single()` to `.maybeSingle()` for user lookup
- ✅ Added specific error handling for PGRST116 (not found)
- ✅ Better error messages

**3. `extractSessionToken` function (lines 140-171):**
- ✅ Improved priority: Cookie > x-session-token header > body > Authorization
- ✅ Added JWT detection (checks for dots)
- ✅ Only treats non-JWT tokens as session tokens
- ✅ Better comments explaining the logic

---

## 🧪 Testing Recommendations

### Test Cases:

1. **User JWT Authentication:**
   - Send valid user JWT with `role: 'authenticated'`
   - Should authenticate successfully
   - Should return user ID and username

2. **Service Token (Anon Key):**
   - Send Supabase anon key as Bearer token
   - Should NOT try to look up user
   - Should fall back to session token authentication
   - Should NOT throw "Cannot coerce" error

3. **Session Token Authentication:**
   - Send session token in cookie
   - Send session token in `x-session-token` header
   - Send session token in body
   - All should work correctly

4. **Cross-Origin Cookie Handling:**
   - Test from *.lovable.app to *.supabase.co
   - Cookies should be sent if SameSite=None; Secure is set
   - `x-session-token` header should work as fallback

5. **Error Handling:**
   - Invalid session token should return clear error
   - Expired session should return clear error
   - Missing authentication should return clear error

---

## 🚀 Deployment

### Next Steps:

1. ✅ **Code Fixed** - All authentication bugs resolved
2. ⏳ **Deploy to Supabase** - Deploy updated `_shared/auth.ts` to all edge functions
3. ⏳ **Test** - Test authentication with real requests
4. ⏳ **Monitor** - Watch logs for any remaining issues

### Deployment Command:
```bash
# Deploy all functions (they all use _shared/auth.ts)
supabase functions deploy
```

---

## 📊 Impact

### Before Fix:
- ❌ Email Copilot failing with auth errors
- ❌ Q&A Agent not working
- ❌ All edge functions returning 401 errors
- ❌ "Cannot coerce the result to a single JSON object" errors

### After Fix:
- ✅ Email Copilot should work with session tokens
- ✅ Q&A Agent should work with session tokens
- ✅ All edge functions should authenticate correctly
- ✅ No more "Cannot coerce" errors
- ✅ Proper fallback to session token authentication

---

## 🔍 Technical Details

### JWT vs Session Token Detection:

**User JWT:**
- Has `role: 'authenticated'` in payload
- Has `sub` claim that matches a user ID in `custom_users`
- Format: `header.payload.signature` (3 parts with dots)

**Service Token (Anon Key):**
- Has different role claims or no role
- Has `sub` claim that is NOT a user ID
- Format: `header.payload.signature` (3 parts with dots)
- Should NOT be processed as user JWT

**Session Token:**
- UUID or random string
- No dots (not a JWT)
- Stored in `user_sessions` table
- Primary authentication method

---

## ✅ Verification Checklist

- [x] Fixed JWT processing to only handle user JWTs
- [x] Changed `.single()` to `.maybeSingle()` to avoid errors
- [x] Improved session token extraction priority
- [x] Added JWT detection to prevent confusion
- [x] Better error handling and logging
- [x] Proper fallback to session token authentication
- [ ] Deploy to Supabase
- [ ] Test with real requests
- [ ] Monitor logs for issues

---

## 📝 Notes

- The fix maintains backward compatibility
- Session token authentication remains the primary method
- JWT authentication is optional (defense in depth)
- All edge functions using `verifyAuth` will benefit from this fix
- No changes needed to individual edge functions

---

**Status:** ✅ **READY FOR DEPLOYMENT**


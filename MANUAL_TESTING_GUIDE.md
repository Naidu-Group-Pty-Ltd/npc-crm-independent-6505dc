# Manual Testing Guide - Security Changes

**Date:** 2025-01-24  
**Purpose:** Test all security changes after deployment

---

## ⚠️ IMPORTANT: Before Testing

1. **Ensure all edge functions are deployed**
2. **Enable JWT verification in Dashboard for all 10 functions**
3. **Verify migrations are applied** (check Supabase Dashboard → Database → Migrations)

---

## Test Categories

### 1. Authentication & Authorization Tests

#### Test 1.1: JWT Authentication
**Purpose:** Verify JWT tokens work with edge functions

**Steps:**
1. Login to the application
2. Check browser DevTools → Network tab
3. Look for requests to edge functions
4. Verify `Authorization: Bearer <token>` header is present
5. Verify requests succeed (200 status)

**Expected Result:** ✅ Functions accept JWT tokens

**If Failed:**
- Check JWT verification is enabled in Dashboard
- Check function logs for authentication errors

---

#### Test 1.2: Session Token Fallback
**Purpose:** Verify session tokens still work (backward compatibility)

**Steps:**
1. Login to the application
2. Check that session cookies are set
3. Make requests to edge functions
4. Verify requests succeed even without JWT

**Expected Result:** ✅ Functions accept session tokens as fallback

**If Failed:**
- Check `verifyAuth` function is working
- Check session token is being sent correctly

---

#### Test 1.3: Unauthenticated Access Blocked
**Purpose:** Verify unauthenticated requests are rejected

**Steps:**
1. Open browser DevTools → Console
2. Run this in console (replace with your function URL):
```javascript
fetch('https://dduzbchuswwbefdunfct.supabase.co/functions/v1/get-client-data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({})
})
.then(r => r.json())
.then(console.log)
```

**Expected Result:** ❌ Returns 401 Unauthorized

**If Failed:**
- Check function authentication is working
- Check JWT verification is enabled

---

### 2. Password Validation Tests

#### Test 2.1: Weak Password Rejection
**Purpose:** Verify weak passwords are rejected

**Steps:**
1. Go to password reset or user creation
2. Try these passwords:
   - `password` (too common)
   - `12345678` (too simple)
   - `abc` (too short)
   - `password123` (too common)

**Expected Result:** ❌ All rejected with appropriate error messages

**If Failed:**
- Check `validatePasswordStrength` is being called
- Check error messages are displayed

---

#### Test 2.2: Leaked Password Detection
**Purpose:** Verify leaked password check works

**Steps:**
1. Try to set password: `Password123` (known leaked password)
2. Check for error message about data breaches

**Expected Result:** ❌ Password rejected with breach count message

**Note:** This test requires internet connection to Have I Been Pwned API

**If Failed:**
- Check internet connection
- Check Have I Been Pwned API is accessible
- Check function logs for API errors

---

#### Test 2.3: Strong Password Acceptance
**Purpose:** Verify strong passwords are accepted

**Steps:**
1. Try to set password: `MySecureP@ssw0rd2024!`
2. Verify password is accepted

**Expected Result:** ✅ Password accepted

**If Failed:**
- Check password validation logic
- Check all validation rules

---

### 3. RLS Policy Tests

#### Test 3.1: Direct Database Access Blocked
**Purpose:** Verify direct database queries are blocked

**Steps:**
1. Open Supabase Dashboard → SQL Editor
2. Run this query (as authenticated user, not service_role):
```sql
SELECT * FROM client_activities LIMIT 10;
```

**Expected Result:** ❌ Query returns empty or error (RLS blocks access)

**If Failed:**
- Check RLS is enabled on tables
- Check policies were removed correctly

---

#### Test 3.2: Edge Function Access Works
**Purpose:** Verify edge functions can still access data

**Steps:**
1. Login to application
2. Navigate to client data pages
3. Verify data loads correctly

**Expected Result:** ✅ Data loads through edge functions

**If Failed:**
- Check edge functions use service_role
- Check function authentication is working
- Check function logs for errors

---

#### Test 3.3: Financial Data Protection
**Purpose:** Verify financial data is protected

**Steps:**
1. Try to access financial data directly via SQL Editor:
```sql
SELECT * FROM cash_flow_analyses LIMIT 10;
SELECT * FROM portfolio_analysis_reports LIMIT 10;
```

**Expected Result:** ❌ Queries blocked (RLS denies access)

**If Failed:**
- Check financial data migrations were applied
- Check RLS policies were removed

---

### 4. Edge Function Security Tests

#### Test 4.1: Admin Functions Require Superadmin
**Purpose:** Verify admin functions check for superadmin role

**Steps:**
1. Login as regular user (not superadmin)
2. Try to access admin functions:
   - List users
   - Create user
   - Delete user

**Expected Result:** ❌ Returns 403 Forbidden

**If Failed:**
- Check `verifySuperadmin` function
- Check role checking logic

---

#### Test 4.2: Password Reset Requires Authentication
**Purpose:** Verify password reset requires authentication

**Steps:**
1. Without logging in, try to reset password:
   - Request OTP (should work)
   - Verify OTP (should work)
   - Reset password (should require auth)

**Expected Result:** 
- ✅ OTP request works
- ✅ OTP verification works
- ❌ Password reset requires authentication

**If Failed:**
- Check `admin-password-reset` function
- Check authentication is enforced for `reset_password` action

---

### 5. Integration Tests

#### Test 5.1: User Registration Flow
**Purpose:** Test complete user registration with password validation

**Steps:**
1. Create new user account
2. Set password (try weak, then strong)
3. Verify account is created
4. Login with new account

**Expected Result:** ✅ Complete flow works with password validation

---

#### Test 5.2: Password Change Flow
**Purpose:** Test password change with validation

**Steps:**
1. Login to account
2. Go to change password
3. Try weak password (should fail)
4. Try leaked password (should fail)
5. Try strong password (should succeed)

**Expected Result:** ✅ Password change works with all validations

---

#### Test 5.3: Client Data Access Flow
**Purpose:** Test client data access through edge functions

**Steps:**
1. Login to application
2. Navigate to clients page
3. View client details
4. Verify all data loads correctly

**Expected Result:** ✅ All client data accessible through edge functions

---

## Test Checklist

### Authentication
- [ ] JWT tokens work
- [ ] Session tokens work (fallback)
- [ ] Unauthenticated requests blocked
- [ ] Admin functions require superadmin

### Password Validation
- [ ] Weak passwords rejected
- [ ] Leaked passwords detected
- [ ] Strong passwords accepted
- [ ] Error messages clear

### RLS Policies
- [ ] Direct database access blocked
- [ ] Edge function access works
- [ ] Financial data protected
- [ ] Client data protected

### Integration
- [ ] User registration works
- [ ] Password change works
- [ ] Client data access works
- [ ] No broken functionality

---

## Troubleshooting

### Issue: Functions return 401 Unauthorized
**Solution:**
1. Check JWT verification is enabled in Dashboard
2. Check authentication headers are sent
3. Check function logs for errors

### Issue: Password validation not working
**Solution:**
1. Check `validatePasswordStrength` is called
2. Check leaked password API is accessible
3. Check function logs for errors

### Issue: Data not loading
**Solution:**
1. Check RLS policies were applied
2. Check edge functions use service_role
3. Check function authentication is working
4. Check function logs for errors

### Issue: Too many false positives
**Solution:**
1. Check password validation rules
2. Adjust validation thresholds if needed
3. Check leaked password API responses

---

## Success Criteria

✅ **All tests pass**
✅ **No broken functionality**
✅ **Security improvements working**
✅ **User experience maintained**

---

## Reporting Issues

If you find issues:
1. Document the issue
2. Check function logs in Supabase Dashboard
3. Check browser console for errors
4. Note which test failed
5. Provide steps to reproduce

---

## Next Steps After Testing

1. **Monitor logs** for any errors
2. **Monitor user feedback** for issues
3. **Review security advisors** in Supabase Dashboard
4. **Plan additional improvements** if needed


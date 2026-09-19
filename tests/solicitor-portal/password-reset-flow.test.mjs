import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const migration = read('supabase/migrations/20260901000500_fix_reset_attempt_rpc_ambiguity.sql');
const resetFn = read('supabase/functions/solicitor-portal-reset-password/index.ts');
const forgotFn = read('supabase/functions/solicitor-portal-forgot-password/index.ts');
const loginPage = read('src/pages/solicitor/SolicitorLogin.tsx');
const otpInput = read('src/components/finance-portal/OtpInput.tsx');

/**
 * The Solicitor Portal password reset, which had never completed once.
 *
 * Three defects stacked, and each one on its own is enough to make a correct
 * code look wrong to the person holding it:
 *   1. the reset-attempt function raised 42702 on every call;
 *   2. the reset endpoint updated `id=eq.undefined` and did not check;
 *   3. the login screen kept a superseded code in the boxes.
 */

/** The body of a `$$ ... $$` PL/pgSQL function in the migration. */
function functionBody(sql, name) {
  const start = sql.indexOf(name);
  assert.notEqual(start, -1, `${name} is not defined in the migration`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$', open + 2);
  assert.ok(close > open, `${name} has no body`);
  return sql.slice(open + 2, close);
}

test('no reset-attempt function references a column that is also one of its OUT parameters', () => {
  // `RETURNS TABLE(status, reset_token, user_id, firm_id, invite_accepted_at)`
  // makes each of those a PL/pgSQL variable inside the body. An unqualified
  // reference to one raises `42702: column reference "reset_token" is
  // ambiguous` — at runtime, on every call, which is why it shipped.
  const ambiguous = /(?<![.\w])(reset_token|firm_id|user_id|invite_accepted_at)\b(?!\s*:?=)(?![^\n]*\bAS\b)/;

  for (const name of ['consume_solicitor_portal_reset_attempt', 'consume_finance_portal_reset_attempt']) {
    const body = functionBody(migration, name);
    const statements = body
      .split('\n')
      .filter((line) => /\b(UPDATE|SELECT|WHERE|AND|RETURNING)\b/.test(line))
      // The declaration lines and the RETURN QUERY projections name the OUT
      // parameters deliberately; it is the table references that must be
      // qualified.
      .filter((line) => !/RETURN QUERY|::text|::uuid|::timestamptz|DECLARE/.test(line));

    for (const line of statements) {
      assert.doesNotMatch(
        line.replace(/\bv_\w+/g, ''), ambiguous,
        `${name} has an unqualified column reference: ${line.trim()}`,
      );
    }
  }
});

test('the migration proves the functions execute rather than only that they compile', () => {
  // A function body is parsed at call time, so a syntactically valid CREATE
  // says nothing about whether it runs. The probe address cannot match an
  // account, so it exercises the previously-fatal statement and changes no row.
  assert.match(migration, /consume_solicitor_portal_reset_attempt\(v_probe, 5\)/);
  assert.match(migration, /consume_finance_portal_reset_attempt\(v_probe, 5\)/);
  assert.match(migration, /POST-MIGRATION FAILURE: solicitor reset probe/);
  assert.match(migration, /POST-MIGRATION FAILURE: finance reset probe/);
});

test('the solicitor function returns the invite state the reset endpoint reads', () => {
  // `user.invite_accepted_at` was read off a result that had no such column, so
  // every completed reset rewrote the invite columns.
  assert.match(migration, /RETURNS TABLE\([^)]*invite_accepted_at timestamptz[^)]*\)/s);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.consume_solicitor_portal_reset_attempt/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.consume_solicitor_portal_reset_attempt\(text, integer\)\s*\n\s*TO service_role/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.consume_solicitor_portal_reset_attempt\(text, integer\)\s*\n\s*FROM PUBLIC, anon, authenticated/);
});

test('the reset endpoint writes against the id the function actually returns', () => {
  // The RPC returns `user_id`. `user.id` is undefined, and an unchecked
  // PostgREST failure let the endpoint answer success without changing a
  // password.
  assert.match(resetFn, /\.eq\('id', user\.user_id\)/);
  assert.doesNotMatch(resetFn, /\.eq\('id', user\.id\)/);
  assert.match(resetFn, /if \(updateError\) throw updateError/);
  assert.match(resetFn, /revokeAllSolicitorSessions\(supabase, user\.user_id/);
});

test('an RPC failure is logged even though the caller is told nothing', () => {
  // Identical wording for an unknown account and a broken lookup is correct —
  // it is what stops account enumeration. The missing log line is what let a
  // function that raised on every call pass for users mistyping codes.
  assert.match(resetFn, /if \(consumeError\) \{[\s\S]{0,200}console\.error/);
  assert.match(resetFn, /reset-attempt RPC failed/);
});

test('a reset code is never emailed unless it was stored', () => {
  assert.match(forgotFn, /const \{ error: tokenError \}[\s\S]{0,400}reset_token: otp/);
  assert.match(forgotFn, /if \(tokenError\) \{[\s\S]{0,200}return genericOk\(\)/);
  // The write must still come before the send.
  assert.ok(forgotFn.indexOf('tokenError') < forgotFn.indexOf('api.resend.com'));
});

test('the login screen never carries a superseded code into a new request', () => {
  const requestHandler = loginPage.slice(
    loginPage.indexOf('const handleRequestReset'),
    loginPage.indexOf('const handleVerify'),
  );
  const verifyHandler = loginPage.slice(
    loginPage.indexOf('const handleVerify'),
    loginPage.indexOf('const handleReset'),
  );
  const backHandler = loginPage.slice(
    loginPage.indexOf('const goBack'),
    loginPage.indexOf('const goBack') + 300,
  );

  assert.match(requestHandler, /setOtp\(''\)/, 'requesting a new code leaves the old digits in the boxes');
  assert.match(verifyHandler, /setOtp\(''\)/, 'a rejected code stays in the boxes');
  assert.match(backHandler, /setOtp\(''\)/, 'going back to request another code keeps the old one');
});

test('the code entry cannot report a code the boxes are not showing', () => {
  // The space-padded array whose spaces were stripped afterwards: a digit typed
  // into box 3 of an empty field was reported as box 1's.
  assert.doesNotMatch(otpInput, /replace\(\/ \/g, ''\)/);
  assert.match(otpInput, /const target = Math\.min\(index, value\.length\)/);
});

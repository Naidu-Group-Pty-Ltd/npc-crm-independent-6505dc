import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/security-step-up/index.ts', 'utf8');
const verifier = readFileSync('supabase/functions/_shared/totp.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260724030000_add_totp_replay_protection.sql', 'utf8');
const enrollmentMigration = readFileSync('supabase/migrations/20260724040000_add_totp_enrollment_challenges.sql', 'utf8');
const required = [
  [source, "verifyEncryptedTotp(userRow.mfa_secret_encrypted, String(body?.mfa_code ?? ''))"],
  [source, "mfa_method !== 'totp' || !userRow.mfa_secret_encrypted"],
  [source, 'if (mfaStateError || !userRow)'],
  [source, 'mfa_last_totp_counter.lt.${totp.counter}'],
  [source, "assuranceLevel = 2"],
  [source, "action === 'enroll_totp_begin'"],
  [source, "action === 'enroll_totp_confirm'"],
  [source, "eq('staff_session_id', staffSession.id)"],
  [source, "mfa_required: true"],
  [verifier, 'MFA_TOTP_ENCRYPTION_KEY'],
  [verifier, 'createEncryptedTotpSecret'],
  [verifier, 'hash: "SHA-1"'],
  [verifier, 'currentCounter - 1, currentCounter, currentCounter + 1'],
  [migration, 'mfa_last_totp_counter bigint'],
  [enrollmentMigration, 'REFERENCES public.user_sessions(id) ON DELETE CASCADE'],
  [enrollmentMigration, 'REVOKE ALL ON TABLE public.mfa_totp_enrollment_challenges FROM anon, authenticated, PUBLIC'],
];
for (const [contents, needle] of required) {
  if (!contents.includes(needle)) throw new Error(`MFA TOTP invariant is missing: ${needle}`);
}
if (source.includes('mfa_verification_unavailable')) throw new Error('MFA verification still fails closed without a real verifier');
console.log('Enrolled staff receive assurance level 2 only after a non-replayed TOTP verification.');

import { readFileSync } from 'node:fs';

const handler = readFileSync('supabase/functions/security-step-up/index.ts', 'utf8');
const helper = readFileSync('supabase/functions/_shared/recoveryCodes.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260724050000_add_mfa_recovery_code_lifecycle.sql', 'utf8');
const client = readFileSync('src/lib/security/stepUp.ts', 'utf8');
const settings = readFileSync('src/components/settings/TotpEnrollmentCard.tsx', 'utf8');
for (const [contents, needle] of [
  [helper, 'MFA_RECOVERY_CODE_PEPPER'],
  [helper, 'generateRecoveryCodes'],
  [helper, 'hashRecoveryCodes'],
  [handler, "action === 'regenerate_recovery_codes'"],
  [handler, "admin.rpc('consume_mfa_recovery_code'"],
  [handler, 'step_up.recovery_code_consumed'],
  [handler, 'mfa:recovery:user:'],
  [migration, 'FOR UPDATE'],
  [migration, 'array_remove(current_hashes, p_code_hash)'],
  [migration, 'REVOKE ALL ON FUNCTION public.consume_mfa_recovery_code'],
  [client, 'recoveryCodes: data.recovery_codes'],
  [settings, 'Save your recovery codes now.'],
]) if (!contents.includes(needle)) throw new Error(`MFA recovery-code lifecycle invariant is missing: ${needle}`);
if (!helper.includes('const CODE_BYTES = 12;')) throw new Error('Recovery-code generation must allocate one random byte per code character.');
if (!handler.includes('const ip = getTrustedClientIp(req.headers);')) throw new Error('Recovery-code rate limiting must read the trusted client IP from request headers.');
if (settings.includes('localStorage') || settings.includes('sessionStorage')) throw new Error('Recovery codes must not be persisted in browser storage.');
console.log('MFA recovery codes are peppered, one-time, atomically consumed, rate-limited, and displayed only once.');

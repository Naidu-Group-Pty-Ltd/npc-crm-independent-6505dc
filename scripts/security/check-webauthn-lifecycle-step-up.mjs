import { readFileSync } from 'node:fs';

const handler = readFileSync('supabase/functions/security-step-up/index.ts', 'utf8');
const helper = readFileSync('supabase/functions/_shared/stepUp.ts', 'utf8');

function branch(action, nextAction) {
  const start = handler.indexOf(`if (action === '${action}')`);
  const end = handler.indexOf(`if (action === '${nextAction}')`, start + 1);
  if (start < 0 || end < 0) throw new Error(`Unable to locate ${action} branch`);
  return handler.slice(start, end);
}

const remove = branch('webauthn_delete', 'enroll_webauthn_begin');
const begin = branch('enroll_webauthn_begin', 'enroll_webauthn_finish');
const finish = branch('enroll_webauthn_finish', 'webauthn_assertion_begin');

if (!remove.includes("capability: 'mfa.manage'")) throw new Error('WebAuthn deletion is not step-up protected');
if (!begin.includes('mfaState.mfa_enrolled_at') || !begin.includes("capability: 'mfa.manage'")) {
  throw new Error('WebAuthn enrollment begin does not require step-up for an enrolled account');
}
if (!finish.includes('mfaState.mfa_enrolled_at') || !finish.includes("capability: 'mfa.manage'")) {
  throw new Error('WebAuthn enrollment finish does not re-check MFA state and step-up');
}
if (!helper.includes('if (capability === "mfa.manage") return "enforce"')) {
  throw new Error('MFA lifecycle protection can be downgraded to audit-only');
}

console.log('WebAuthn lifecycle requires an enforced, current MFA step-up proof.');

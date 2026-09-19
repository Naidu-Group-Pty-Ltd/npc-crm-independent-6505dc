/**
 * WP-11C — Frontend step-up token store & challenge invoker.
 *
 * Tokens live in sessionStorage under `step_up:<capability>` and are attached
 * to secureInvoke calls that pass a `stepUpCapability` option. Consumers use
 * `ensureStepUp(capability)` which either returns the live token or opens the
 * <StepUpDialog/> to obtain one.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';

export type StepUpCapability =
  | 'role.change'
  | 'role.remove'
  | 'mfa.manage'
  | 'aml.role.set'
  | 'secrets.update'
  | 'commission.payout.generate'
  | 'commission.payout.mark_paid'
  | 'commission.payout.cancel'
  | 'docusign.send'
  | 'docusign.void'
  | 'storage.destructive'
  | 'mailbox.destructive';

interface Stored { token: string; expires_at: string; }

const KEY = (cap: string) => `step_up:${cap}`;

export function getStepUpToken(capability: string): string | null {
  try {
    const raw = sessionStorage.getItem(KEY(capability));
    if (!raw) return null;
    const p = JSON.parse(raw) as Stored;
    if (!p?.token || !p?.expires_at) return null;
    if (new Date(p.expires_at).getTime() <= Date.now() + 5_000) return null;
    return p.token;
  } catch { return null; }
}

export function storeStepUpToken(capability: string, token: string, expires_at: string) {
  try { sessionStorage.setItem(KEY(capability), JSON.stringify({ token, expires_at })); } catch {}
}

export function clearStepUpToken(capability?: string) {
  try {
    if (capability) sessionStorage.removeItem(KEY(capability));
    else {
      Object.keys(sessionStorage).forEach((k) => k.startsWith('step_up:') && sessionStorage.removeItem(k));
    }
  } catch {}
}

export async function requestStepUpChallenge(
  capability: string,
  password: string,
  mfaCode?: string,
): Promise<{ ok: true; token: string; expires_at: string } | { ok: false; error: string }> {
  const { data, error } = await invokeSecureFunction<any>('security-step-up', {
    action: 'challenge',
    capability,
    password,
    ...(mfaCode ? { mfa_code: mfaCode } : {}),
  });
  if (error) return { ok: false, error: error.message ?? 'challenge_failed' };
  if (!data?.success) return { ok: false, error: data?.error ?? 'challenge_failed' };
  storeStepUpToken(capability, data.token, data.expires_at);
  return { ok: true, token: data.token, expires_at: data.expires_at };
}

export async function revokeStepUpSessions(capability?: string) {
  clearStepUpToken(capability);
  await invokeSecureFunction('security-step-up', { action: 'revoke', capability }).catch(() => {});
}

export async function beginTotpEnrollment(password: string) {
  const { data, error } = await invokeSecureFunction<any>('security-step-up', { action: 'enroll_totp_begin', password });
  if (error || !data?.success) return { ok: false as const, error: error?.message ?? data?.error ?? 'mfa_enrollment_failed' };
  return { ok: true as const, enrollmentToken: data.enrollment_token as string, otpauthUri: data.otpauth_uri as string, expiresAt: data.expires_at as string };
}

export async function confirmTotpEnrollment(enrollmentToken: string, mfaCode: string) {
  const { data, error } = await invokeSecureFunction<any>('security-step-up', { action: 'enroll_totp_confirm', enrollment_token: enrollmentToken, mfa_code: mfaCode });
  if (error || !data?.success || !Array.isArray(data?.recovery_codes)) return { ok: false as const, error: error?.message ?? data?.error ?? 'mfa_enrollment_failed' };
  return { ok: true as const, recoveryCodes: data.recovery_codes as string[] };
}

/** Regeneration invalidates every previous recovery code and returns the replacement set once. */
export async function regenerateRecoveryCodes(password: string, mfaCode: string) {
  const { data, error } = await invokeSecureFunction<any>('security-step-up', { action: 'regenerate_recovery_codes', password, mfa_code: mfaCode });
  if (error || !data?.success || !Array.isArray(data?.recovery_codes)) return { ok: false as const, error: error?.message ?? data?.error ?? 'mfa_recovery_regeneration_failed' };
  return { ok: true as const, recoveryCodes: data.recovery_codes as string[] };
}

// ---------------- WebAuthn (passkey / security key) ----------------

import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';

export const webauthnSupported = () => {
  try { return browserSupportsWebAuthn(); } catch { return false; }
};

export interface WebAuthnCredentialRow {
  id: string;
  credential_id: string;
  device_name: string | null;
  device_type: string | null;
  backed_up: boolean | null;
  transports: string[] | null;
  last_used_at: string | null;
  created_at: string;
}

export async function listWebAuthnCredentials() {
  const { data, error } = await invokeSecureFunction<any>('security-step-up', { action: 'webauthn_list' });
  if (error || !data?.success) return { ok: false as const, error: error?.message ?? data?.error ?? 'webauthn_list_failed' };
  return { ok: true as const, credentials: (data.credentials ?? []) as WebAuthnCredentialRow[] };
}

export async function deleteWebAuthnCredential(credentialRowId: string, stepUpToken: string) {
  const { data, error } = await invokeSecureFunction<any>('security-step-up', { action: 'webauthn_delete', credential_id: credentialRowId, step_up_token: stepUpToken });
  if (error || !data?.success) return { ok: false as const, error: error?.message ?? data?.error ?? 'webauthn_delete_failed' };
  return { ok: true as const };
}

export async function enrollWebAuthn(password: string, deviceName?: string, stepUpToken?: string) {
  const stepUp = stepUpToken ? { step_up_token: stepUpToken } : {};
  const begin = await invokeSecureFunction<any>('security-step-up', { action: 'enroll_webauthn_begin', password, ...stepUp });
  if (begin.error || !begin.data?.success) return { ok: false as const, error: begin.error?.message ?? begin.data?.error ?? 'webauthn_begin_failed' };
  let attResp;
  try {
    attResp = await startRegistration(begin.data.options);
  } catch (e: any) {
    return { ok: false as const, error: e?.name === 'InvalidStateError' ? 'This authenticator is already registered.' : (e?.message ?? 'webauthn_cancelled') };
  }
  const finish = await invokeSecureFunction<any>('security-step-up', {
    action: 'enroll_webauthn_finish',
    enrollment_token: begin.data.enrollment_token,
    credential: attResp,
    device_name: deviceName ?? null,
    ...stepUp,
  });
  if (finish.error || !finish.data?.success) return { ok: false as const, error: finish.error?.message ?? finish.data?.error ?? 'webauthn_finish_failed' };
  return { ok: true as const };
}

/**
 * Run a WebAuthn assertion for a step-up capability, then call `challenge`
 * with the resulting token + assertion payload. Returns the freshly minted
 * step-up token which is also stored under `step_up:<capability>`.
 */
export async function requestStepUpWithWebAuthn(
  capability: string,
  password: string,
): Promise<{ ok: true; token: string; expires_at: string } | { ok: false; error: string }> {
  const begin = await invokeSecureFunction<any>('security-step-up', { action: 'webauthn_assertion_begin', capability });
  if (begin.error || !begin.data?.success) return { ok: false, error: begin.error?.message ?? begin.data?.error ?? 'webauthn_begin_failed' };
  let assertion;
  try {
    assertion = await startAuthentication(begin.data.options);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'webauthn_cancelled' };
  }
  const { data, error } = await invokeSecureFunction<any>('security-step-up', {
    action: 'challenge',
    capability,
    password,
    assertion_token: begin.data.assertion_token,
    assertion,
  });
  if (error) return { ok: false, error: error.message ?? 'challenge_failed' };
  if (!data?.success) return { ok: false, error: data?.error ?? 'challenge_failed' };
  storeStepUpToken(capability, data.token, data.expires_at);
  return { ok: true, token: data.token, expires_at: data.expires_at };
}

/**
 * WP-11C — Step-up authentication challenge.
 *
 * Verifies the caller's password (or MFA code when enrolled) and mints a
 * short-lived recent-reauth token bound to a specific capability. The
 * plaintext token is returned once; only its SHA-256 hash (with server
 * pepper) is stored in `public.step_up_sessions`.
 *
 * Actions:
 *   - enroll_totp_begin → { password } → one-time provisioning URI/token
 *   - enroll_totp_confirm → { enrollment_token, mfa_code } → activate TOTP
 *   - regenerate_recovery_codes → { password, mfa_code } → replacement codes
 *   - challenge  → { capability, password } / optional { mfa_code | recovery_code }
 *                → { success, token, expires_at, capability }
 *   - revoke     → { capability?, all? } → revoke active step-up sessions
 *
 * Enforcement (blocking behavior for consumers) is controlled by the
 * STEP_UP_ENFORCED env var in `_shared/stepUp.ts`. This function only
 * issues/revokes proofs.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders, createSessionCookie } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { rotateSession } from '../_shared/sessionRotate.ts';
import { verifyPassword } from '../_shared/password.ts';
import { generateStepUpToken, hashStepUpToken, requireStepUp, resolveActiveStaffSession } from '../_shared/stepUp.ts';
import { createEncryptedTotpSecret, verifyEncryptedTotp } from '../_shared/totp.ts';
import { generateRecoveryCodes, hashRecoveryCode, hashRecoveryCodes, isRecoveryCode, isRecoveryCodeHashConfigured } from '../_shared/recoveryCodes.ts';
import { consumeRateLimit, getTrustedClientIp } from '../_shared/requestSecurity.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  loadWebAuthnConfig,
  buildRegistrationOptions,
  verifyRegistration,
  buildAssertionOptions,
  verifyAssertion,
} from '../_shared/webauthn.ts';

const STEP_UP_TTL_MS = 15 * 60 * 1000; // 15 min
const RECOVERY_CODE_ATTEMPTS_PER_WINDOW = 5;
const RECOVERY_CODE_WINDOW_SECONDS = 15 * 60;

async function verifyUserPassword(admin: any, userId: string, plaintext: string): Promise<boolean> {
  if (!plaintext || plaintext.length < 4) return false;
  const { data } = await admin
    .from('custom_users')
    .select('password_hash')
    .eq('id', userId)
    .maybeSingle();
  if (!data?.password_hash) return false;
  try { return await verifyPassword(plaintext, data.password_hash); } catch { return false; }
}

function encodeOtpAuthLabel(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '%20');
}

Deno.serve(async (req) => {
  // The CALLER's origin. This was a module-level `createCorsHeaders()` — a
  // constant computed at import time, when no request exists — so it answered
  // a FIXED `Access-Control-Allow-Origin` beside
  // `Access-Control-Allow-Credentials: true`. The browser releases a
  // credentialed response to JS only when the ACAO exactly equals the
  // request's Origin, so this function answered for one of the origins the
  // deployment trusts and failed the preflight for every other, with `fetch`
  // rejecting opaquely.
  // Step-up MFA gates AUSTRAC lodgement and AML configuration, so a browser
  // that cannot reach it cannot perform those acts at all.
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const j = (data: any, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId) {
      return createUnauthorizedResponse(auth.error || 'Auth required', corsHeaders);
    }

    // A step-up proof is meaningful only within a verified staff session. Do
    // not accept a client-supplied session ID; resolve the presented session
    // token against user_sessions and bind the proof to that authoritative row.
    const staffSession = await resolveActiveStaffSession(admin, auth.userId, req, body);
    if (!staffSession) {
      return j({ success: false, error: 'staff_session_required', code: 'staff_session_required' }, 401);
    }

    const action = String(body?.action ?? 'challenge');

    if (action === 'revoke') {
      const q = admin.from('step_up_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', auth.userId)
        .is('revoked_at', null);
      if (body?.capability) q.eq('capability', body.capability);
      const { error } = await q;
      if (error) return j({ success: false, error: error.message }, 500);
      return j({ success: true });
    }

    if (action === 'enroll_totp_begin') {
      if (!await verifyUserPassword(admin, auth.userId, String(body?.password ?? ''))) {
        return j({ success: false, error: 'invalid_credentials' }, 401);
      }
      const { data: existing, error: existingError } = await admin
        .from('custom_users')
        .select('mfa_enrolled_at')
        .eq('id', auth.userId)
        .maybeSingle();
      if (existingError || !existing) return j({ success: false, error: 'mfa_state_unavailable' }, 503);
      if (existing.mfa_enrolled_at) return j({ success: false, error: 'mfa_already_enrolled' }, 409);

      const generated = await createEncryptedTotpSecret();
      if (!generated) return j({ success: false, error: 'mfa_configuration_invalid' }, 503);
      const enrollmentToken = generateStepUpToken(32);
      const tokenHash = await hashStepUpToken(auth.userId, 'totp.enrollment', enrollmentToken);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await admin.from('mfa_totp_enrollment_challenges').delete().eq('user_id', auth.userId);
      const { error: insertError } = await admin.from('mfa_totp_enrollment_challenges').insert({
        user_id: auth.userId,
        staff_session_id: staffSession.id,
        token_hash: tokenHash,
        encrypted_secret: generated.encryptedSecret,
        expires_at: expiresAt,
      });
      if (insertError) return j({ success: false, error: 'mfa_enrollment_unavailable' }, 503);
      const accountLabel = encodeOtpAuthLabel(auth.username || auth.userId);
      const issuer = encodeOtpAuthLabel('NPC Property Dashboard');
      const otpauthUri = `otpauth://totp/${issuer}:${accountLabel}?secret=${generated.secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
      try {
        await admin.from('security_events').insert({ action: 'mfa.totp_enrollment_started', decision: 'allow', actor_type: 'human', actor_id: auth.userId, metadata_redacted: { staff_session_id: staffSession.id } });
      } catch { /* ignore */ }
      return j({ success: true, enrollment_token: enrollmentToken, otpauth_uri: otpauthUri, expires_at: expiresAt });
    }

    if (action === 'enroll_totp_confirm') {
      const enrollmentToken = String(body?.enrollment_token ?? '');
      const mfaCode = String(body?.mfa_code ?? '');
      if (enrollmentToken.length < 16 || !/^\d{6}$/.test(mfaCode)) {
        return j({ success: false, error: 'invalid_enrollment_confirmation' }, 400);
      }
      const tokenHash = await hashStepUpToken(auth.userId, 'totp.enrollment', enrollmentToken);
      const { data: challenge, error: challengeError } = await admin
        .from('mfa_totp_enrollment_challenges')
        .select('id, encrypted_secret, expires_at, staff_session_id')
        .eq('user_id', auth.userId)
        .eq('token_hash', tokenHash)
        .eq('staff_session_id', staffSession.id)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (challengeError || !challenge) return j({ success: false, error: 'invalid_enrollment_confirmation' }, 401);
      const verification = await verifyEncryptedTotp(challenge.encrypted_secret, mfaCode);
      if (!verification.valid) return j({ success: false, error: 'invalid_mfa_code' }, 401);
      // Fail before consuming the enrollment challenge when the recovery-code
      // pepper is unavailable, so staff can retry safely after configuration is fixed.
      if (!isRecoveryCodeHashConfigured()) return j({ success: false, error: 'mfa_configuration_invalid' }, 503);
      const recoveryCodes = generateRecoveryCodes();
      const recoveryCodeHashes = await hashRecoveryCodes(auth.userId, recoveryCodes);
      if (!recoveryCodeHashes) return j({ success: false, error: 'mfa_configuration_invalid' }, 503);
      // Consume the one-time enrollment record before enabling MFA. A concurrent
      // confirmation cannot then activate a secret twice or race a replacement.
      const { data: consumed, error: consumeError } = await admin
        .from('mfa_totp_enrollment_challenges')
        .delete()
        .eq('id', challenge.id)
        .eq('staff_session_id', staffSession.id)
        .select('id')
        .maybeSingle();
      if (consumeError || !consumed) return j({ success: false, error: 'invalid_enrollment_confirmation' }, 401);
      const { data: activated, error: activateError } = await admin
        .from('custom_users')
        .update({
          mfa_enrolled_at: new Date().toISOString(),
          mfa_method: 'totp',
          mfa_secret_encrypted: challenge.encrypted_secret,
          mfa_last_verified_at: new Date().toISOString(),
          mfa_last_totp_counter: verification.counter,
          mfa_recovery_codes_hash: recoveryCodeHashes,
          mfa_required: true,
        })
        .eq('id', auth.userId)
        .is('mfa_enrolled_at', null)
        .select('id')
        .maybeSingle();
      if (activateError || !activated) return j({ success: false, error: 'mfa_enrollment_conflict' }, 409);
      try {
        await admin.from('security_events').insert({ action: 'mfa.totp_enrolled', decision: 'allow', actor_type: 'human', actor_id: auth.userId, metadata_redacted: { staff_session_id: staffSession.id } });
      } catch { /* ignore */ }
      return j({ success: true, method: 'totp', recovery_codes: recoveryCodes });
    }

    if (action === 'regenerate_recovery_codes') {
      if (!await verifyUserPassword(admin, auth.userId, String(body?.password ?? ''))) return j({ success: false, error: 'invalid_credentials' }, 401);
      if (!isRecoveryCodeHashConfigured()) return j({ success: false, error: 'mfa_configuration_invalid' }, 503);
      const { data: userRow } = await admin.from('custom_users').select('mfa_enrolled_at, mfa_method, mfa_secret_encrypted, mfa_last_totp_counter').eq('id', auth.userId).maybeSingle();
      if (!userRow?.mfa_enrolled_at || userRow.mfa_method !== 'totp' || !userRow.mfa_secret_encrypted) return j({ success: false, error: 'mfa_configuration_invalid' }, 503);
      const totp = await verifyEncryptedTotp(userRow.mfa_secret_encrypted, String(body?.mfa_code ?? ''));
      if (!totp.valid) return j({ success: false, error: 'invalid_mfa_code' }, 401);
      const rate = await consumeRateLimit(admin, `mfa:recovery-regenerate:user:${auth.userId}`, 3, 60 * 60);
      if (!rate.allowed) return j({ success: false, error: 'rate_limited' }, 429);
      const recoveryCodes = generateRecoveryCodes();
      const recoveryCodeHashes = await hashRecoveryCodes(auth.userId, recoveryCodes);
      if (!recoveryCodeHashes) return j({ success: false, error: 'mfa_configuration_invalid' }, 503);
      const { data: updated, error } = await admin.from('custom_users').update({ mfa_recovery_codes_hash: recoveryCodeHashes, mfa_last_verified_at: new Date().toISOString(), mfa_last_totp_counter: totp.counter }).eq('id', auth.userId).or(`mfa_last_totp_counter.is.null,mfa_last_totp_counter.lt.${totp.counter}`).select('id').maybeSingle();
      if (error || !updated) return j({ success: false, error: 'mfa_code_replayed' }, 401);
      try { await admin.from('security_events').insert({ action: 'mfa.recovery_codes_regenerated', decision: 'allow', actor_type: 'human', actor_id: auth.userId, metadata_redacted: { staff_session_id: staffSession.id, count: recoveryCodes.length } }); } catch { /* ignore */ }
      return j({ success: true, recovery_codes: recoveryCodes });
    }

    // ---------------- WebAuthn (passkey) lifecycle ----------------
    if (action === 'webauthn_list') {
      const { data: creds } = await admin.from('user_webauthn_credentials')
        .select('id, credential_id, device_name, device_type, backed_up, transports, last_used_at, created_at')
        .eq('user_id', auth.userId)
        .order('created_at', { ascending: false });
      return j({ success: true, credentials: creds ?? [] });
    }

    if (action === 'webauthn_delete') {
      const credentialRowId = String(body?.credential_id ?? '');
      if (!credentialRowId) return j({ success: false, error: 'credential_id_required' }, 400);
      const gate = await requireStepUp(admin, { userId: auth.userId, capability: 'mfa.manage', req, body });
      if (gate) return gate;
      const { error } = await admin.from('user_webauthn_credentials')
        .delete()
        .eq('user_id', auth.userId)
        .eq('id', credentialRowId);
      if (error) return j({ success: false, error: 'delete_failed' }, 500);
      // If this was the last webauthn credential, clear webauthn_enrolled_at.
      const { count } = await admin.from('user_webauthn_credentials')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', auth.userId);
      if ((count ?? 0) === 0) {
        // A passkey-only account must not remain marked as MFA-enrolled after
        // its final credential is removed. Preserve TOTP enrollment, if any.
        await admin.from('custom_users').update({ webauthn_enrolled_at: null }).eq('id', auth.userId);
        await admin.from('custom_users')
          .update({ mfa_enrolled_at: null, mfa_method: null, mfa_required: false })
          .eq('id', auth.userId)
          .eq('mfa_method', 'webauthn');
      }
      try { await admin.from('security_events').insert({ action: 'mfa.webauthn_removed', decision: 'allow', actor_type: 'human', actor_id: auth.userId, metadata_redacted: { staff_session_id: staffSession.id, credential_row_id: credentialRowId } }); } catch { /* ignore */ }
      return j({ success: true });
    }

    if (action === 'enroll_webauthn_begin') {
      const cfg = loadWebAuthnConfig();
      if (!cfg) return j({ success: false, error: 'webauthn_not_configured' }, 503);
      if (!await verifyUserPassword(admin, auth.userId, String(body?.password ?? ''))) {
        return j({ success: false, error: 'invalid_credentials' }, 401);
      }
      // A password alone must not be able to add a second authentication
      // factor to an MFA-protected account. A current MFA proof is required.
      const { data: mfaState, error: mfaStateError } = await admin
        .from('custom_users')
        .select('mfa_enrolled_at')
        .eq('id', auth.userId)
        .maybeSingle();
      if (mfaStateError || !mfaState) return j({ success: false, error: 'mfa_state_unavailable' }, 503);
      if (mfaState.mfa_enrolled_at) {
        const gate = await requireStepUp(admin, { userId: auth.userId, capability: 'mfa.manage', req, body });
        if (gate) return gate;
      }
      const { data: existing } = await admin.from('user_webauthn_credentials')
        .select('credential_id').eq('user_id', auth.userId);
      const options = await buildRegistrationOptions({
        cfg,
        userId: auth.userId,
        userName: auth.username || auth.userId,
        existingCredentialIds: (existing ?? []).map((r: any) => r.credential_id),
      });
      const enrollmentToken = generateStepUpToken(32);
      const tokenHash = await hashStepUpToken(auth.userId, 'webauthn.registration', enrollmentToken);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await admin.from('mfa_webauthn_challenges')
        .delete()
        .eq('user_id', auth.userId)
        .eq('purpose', 'registration');
      const { error: insErr } = await admin.from('mfa_webauthn_challenges').insert({
        user_id: auth.userId,
        staff_session_id: staffSession.id,
        purpose: 'registration',
        challenge_b64url: options.challenge,
        token_hash: tokenHash,
        expires_at: expiresAt,
      });
      if (insErr) return j({ success: false, error: 'webauthn_challenge_unavailable' }, 503);
      return j({ success: true, enrollment_token: enrollmentToken, options, expires_at: expiresAt });
    }

    if (action === 'enroll_webauthn_finish') {
      const cfg = loadWebAuthnConfig();
      if (!cfg) return j({ success: false, error: 'webauthn_not_configured' }, 503);
      const enrollmentToken = String(body?.enrollment_token ?? '');
      const clientResponse = body?.credential;
      const deviceName = typeof body?.device_name === 'string' ? String(body.device_name).slice(0, 120) : null;
      if (enrollmentToken.length < 16 || !clientResponse?.id) {
        return j({ success: false, error: 'invalid_registration' }, 400);
      }
      const tokenHash = await hashStepUpToken(auth.userId, 'webauthn.registration', enrollmentToken);
      const { data: challenge } = await admin.from('mfa_webauthn_challenges')
        .select('id, challenge_b64url, expires_at, staff_session_id')
        .eq('user_id', auth.userId)
        .eq('purpose', 'registration')
        .eq('token_hash', tokenHash)
        .eq('staff_session_id', staffSession.id)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (!challenge) return j({ success: false, error: 'invalid_registration' }, 401);
      // Re-check MFA state at completion so an enrollment begun before another
      // factor was activated cannot bypass current-factor verification.
      const { data: mfaState, error: mfaStateError } = await admin.from('custom_users')
        .select('mfa_enrolled_at')
        .eq('id', auth.userId)
        .maybeSingle();
      if (mfaStateError || !mfaState) return j({ success: false, error: 'mfa_state_unavailable' }, 503);
      if (mfaState.mfa_enrolled_at) {
        const gate = await requireStepUp(admin, { userId: auth.userId, capability: 'mfa.manage', req, body });
        if (gate) return gate;
      }
      const verified = await verifyRegistration({ cfg, expectedChallenge: challenge.challenge_b64url, response: clientResponse });
      if (!verified) return j({ success: false, error: 'webauthn_verification_failed' }, 401);
      // Consume the challenge before persisting the credential.
      await admin.from('mfa_webauthn_challenges').delete().eq('id', challenge.id);
      const { error: credErr } = await admin.from('user_webauthn_credentials').insert({
        user_id: auth.userId,
        credential_id: verified.credentialId,
        public_key: verified.publicKey,
        counter: verified.counter,
        transports: Array.isArray(clientResponse?.response?.transports) ? clientResponse.response.transports : [],
        aaguid: verified.aaguid,
        device_type: verified.deviceType,
        backed_up: verified.backedUp,
        device_name: deviceName,
      });
      if (credErr) return j({ success: false, error: 'credential_persist_failed', detail: credErr.message }, 500);
      const enrolledAt = new Date().toISOString();
      // Keep the separate timestamp for credential lifecycle UI, and make a
      // passkey the active MFA method when no other MFA method is enrolled.
      // Do not replace an existing TOTP enrollment: both factors may be used
      // for step-up, while TOTP remains the account's recovery configuration.
      const { error: webauthnStateError } = await admin.from('custom_users')
        .update({ webauthn_enrolled_at: enrolledAt })
        .eq('id', auth.userId);
      if (webauthnStateError) return j({ success: false, error: 'mfa_state_unavailable' }, 503);
      const { error: mfaActivationError } = await admin.from('custom_users')
        .update({ mfa_enrolled_at: enrolledAt, mfa_method: 'webauthn', mfa_required: true })
        .eq('id', auth.userId)
        .is('mfa_enrolled_at', null);
      if (mfaActivationError) return j({ success: false, error: 'mfa_state_unavailable' }, 503);
      try { await admin.from('security_events').insert({ action: 'mfa.webauthn_enrolled', decision: 'allow', actor_type: 'human', actor_id: auth.userId, metadata_redacted: { staff_session_id: staffSession.id, device_type: verified.deviceType } }); } catch { /* ignore */ }
      return j({ success: true, method: 'webauthn' });
    }

    if (action === 'webauthn_assertion_begin') {
      const cfg = loadWebAuthnConfig();
      if (!cfg) return j({ success: false, error: 'webauthn_not_configured' }, 503);
      const capability = String(body?.capability ?? '').trim();
      if (!capability || capability.length > 64) return j({ success: false, error: 'capability_required' }, 400);
      const { data: creds } = await admin.from('user_webauthn_credentials')
        .select('credential_id').eq('user_id', auth.userId);
      if (!creds || creds.length === 0) return j({ success: false, error: 'no_webauthn_credentials' }, 404);
      const options = await buildAssertionOptions({
        cfg,
        allowCredentialIds: creds.map((r: any) => r.credential_id),
      });
      const assertionToken = generateStepUpToken(32);
      const tokenHash = await hashStepUpToken(auth.userId, `webauthn.assertion:${capability}`, assertionToken);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await admin.from('mfa_webauthn_challenges')
        .delete()
        .eq('user_id', auth.userId)
        .eq('purpose', 'assertion');
      const { error: insErr } = await admin.from('mfa_webauthn_challenges').insert({
        user_id: auth.userId,
        staff_session_id: staffSession.id,
        purpose: 'assertion',
        challenge_b64url: options.challenge,
        token_hash: tokenHash,
        capability,
        expires_at: expiresAt,
      });
      if (insErr) return j({ success: false, error: 'webauthn_challenge_unavailable' }, 503);
      return j({ success: true, assertion_token: assertionToken, options, expires_at: expiresAt });
    }

    if (action !== 'challenge') return j({ success: false, error: 'unknown_action' }, 400);

    const capability = String(body?.capability ?? '').trim();
    if (!capability || capability.length > 64) {
      return j({ success: false, error: 'capability_required' }, 400);
    }

    const password = String(body?.password ?? '');
    const ok = await verifyUserPassword(admin, auth.userId, password);
    if (!ok) {
      try {
        await admin.from('security_events').insert({ action: 'step_up.challenge_failed', decision: 'deny', actor_type: 'human', actor_id: auth.userId, reason_code: 'bad_password', metadata_redacted: { capability } });
      } catch { /* ignore */ }
      return j({ success: false, error: 'invalid_credentials' }, 401);
    }

    // Password establishes knowledge; enrolled staff must also prove their
    // registered TOTP possession before a high-assurance proof is minted.
    const { data: userRow, error: mfaStateError } = await admin
      .from('custom_users')
      .select('mfa_enrolled_at, mfa_required, mfa_method, mfa_secret_encrypted, mfa_last_totp_counter, mfa_recovery_codes_hash')
      .eq('id', auth.userId)
      .maybeSingle();
    // A schema/configuration failure must never silently downgrade an enrolled
    // account to password-only step-up.
    if (mfaStateError || !userRow) {
      return j({ success: false, error: 'mfa_state_unavailable', code: 'mfa_verification_required' }, 503);
    }
    if (userRow?.mfa_required && !userRow?.mfa_enrolled_at) {
      return j({ success: false, error: 'mfa_enrollment_required', code: 'mfa_enrollment_required' }, 403);
    }
    let method = 'password';
    let assuranceLevel = 1;
    if (userRow?.mfa_enrolled_at) {
      const suppliedAssertionToken = typeof body?.assertion_token === 'string' ? String(body.assertion_token) : '';
      const suppliedAssertion = body?.assertion;
      if (userRow.mfa_method === 'webauthn' && suppliedAssertionToken && suppliedAssertion?.id) {
        // WebAuthn assertion path (passkey / security key)
        const cfg = loadWebAuthnConfig();
        if (!cfg) return j({ success: false, error: 'webauthn_not_configured', code: 'mfa_verification_required' }, 503);
        const tokenHash = await hashStepUpToken(auth.userId, `webauthn.assertion:${capability}`, suppliedAssertionToken);
        const { data: challenge } = await admin.from('mfa_webauthn_challenges')
          .select('id, challenge_b64url, staff_session_id, capability')
          .eq('user_id', auth.userId)
          .eq('purpose', 'assertion')
          .eq('token_hash', tokenHash)
          .eq('staff_session_id', staffSession.id)
          .eq('capability', capability)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle();
        if (!challenge) return j({ success: false, error: 'invalid_assertion', code: 'mfa_verification_required' }, 401);
        const { data: credRow } = await admin.from('user_webauthn_credentials')
          .select('id, credential_id, public_key, counter, transports')
          .eq('user_id', auth.userId)
          .eq('credential_id', suppliedAssertion.id)
          .maybeSingle();
        if (!credRow) return j({ success: false, error: 'unknown_credential', code: 'mfa_verification_required' }, 401);
        const verified = await verifyAssertion({
          cfg,
          expectedChallenge: challenge.challenge_b64url,
          response: suppliedAssertion,
          credential: {
            id: credRow.id,
            credential_id: credRow.credential_id,
            public_key: credRow.public_key as unknown as Uint8Array,
            counter: Number(credRow.counter ?? 0),
            transports: Array.isArray(credRow.transports) ? credRow.transports : [],
          },
        });
        if (!verified) {
          try { await admin.from('security_events').insert({ action: 'step_up.webauthn_failed', decision: 'deny', actor_type: 'human', actor_id: auth.userId, reason_code: 'invalid_assertion', metadata_redacted: { capability } }); } catch { /* ignore */ }
          return j({ success: false, error: 'invalid_assertion', code: 'mfa_verification_required' }, 401);
        }
        // Consume challenge and bump counter atomically-ish.
        await admin.from('mfa_webauthn_challenges').delete().eq('id', challenge.id);
        await admin.from('user_webauthn_credentials')
          .update({ counter: verified.newCounter, last_used_at: new Date().toISOString() })
          .eq('id', credRow.id);
        method = 'password+webauthn';
        assuranceLevel = 2;
        try { await admin.from('security_events').insert({ action: 'step_up.webauthn_verified', decision: 'allow', actor_type: 'human', actor_id: auth.userId, metadata_redacted: { capability, staff_session_id: staffSession.id, credential_row_id: credRow.id } }); } catch { /* ignore */ }
      } else if (userRow.mfa_method === 'totp' && userRow.mfa_secret_encrypted) {
        const suppliedFactor = String(body?.mfa_code || body?.recovery_code || '');
        const recoveryCode = isRecoveryCode(suppliedFactor);
        if (recoveryCode) {
          const hash = await hashRecoveryCode(auth.userId, suppliedFactor);
          const ip = getTrustedClientIp(req.headers);
          const userRate = await consumeRateLimit(admin, `mfa:recovery:user:${auth.userId}`, RECOVERY_CODE_ATTEMPTS_PER_WINDOW, RECOVERY_CODE_WINDOW_SECONDS);
          const ipRate = ip ? await consumeRateLimit(admin, `mfa:recovery:ip:${ip}`, RECOVERY_CODE_ATTEMPTS_PER_WINDOW, RECOVERY_CODE_WINDOW_SECONDS) : { allowed: true };
          if (!userRate.allowed || !ipRate.allowed || !hash) return j({ success: false, error: !hash ? 'mfa_configuration_invalid' : 'rate_limited', code: 'mfa_verification_required' }, !hash ? 503 : 429);
          const { data: consumed, error: consumeError } = await admin.rpc('consume_mfa_recovery_code', { p_user_id: auth.userId, p_code_hash: hash });
          if (consumeError || consumed !== true) {
            try { await admin.from('security_events').insert({ action: 'step_up.recovery_code_failed', decision: 'deny', actor_type: 'human', actor_id: auth.userId, reason_code: 'invalid_or_used_recovery_code', metadata_redacted: { capability } }); } catch { /* ignore */ }
            return j({ success: false, error: 'invalid_mfa_code', code: 'mfa_verification_required' }, 401);
          }
          method = 'password+recovery_code';
          assuranceLevel = 2;
          try { await admin.from('security_events').insert({ action: 'step_up.recovery_code_consumed', decision: 'allow', actor_type: 'human', actor_id: auth.userId, metadata_redacted: { capability, staff_session_id: staffSession.id } }); } catch { /* ignore */ }
        } else {
          const totp = await verifyEncryptedTotp(userRow.mfa_secret_encrypted, suppliedFactor);
          if (!totp.valid) {
            try { await admin.from('security_events').insert({ action: 'step_up.mfa_failed', decision: 'deny', actor_type: 'human', actor_id: auth.userId, reason_code: 'invalid_totp', metadata_redacted: { capability } }); } catch { /* ignore */ }
            return j({ success: false, error: 'invalid_mfa_code', code: 'mfa_verification_required' }, 401);
          }
          const { data: updatedMfa, error: updateMfaError } = await admin.from('custom_users').update({ mfa_last_verified_at: new Date().toISOString(), mfa_last_totp_counter: totp.counter }).eq('id', auth.userId).or(`mfa_last_totp_counter.is.null,mfa_last_totp_counter.lt.${totp.counter}`).select('id').maybeSingle();
          if (updateMfaError || !updatedMfa) return j({ success: false, error: 'mfa_code_replayed', code: 'mfa_verification_required' }, 401);
          method = 'password+totp';
          assuranceLevel = 2;
        }
      } else {
        return j({ success: false, error: 'mfa_configuration_invalid', code: 'mfa_verification_required' }, 503);
      }
    }

    // WP-11B/C Phase 3: rotate the staff session on successful step-up so the
    // pre-elevation cookie can no longer be replayed. Bind the step-up proof to
    // the newly minted session id.
    let boundSessionId = staffSession.id;
    let setCookieHeader: string | null = null;
    if (assuranceLevel >= 2) {
      const rot = await rotateSession(admin, staffSession.id, 'step_up');
      if (rot.ok && rot.newSessionId && rot.newSessionToken && rot.expiresAt) {
        boundSessionId = rot.newSessionId;
        setCookieHeader = createSessionCookie(rot.newSessionToken, rot.expiresAt);
        try {
          await admin.from('security_events').insert({ action: 'session.rotated', decision: 'allow', actor_type: 'human', actor_id: auth.userId, metadata_redacted: { reason: 'step_up', capability, old_session_id: staffSession.id, new_session_id: rot.newSessionId } });
        } catch { /* ignore */ }
      } else {
        console.error('[security-step-up] session rotation failed:', rot.error);
        return j({ success: false, error: 'session_rotation_failed' }, 503);
      }
    }

    const token = generateStepUpToken(32);
    const tokenHash = await hashStepUpToken(auth.userId, capability, token);
    const expiresAt = new Date(Date.now() + STEP_UP_TTL_MS).toISOString();

    const { error: insErr } = await admin.from('step_up_sessions').insert({
      user_id: auth.userId,
      capability,
      token_hash: tokenHash,
      bound_session_id: boundSessionId,
      method,
      assurance_level: assuranceLevel,
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
      expires_at: expiresAt,
    });
    if (insErr) return j({ success: false, error: insErr.message }, 500);

    try {
      await admin.from('security_events').insert({ action: 'step_up.granted', decision: 'allow', actor_type: 'human', actor_id: auth.userId, metadata_redacted: { capability, method } });
    } catch { /* ignore */ }

    const responseHeaders: Record<string, string> = { ...corsHeaders, 'Content-Type': 'application/json' };
    if (setCookieHeader) responseHeaders['Set-Cookie'] = setCookieHeader;
    return new Response(JSON.stringify({ success: true, token, expires_at: expiresAt, capability }), { status: 200, headers: responseHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ ...internalError(e, 'security-step-up'), success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * WP-11B — WebAuthn (FIDO2) ceremony helpers for staff MFA / step-up.
 *
 * Wraps @simplewebauthn/server so that registration + assertion verification
 * live in one auditable module. Consumers (security-step-up) generate options,
 * persist the challenge to `mfa_webauthn_challenges` bound to the staff
 * session, and pass the client response back into `verifyRegistration()` or
 * `verifyAssertion()` for cryptographic verification.
 *
 * Environment:
 *   WEBAUTHN_RP_ID       — Relying-party ID (registrable eTLD+1, no scheme).
 *   WEBAUTHN_RP_NAME     — Display name shown in the browser prompt.
 *   WEBAUTHN_RP_ORIGINS  — Comma-separated list of allowed origins (https URLs).
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from 'npm:@simplewebauthn/server@10.0.1';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticatorTransportFuture,
} from 'npm:@simplewebauthn/types@10.0.0';
import { encodeBase64Url, decodeBase64Url } from 'https://deno.land/std@0.224.0/encoding/base64url.ts';

export interface WebAuthnConfig {
  rpID: string;
  rpName: string;
  origins: string[];
}

export function loadWebAuthnConfig(): WebAuthnConfig | null {
  const rpID = Deno.env.get('WEBAUTHN_RP_ID');
  const rpName = Deno.env.get('WEBAUTHN_RP_NAME') || 'NPC Property Dashboard';
  const originsRaw = Deno.env.get('WEBAUTHN_RP_ORIGINS');
  if (!rpID || !originsRaw) return null;
  const origins = originsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!origins.length) return null;
  return { rpID, rpName, origins };
}

export interface StoredCredential {
  id: string;                 // internal PK
  credential_id: string;      // base64url
  public_key: Uint8Array;
  counter: number;
  transports: string[];
}

export async function buildRegistrationOptions(params: {
  cfg: WebAuthnConfig;
  userId: string;
  userName: string;
  displayName?: string;
  existingCredentialIds: string[];
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const opts = await generateRegistrationOptions({
    rpName: params.cfg.rpName,
    rpID: params.cfg.rpID,
    userID: new TextEncoder().encode(params.userId),
    userName: params.userName,
    userDisplayName: params.displayName ?? params.userName,
    attestationType: 'none',
    excludeCredentials: params.existingCredentialIds.map((id) => ({
      id,
      transports: ['internal', 'usb', 'ble', 'nfc', 'hybrid'] as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
    timeout: 60_000,
    supportedAlgorithmIDs: [-7, -257],
  });
  return opts;
}

export async function verifyRegistration(params: {
  cfg: WebAuthnConfig;
  expectedChallenge: string;
  response: RegistrationResponseJSON;
}) {
  const verification = await verifyRegistrationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedRPID: params.cfg.rpID,
    expectedOrigin: params.cfg.origins,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) return null;
  const info: any = verification.registrationInfo;
  // simplewebauthn v10: credential fields under `credential`, plus `credentialDeviceType`/`credentialBackedUp`.
  const credentialID: string = info.credential?.id ?? info.credentialID;
  const publicKey: Uint8Array = info.credential?.publicKey ?? info.credentialPublicKey;
  const counter: number = info.credential?.counter ?? info.counter ?? 0;
  const aaguid: string | undefined = info.aaguid;
  const deviceType: string | undefined = info.credentialDeviceType;
  const backedUp: boolean = Boolean(info.credentialBackedUp);
  return {
    credentialId: typeof credentialID === 'string' ? credentialID : encodeBase64Url(credentialID as any),
    publicKey,
    counter,
    aaguid: aaguid ?? null,
    deviceType: deviceType ?? null,
    backedUp,
  };
}

export async function buildAssertionOptions(params: {
  cfg: WebAuthnConfig;
  allowCredentialIds: string[];
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return await generateAuthenticationOptions({
    rpID: params.cfg.rpID,
    userVerification: 'required',
    timeout: 60_000,
    allowCredentials: params.allowCredentialIds.map((id) => ({
      id,
      transports: ['internal', 'usb', 'ble', 'nfc', 'hybrid'] as AuthenticatorTransportFuture[],
    })),
  });
}

export async function verifyAssertion(params: {
  cfg: WebAuthnConfig;
  expectedChallenge: string;
  response: AuthenticationResponseJSON;
  credential: StoredCredential;
}) {
  const verification = await verifyAuthenticationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedRPID: params.cfg.rpID,
    expectedOrigin: params.cfg.origins,
    requireUserVerification: true,
    credential: {
      id: params.credential.credential_id,
      publicKey: params.credential.public_key,
      counter: params.credential.counter,
      transports: params.credential.transports as AuthenticatorTransportFuture[],
    } as any,
  });
  if (!verification.verified) return null;
  return {
    newCounter: verification.authenticationInfo.newCounter,
  };
}

export { encodeBase64Url, decodeBase64Url };

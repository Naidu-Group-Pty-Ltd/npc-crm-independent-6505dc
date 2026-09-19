/**
 * Didit webhook authentication.
 *
 * `didit-webhook` runs with `verify_jwt = false`, because Didit's servers call
 * it and cannot hold a Supabase JWT. That makes THIS module the authentication
 * boundary for the only inbound path that can settle an identity verification.
 *
 * It is pure and Deno-free on purpose. The rest of the client reads `Deno.env`
 * at import time, which no unit test can load — and the one piece of this
 * integration that most needs exhaustive tests is the code deciding whether an
 * unsigned, replayed or tampered request gets to change AML state.
 *
 * Contract read from Didit's current documentation on 2026-08-08:
 *
 *   X-Signature   HMAC-SHA256 over the exact raw request bytes, hex
 *   X-Timestamp   Unix epoch seconds; reject if |now - ts| > 300
 *
 * (Didit also sends `X-Signature-V2` over a canonicalised JSON re-serialisation
 * and `X-Signature-Simple` over a small field triple. `X-Signature` is the one
 * used here: it commits to the exact bytes received, so it cannot be satisfied
 * by a body that merely re-serialises to the same canonical form.)
 */

/** Didit's own replay window. Matches their documented verification sample. */
export const DIDIT_WEBHOOK_MAX_SKEW_SECONDS = 300;

/**
 * Constant-time hex comparison.
 *
 * Length is compared first — which leaks only the length, already known from
 * the algorithm — and then every byte is compared with no early exit, so the
 * time taken does not depend on how many leading characters were correct.
 * `a === b` would return as soon as it found a difference and let an attacker
 * recover a valid signature byte by byte.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * HMAC-SHA256 of the EXACT raw request bytes, hex-encoded.
 *
 * The raw body is what was signed, so it must be verified before it is parsed.
 * `JSON.parse` followed by `JSON.stringify` does not round-trip byte-for-byte
 * — key order, float formatting and non-ASCII escaping all differ — so
 * verifying a re-serialised body would reject valid deliveries, and
 * "fixing" that by canonicalising would verify a body other than the one
 * actually received.
 */
export async function computeDiditSignature(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type WebhookRejection =
  | 'missing_signature' | 'missing_timestamp' | 'stale_timestamp'
  | 'invalid_signature' | 'not_configured';

export interface WebhookVerification {
  ok: boolean;
  rejection: WebhookRejection | null;
}

/**
 * Verify a Didit webhook delivery.
 *
 * Fails closed at every step. A missing secret is `not_configured` rather than
 * an accepted request: an endpoint that accepted unsigned bodies whenever its
 * secret was absent would turn a deployment mistake into an open door onto AML
 * state.
 *
 * Order matters. The timestamp window is checked before the HMAC, so replayed
 * traffic is rejected without spending a signing operation per request; and the
 * signature is the last word, so a fresh timestamp alone proves nothing.
 */
export async function verifyDiditWebhook(args: {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  secret: string | null;
  nowSeconds?: number;
  maxSkewSeconds?: number;
}): Promise<WebhookVerification> {
  if (!args.secret) return { ok: false, rejection: 'not_configured' };
  if (!args.signatureHeader) return { ok: false, rejection: 'missing_signature' };
  if (!args.timestampHeader) return { ok: false, rejection: 'missing_timestamp' };

  const ts = Number.parseInt(args.timestampHeader, 10);
  if (!Number.isFinite(ts)) return { ok: false, rejection: 'missing_timestamp' };

  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = args.maxSkewSeconds ?? DIDIT_WEBHOOK_MAX_SKEW_SECONDS;
  // Absolute difference: a timestamp far in the FUTURE is as suspect as a
  // stale one, and accepting it would widen the replay window indefinitely.
  if (Math.abs(now - ts) > skew) return { ok: false, rejection: 'stale_timestamp' };

  const expected = await computeDiditSignature(args.rawBody, args.secret);
  if (!timingSafeEqualHex(expected, args.signatureHeader.trim().toLowerCase())) {
    return { ok: false, rejection: 'invalid_signature' };
  }
  return { ok: true, rejection: null };
}

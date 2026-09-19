/**
 * Reset/invite token helpers (Security Remediation Phase 6 / ABUSE-003).
 *
 * - OTPs are generated with crypto.getRandomValues (never Math.random).
 * - Tokens are stored as salted SHA-256 hashes, prefixed "sha256:" so
 *   verification can dual-read legacy plaintext values during the migration
 *   window (in-flight resets keep working; new tokens are always hashed).
 * - Comparison is constant-time.
 * - Tokens/OTPs must never be logged.
 */

const HASH_PREFIX = 'sha256:';

/** Cryptographically random n-digit OTP (default 6 digits). */
export function generateOtp(digits = 6): string {
  const max = 10 ** digits;
  // Rejection sampling to avoid modulo bias
  const range = 2 ** 32;
  const limit = range - (range % max);
  const buf = new Uint32Array(1);
  let v: number;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return String(v % max).padStart(digits, '0');
}

/** Cryptographically random URL-safe token (default 32 bytes / 256 bits). */
export function generateLinkToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MIN_PEPPER_LENGTH = 16;

function pepper(): string {
  return (Deno.env.get('RESET_TOKEN_PEPPER') || '').trim();
}

/**
 * Hash a token for storage. REQUIRES a high-entropy RESET_TOKEN_PEPPER: a
 * 6-digit OTP has only ~1e6 possible values, so an unpeppered SHA-256 is
 * trivially reversible from a single database read. When the pepper is missing
 * or too short we FAIL CLOSED (throw) rather than persist a weakly-hashed
 * token. Configure RESET_TOKEN_PEPPER (>=32 random chars recommended).
 */
export async function hashResetToken(token: string): Promise<string> {
  const p = pepper();
  if (p.length < MIN_PEPPER_LENGTH) {
    throw new Error('RESET_TOKEN_PEPPER is not configured (min 16 chars) — refusing to issue a weakly-hashed reset token.');
  }
  return HASH_PREFIX + (await sha256Hex(token + p));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a provided token against a stored value.
 * Supports hashed ("sha256:...") and legacy plaintext stored values.
 */
export async function verifyResetToken(stored: string | null | undefined, provided: string | null | undefined): Promise<boolean> {
  if (!stored || !provided) return false;
  if (stored.startsWith(HASH_PREFIX)) {
    const providedHash = await hashResetToken(provided);
    return constantTimeEqual(stored, providedHash);
  }
  // Legacy plaintext value written before the hashing migration
  return constantTimeEqual(stored, provided);
}

export const MAX_RESET_ATTEMPTS = 5;

/**
 * One-time MFA recovery codes.
 *
 * Only SHA-256 hashes bound to the user and a mandatory server-side pepper are
 * persisted. Plaintext codes are generated for a single response and must
 * never be logged or stored in browser storage.
 */
const CODE_COUNT = 10;
const CODE_BYTES = 12;
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function configuredPepper(): string | null {
  const value = (globalThis as any).Deno?.env?.get?.('MFA_RECOVERY_CODE_PEPPER')?.trim();
  return value && value.length >= 32 ? value : null;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isRecoveryCodeHashConfigured(): boolean {
  return !!configuredPepper();
}

export function normalizeRecoveryCode(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/[\s_]/g, '').replace(/-/g, '');
  if (!/^[A-HJ-NP-Z2-9]{12}$/.test(normalized)) return null;
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8)}`;
}

export function isRecoveryCode(value: string): boolean {
  const normalized = normalizeRecoveryCode(value);
  return !!normalized && CODE_PATTERN.test(normalized);
}

export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < CODE_COUNT) {
    const random = new Uint8Array(CODE_BYTES);
    crypto.getRandomValues(random);
    let value = '';
    for (let index = 0; index < 12; index += 1) value += ALPHABET[random[index] % ALPHABET.length];
    codes.add(`${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`);
  }
  return [...codes];
}

export async function hashRecoveryCode(userId: string, code: string): Promise<string | null> {
  const pepper = configuredPepper();
  const normalized = normalizeRecoveryCode(code);
  if (!pepper || !normalized) return null;
  return sha256Hex(`${pepper}:${userId}:mfa.recovery_code:${normalized}`);
}

export async function hashRecoveryCodes(userId: string, codes: string[]): Promise<string[] | null> {
  const hashes = await Promise.all(codes.map((code) => hashRecoveryCode(userId, code)));
  return hashes.every((hash): hash is string => !!hash) ? hashes : null;
}

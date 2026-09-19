/**
 * Minimal RFC 6238 TOTP verifier for staff MFA.
 *
 * MFA_TOTP_ENCRYPTION_KEY must be a base64url-encoded 32-byte AES-256-GCM
 * key. Stored secrets use `v1:<base64url-iv>:<base64url-ciphertext>` and are
 * decrypted only inside trusted Edge Function memory.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base32ToBytes(value: string): Uint8Array | null {
  const normalized = value.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!normalized || /[^A-Z2-7]/.test(normalized)) return null;
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    accumulator = (accumulator << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return bytes.length >= 10 ? new Uint8Array(bytes) : null;
}

function bytesToBase32(value: Uint8Array): string {
  let bits = 0;
  let accumulator = 0;
  let output = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(accumulator >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 0x1f];
  return output;
}

function equalCode(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

async function decryptTotpSecret(sealed: string): Promise<string | null> {
  const [version, ivEncoded, ciphertextEncoded, ...rest] = sealed.split(":");
  const configuredKey = (globalThis as any).Deno?.env?.get?.("MFA_TOTP_ENCRYPTION_KEY")?.trim();
  if (version !== "v1" || !ivEncoded || !ciphertextEncoded || rest.length || !configuredKey) return null;

  try {
    const rawKey = base64UrlToBytes(configuredKey);
    const iv = base64UrlToBytes(ivEncoded);
    const ciphertext = base64UrlToBytes(ciphertextEncoded);
    if (rawKey.length !== 32 || iv.length !== 12 || ciphertext.length < 17) return null;
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const secret = decoder.decode(plaintext).trim();
    return base32ToBytes(secret) ? secret : null;
  } catch {
    return null;
  }
}

async function encryptionKey(): Promise<CryptoKey | null> {
  const configuredKey = (globalThis as any).Deno?.env?.get?.("MFA_TOTP_ENCRYPTION_KEY")?.trim();
  if (!configuredKey) return null;
  try {
    const rawKey = base64UrlToBytes(configuredKey);
    if (rawKey.length !== 32) return null;
    return await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

/** Generate a 160-bit Base32 TOTP secret and seal it for database storage. */
export async function createEncryptedTotpSecret(): Promise<{ secret: string; encryptedSecret: string } | null> {
  const key = await encryptionKey();
  if (!key) return null;
  const rawSecret = new Uint8Array(20);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(rawSecret);
  crypto.getRandomValues(iv);
  const secret = bytesToBase32(rawSecret);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(secret)));
  return { secret, encryptedSecret: `v1:${bytesToBase64Url(iv)}:${bytesToBase64Url(ciphertext)}` };
}

async function codeForCounter(secret: Uint8Array, counter: number): Promise<string> {
  const counterBytes = new Uint8Array(8);
  let remaining = BigInt(counter);
  for (let index = 7; index >= 0; index -= 1) {
    counterBytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) | digest[offset + 3]) >>> 0;
  return String(value % 1_000_000).padStart(6, "0");
}

export type TotpVerification = { valid: true; counter: number } | { valid: false };

/** Verify one current or adjacent (±30s) RFC 6238 code. */
export async function verifyEncryptedTotp(
  encryptedSecret: string | null | undefined,
  submittedCode: string | null | undefined,
  nowMs = Date.now(),
): Promise<TotpVerification> {
  if (!encryptedSecret || !submittedCode || !/^\d{6}$/.test(submittedCode)) return { valid: false };
  const plaintextSecret = await decryptTotpSecret(encryptedSecret);
  const secret = plaintextSecret ? base32ToBytes(plaintextSecret) : null;
  if (!secret) return { valid: false };

  const currentCounter = Math.floor(nowMs / 30_000);
  for (const counter of [currentCounter - 1, currentCounter, currentCounter + 1]) {
    if (equalCode(await codeForCounter(secret, counter), submittedCode)) return { valid: true, counter };
  }
  return { valid: false };
}

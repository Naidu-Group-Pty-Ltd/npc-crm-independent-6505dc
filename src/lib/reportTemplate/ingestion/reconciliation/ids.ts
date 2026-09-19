export function safeIdPart(value: string | number | undefined | null, fallback = 'item'): string {
  const raw = String(value ?? fallback).trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

/** Small deterministic non-crypto hash for stable import IDs without persisting whole data URLs. */
export function shortHash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function stableImportId(prefix: string, value: string | number | undefined | null): string {
  return `${prefix}_${safeIdPart(value, 'import')}`;
}

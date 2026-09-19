/**
 * Reading the bytes behind a tenant's logo.
 *
 * `assets.pure.ts` decides whether an asset may be used and what it resolves to,
 * and says plainly that it never fetches: "Something else reads the bytes."
 * This is that something else, and until now it did not exist — so every asset
 * in `whitelabel_settings.logo_config` arrived at the snapshot builder as an
 * `https://…/storage/v1/object/public/branding-assets/…` URL, was rejected as
 * `not-a-data-uri`, and every report rendered with no company mark at all.
 *
 * ## What it will fetch
 *
 * Only `/storage/v1/object/…` on this project's own Supabase origin. The
 * tenant's branding form writes URLs, and a URL in a settings row is a URL an
 * operator can point anywhere — so the same rule the render guard applies to
 * finished HTML applies here, one step earlier. Anything else is dropped with a
 * note rather than followed.
 *
 * ## Why it never throws
 *
 * A logo that could not be fetched is a thinner document, not a failed one. The
 * caller gets notes to log and the brand audit already reports the resulting gap
 * ("no brand mark passed asset policy") to the person about to send the report.
 */
import { INLINE_MIME_ALLOW, MAX_ASSET_BYTES } from './assets.pure.ts';

/** What happened to one asset, in words a support ticket can use. */
export interface BrandAssetNote {
  key: string;
  reason: 'not-project-storage' | 'fetch-failed' | 'too-large' | 'wrong-format';
  detail: string;
}

export interface InlinedBrandAssets {
  /** The same map, with every fetchable value replaced by a `data:` URI. */
  assets: Record<string, string | null>;
  notes: BrandAssetNote[];
}

/** Chunked so a 3 MB asset does not blow the argument limit of `fromCharCode`. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function isProjectStorageObject(raw: string, supabaseOrigin: string): boolean {
  if (!supabaseOrigin) return false;
  try {
    const url = new URL(raw);
    return url.origin === supabaseOrigin && url.pathname.startsWith('/storage/v1/object/');
  } catch {
    return false;
  }
}

/**
 * Turn every project-storage URL in a `logo_config` into a `data:` URI.
 *
 * Values that are already `data:` URIs pass through untouched — a tenant who
 * uploaded through a newer form is not re-fetched — and empty values stay empty.
 */
export async function inlineBrandAssets(
  assets: Record<string, string | null> | null | undefined,
  opts: {
    supabaseUrl: string;
    /** Injected in tests; the runtime `fetch` otherwise. */
    fetchImpl?: typeof fetch;
    maxBytes?: number;
    /** A slow branding host must not hold a render open. */
    timeoutMs?: number;
  },
): Promise<InlinedBrandAssets> {
  const source = assets ?? {};
  const notes: BrandAssetNote[] = [];
  const out: Record<string, string | null> = {};

  let origin = '';
  try {
    origin = new URL(opts.supabaseUrl).origin;
  } catch {
    origin = '';
  }

  const doFetch = opts.fetchImpl ?? fetch;
  const cap = opts.maxBytes ?? MAX_ASSET_BYTES;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const entries = Object.entries(source);
  const fetched = await Promise.all(entries.map(async ([key, value]) => {
    const raw = (value ?? '').trim();
    if (!raw || raw.startsWith('data:')) return [key, raw || null] as const;

    if (!isProjectStorageObject(raw, origin)) {
      notes.push({
        key,
        reason: 'not-project-storage',
        detail: 'a report asset is fetched only from this project\'s storage; this points elsewhere',
      });
      return [key, null] as const;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(raw, { signal: controller.signal });
      if (!res.ok) {
        notes.push({ key, reason: 'fetch-failed', detail: `storage returned ${res.status}` });
        return [key, null] as const;
      }

      const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!(INLINE_MIME_ALLOW as readonly string[]).includes(mime)) {
        notes.push({
          key,
          reason: 'wrong-format',
          detail: `${mime || 'unknown type'} is not inlineable (allowed: ${INLINE_MIME_ALLOW.join(', ')})`,
        });
        return [key, null] as const;
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > cap) {
        notes.push({
          key,
          reason: 'too-large',
          detail: `${bytes.length} bytes exceeds the ${cap}-byte per-asset budget`,
        });
        return [key, null] as const;
      }

      return [key, `data:${mime};base64,${toBase64(bytes)}`] as const;
    } catch (e) {
      notes.push({
        key,
        reason: 'fetch-failed',
        detail: e instanceof Error ? e.message : String(e),
      });
      return [key, null] as const;
    } finally {
      clearTimeout(timer);
    }
  }));

  for (const [key, value] of fetched) out[key] = value;
  return { assets: out, notes };
}

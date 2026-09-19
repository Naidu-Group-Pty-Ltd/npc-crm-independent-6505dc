/**
 * How a logo gets into a report.
 *
 * ## Why a `data:` URI and not a URL
 *
 * **Not one legacy PDF in this product embeds a logo.** Branding is drawn
 * chrome and a company-name string, and the one place cover art is referenced
 * (`render-investment-report-pdf/index.ts:3078`) hardcodes an absolute
 * `lovable.app` URL — so the render depends on a preview host, on that host's
 * ACL at render time, and on the network being up. A re-issue of a year-old
 * report can silently lose its cover.
 *
 * Inlining fixes all three at once:
 *
 *  - **Deterministic.** The same snapshot renders the same bytes forever, which
 *    is what makes a golden PDF meaningful.
 *  - **Network-free.** `weasyprint-service/app.py` resolves every non-`data:`
 *    URL and rejects any host that is not globally routable (its SSRF guard),
 *    then fetches it. A `data:` URI returns at line 66 before any of that.
 *  - **Snapshot-able.** The asset travels inside the brand snapshot, so the
 *    logo a client received is recoverable even after the bucket is rotated.
 *
 * ## The budget
 *
 * The service caps the whole request at 25 MB (`MAX_HTML_BYTES`) and base64 is
 * 4/3 the size of the bytes it encodes. A report carries at most a mark, a mono
 * mark and a cover photograph, so the per-asset and total caps below leave the
 * document itself an order of magnitude more room than it needs — while making
 * "someone uploaded a 40 MB TIFF as their logo" a rejection with a reason
 * rather than a 413 from the renderer with none.
 *
 * Pure: sibling `.pure` imports only, no I/O, no fetching. Something else reads
 * the bytes; this decides whether they may be used and what they resolve to.
 */

/** A place a report paints a brand asset. */
export type ReportAssetSlot =
  /** The mark on paper — running header, contents, closing page. */
  | 'report'
  /** The mark on the dark cover and closing ground. */
  | 'report-mono'
  /** Full-bleed cover art. */
  | 'cover';

/**
 * Keys in the tenant's `logo_config`.
 *
 * `report` and `reportMono` are new in this phase; the other three are the
 * slots `WhiteLabel.tsx` has always offered. A tenant who has not uploaded a
 * report mark still gets a branded document, because the chain below falls back
 * to the marks they did upload.
 */
export type BrandLogoKey = 'report' | 'reportMono' | 'sidebar' | 'auth' | 'sidebarIcon' | 'cover';

/**
 * Resolution order per slot.
 *
 * `report-mono` deliberately falls back to `report` before the UI marks: a
 * colour lockup on obsidian is worse than no lockup only if it is illegible,
 * and most lockups are not. The reverse — a knockout white mark on ivory paper
 * — is invisible, which is why `report` never falls back to `reportMono`.
 */
export const ASSET_FALLBACK: Record<ReportAssetSlot, readonly BrandLogoKey[]> = {
  report: ['report', 'sidebar', 'auth', 'sidebarIcon'],
  'report-mono': ['reportMono', 'report', 'sidebar', 'auth', 'sidebarIcon'],
  cover: ['cover'],
};

/**
 * Raster formats only.
 *
 * **SVG is deliberately excluded.** WeasyPrint renders SVG, and an SVG can
 * carry `<image href="http://…">` and `<script>`. The service's SSRF guard
 * inspects the URL it is asked to fetch — it does not parse the inside of a
 * `data:` URI it was handed, so a tenant-uploaded SVG is a request the guard
 * never sees. A logo does not need vector fidelity at 13mm on a 300dpi sheet;
 * this is not a trade worth making.
 */
export const INLINE_MIME_ALLOW = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type InlineMime = typeof INLINE_MIME_ALLOW[number];

/** The renderer's own limit, mirrored so the rejection happens before the POST. */
export const HTML_BUDGET_BYTES = 25 * 1024 * 1024;
/** Per asset, decoded. A 300dpi A4 JPEG cover is ~1.5 MB. */
export const MAX_ASSET_BYTES = 3 * 1024 * 1024;
/** Every asset in one document, decoded. Leaves ~15 MB for the document. */
export const MAX_TOTAL_ASSET_BYTES = 8 * 1024 * 1024;

export type AssetRejection =
  | 'empty'
  | 'not-a-data-uri'
  | 'unsupported-mime'
  | 'not-base64'
  | 'too-large'
  | 'too-small';

/**
 * The shortest edge a brand mark may have, in pixels.
 *
 * The lockup prints the mark at 13mm on paper and 22mm on the cover. 22mm at a
 * modest 150dpi is 130 device pixels, and at 300dpi it is 260 — so a 64px mark
 * is soft at any print resolution and a favicon-sized one is a blurred square.
 * That is a real thing a tenant does: `logo_config` accepts whatever they
 * upload, and the byte cap says nothing about how big the picture is.
 *
 * 96 is deliberately below what looks good rather than at it. This is a floor
 * that catches the icon-uploaded-as-a-logo case, not a quality bar.
 */
export const MIN_ASSET_EDGE_PX = 96;

export interface InlineAsset {
  dataUri: string;
  mime: InlineMime;
  /** Decoded size. */
  bytes: number;
  /**
   * Pixel dimensions, when they could be read from the header.
   *
   * `null` for a format this module cannot measure — today that is WebP, whose
   * three container variants each store the size differently. An asset that
   * cannot be measured is **not** rejected: refusing to print a logo because we
   * could not read its header is worse than printing a logo that might be
   * small.
   */
  dimensions: { width: number; height: number } | null;
}

export type InlineResult =
  | { ok: true; asset: InlineAsset }
  | { ok: false; reason: AssetRejection; detail: string };

const DATA_URI = /^data:([a-z]+\/[a-z0-9.+-]+)(;[a-z0-9-]+=[^;,]*)*;base64,([A-Za-z0-9+/]+={0,2})$/i;

/**
 * Decoded byte length of a base64 payload, without decoding it.
 *
 * Decoding a 40 MB string to find out it is 40 MB is the failure mode this
 * avoids — the arithmetic is exact, so the check is free.
 */
export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}


// ── Reading a picture's size from its header ────────────────────────────────

/**
 * Decode the first `maxBytes` of a base64 payload.
 *
 * A JPEG's size marker can sit behind an EXIF block, so a fixed prefix rather
 * than the first few bytes — but never the whole asset, because decoding 3 MB
 * to read eight bytes is the cost this avoids.
 */
function decodePrefix(base64: string, maxBytes: number): Uint8Array {
  // base64 decodes 4 characters to 3 bytes; slicing on a multiple of 4 keeps
  // the prefix decodable on its own.
  const chars = Math.min(base64.length, Math.ceil(maxBytes / 3) * 4);
  const binary = atob(base64.slice(0, chars - (chars % 4)));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const be32 = (b: Uint8Array, at: number) =>
  (b[at] << 24 | b[at + 1] << 16 | b[at + 2] << 8 | b[at + 3]) >>> 0;
const be16 = (b: Uint8Array, at: number) => (b[at] << 8 | b[at + 1]);

/** PNG: the IHDR chunk is first by specification, so the size is at a fixed offset. */
function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24) return null;
  const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (signature.some((byte, i) => b[i] !== byte)) return null;
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  return { width: be32(b, 16), height: be32(b, 20) };
}

/**
 * JPEG: walk the marker chain to the first Start Of Frame.
 *
 * The size is not at a fixed offset — an EXIF or ICC block can precede it, and
 * a progressive JPEG uses a different SOF marker from a baseline one. The four
 * markers skipped below are not frame headers: DHT, JPG, DAC and the restart
 * markers share the SOF numeric range.
 */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xFF) { at++; continue; }
    const marker = b[at + 1];
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { at += 2; continue; }
    if (marker === 0xD9 || marker === 0xDA) return null;
    const length = be16(b, at + 2);
    const isFrame = marker >= 0xC0 && marker <= 0xCF
      && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isFrame) return { height: be16(b, at + 5), width: be16(b, at + 7) };
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/**
 * Pixel dimensions, or `null` when they cannot be read.
 *
 * WebP is `null` on purpose: its lossy, lossless and extended containers each
 * store the size differently, and guessing wrong is worse than not knowing.
 */
export function readImageDimensions(
  mime: string,
  base64: string,
): { width: number; height: number } | null {
  try {
    const header = decodePrefix(base64, 65_536);
    if (mime === 'image/png') return pngSize(header);
    if (mime === 'image/jpeg') return jpegSize(header);
    return null;
  } catch {
    // A payload that will not decode is already caught by the base64 check; if
    // something else throws here, an unmeasured asset is the safe answer.
    return null;
  }
}

/**
 * Validate a `data:` URI against the inline policy.
 *
 * Returns a reason on rejection rather than throwing or returning null: "the
 * logo did not appear" is a support ticket, and the difference between *too
 * large*, *wrong format* and *never uploaded* is the whole of the answer.
 */
export function inlineAsset(
  value: string | null | undefined,
  opts: { maxBytes?: number; minEdgePx?: number } = {},
): InlineResult {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { ok: false, reason: 'empty', detail: 'no asset configured' };

  if (!raw.toLowerCase().startsWith('data:')) {
    return {
      ok: false,
      reason: 'not-a-data-uri',
      detail: 'a report asset must be inlined; a URL makes the render depend on '
        + 'a host and an ACL at render time',
    };
  }

  const match = raw.match(DATA_URI);
  if (!match) {
    return { ok: false, reason: 'not-base64', detail: 'malformed or non-base64 data URI' };
  }

  const mime = match[1].toLowerCase();
  if (!(INLINE_MIME_ALLOW as readonly string[]).includes(mime)) {
    return {
      ok: false,
      reason: 'unsupported-mime',
      detail: `${mime} is not inlineable (allowed: ${INLINE_MIME_ALLOW.join(', ')})`,
    };
  }

  const bytes = base64ByteLength(match[3]);
  const cap = opts.maxBytes ?? MAX_ASSET_BYTES;
  if (bytes > cap) {
    return {
      ok: false,
      reason: 'too-large',
      detail: `${bytes} bytes exceeds the ${cap}-byte cap for a single asset`,
    };
  }

  const dimensions = readImageDimensions(mime, match[3]);
  const shortest = dimensions ? Math.min(dimensions.width, dimensions.height) : null;
  const floor = opts.minEdgePx ?? MIN_ASSET_EDGE_PX;
  if (shortest !== null && shortest < floor) {
    return {
      ok: false,
      reason: 'too-small',
      detail: `${dimensions!.width}x${dimensions!.height} is below the ${floor}px floor; `
        + 'the mark prints at 22mm on the cover and would be visibly soft',
    };
  }

  return { ok: true, asset: { dataUri: raw, mime: mime as InlineMime, bytes, dimensions } };
}

/** What a slot resolved to, and which key it came from. */
export interface ResolvedAsset {
  slot: ReportAssetSlot;
  /** The `logo_config` key that supplied it. */
  source: BrandLogoKey;
  asset: InlineAsset;
}

export type BrandAssetMap = Partial<Record<BrandLogoKey, string | null>>;

/**
 * Walk a slot's fallback chain and return the first asset that passes policy.
 *
 * A key that is present but fails policy does **not** stop the walk — a tenant
 * whose report mark is a 12 MB PNG still gets their sidebar logo on the cover
 * rather than a blank space. The rejections are returned alongside so the
 * render can log why the preferred mark was skipped.
 */
export function resolveReportAsset(
  assets: BrandAssetMap,
  slot: ReportAssetSlot,
): { resolved: ResolvedAsset | null; skipped: Array<{ source: BrandLogoKey; reason: AssetRejection; detail: string }> } {
  const skipped: Array<{ source: BrandLogoKey; reason: AssetRejection; detail: string }> = [];
  for (const source of ASSET_FALLBACK[slot]) {
    const value = assets[source];
    if (value == null || value === '') continue;
    const result = inlineAsset(value);
    if (result.ok === true) return { resolved: { slot, source, asset: result.asset }, skipped };
    const rejected = result as { ok: false; reason: AssetRejection; detail: string };
    skipped.push({ source, reason: rejected.reason, detail: rejected.detail });
  }
  return { resolved: null, skipped };
}

/**
 * Whether a set of resolved assets fits in one document.
 *
 * Checked before the render rather than after: a 413 from the service says
 * nothing about which asset caused it.
 */
export function assetBudget(
  assets: readonly InlineAsset[],
): { totalBytes: number; encodedBytes: number; withinBudget: boolean } {
  const totalBytes = assets.reduce((sum, a) => sum + a.bytes, 0);
  // base64 is 4/3, and the URI carries a short scheme prefix per asset.
  const encodedBytes = Math.ceil((totalBytes * 4) / 3) + assets.length * 32;
  return {
    totalBytes,
    encodedBytes,
    withinBudget: totalBytes <= MAX_TOTAL_ASSET_BYTES && encodedBytes <= HTML_BUDGET_BYTES,
  };
}

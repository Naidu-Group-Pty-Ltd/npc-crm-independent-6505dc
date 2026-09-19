/**
 * White-label branding for the intake pack.
 *
 * Resolves the same brand a generated report resolves, through the same
 * modules, in the order set out in `REPORT_RULES.md` §6:
 *
 *   1. design-system defaults
 *   2. `whitelabel_settings`      — colours, logo, company name
 *   3. `global_report_settings.contact_details` — phone, email, website,
 *      address and ABN (the only place an ABN exists)
 *
 * Two things this file deliberately does NOT do differently from reports:
 *
 *  - colours are stored as HSL triplets (`"228 94% 45%"`), not hex, so they go
 *    through `hslToHex` from the shared colour module rather than a local
 *    parser. An earlier version of this file assumed hex and silently fell back
 *    to the default on every generation, which is why downloaded packs came out
 *    unbranded.
 *  - the logo is **inlined as bytes**, not linked. A document a client keeps
 *    must render on a train with no signal, and a linked asset also leaks a
 *    fetch back to us every time they open it.
 *
 * Brand values are snapshotted onto the pack at generation time, so re-issuing
 * an old pack reproduces the branding it was issued under.
 */

import { supabase } from '@/integrations/supabase/client';
import { hslToHex, normalizeHslString } from '@/lib/reportDesign/color.pure';
import { companyContactRows, sanitizeReportText, FALLBACK_COMPANY_NAME, type ContactRow } from '@/lib/reportDesign/companyBlock.pure';
import { fetchGlobalReportSettings } from '@/hooks/useGlobalReportSettings';

export interface PackLogo {
  /** Raw image bytes, ready to embed in xlsx or docx. */
  data: Uint8Array;
  extension: 'png' | 'jpeg';
  widthPx: number;
  heightPx: number;
}

export interface PackBranding {
  companyName: string;
  brandHex: string;
  accentHex: string;
  /** Contact rows (Website, Email, Phone, Address, ABN) already filtered of blanks. */
  contactRows: ContactRow[];
  /** Null when no logo is configured or it could not be fetched. */
  logo: PackLogo | null;
  /** ISO timestamp the brand was resolved, recorded on the pack. */
  resolvedAt: string;
}

/**
 * Neutral fallback.
 *
 * The company name is deliberately generic rather than "NPC": a white-label
 * tenant whose settings are not filled in must not get our name printed on
 * their client's document. Same reasoning as `FALLBACK_COMPANY_NAME`.
 *
 * These are literal hex values by necessity — the output is .xlsx and .docx
 * opened in Excel and Word, which cannot resolve CSS custom properties.
 */
/* eslint-disable no-restricted-syntax -- generated Office documents cannot resolve CSS tokens. */
const FALLBACK_BRAND_HEX = '#1F2937';
const FALLBACK_ACCENT_HEX = '#4F46E5';
/* eslint-enable no-restricted-syntax */

export const DEFAULT_PACK_BRANDING: PackBranding = {
  companyName: FALLBACK_COMPANY_NAME,
  brandHex: FALLBACK_BRAND_HEX,
  accentHex: FALLBACK_ACCENT_HEX,
  contactRows: [],
  logo: null,
  resolvedAt: '1970-01-01T00:00:00.000Z',
};

/** Largest logo we will pull down. A pack is not the place for a 5MB hero image. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_FETCH_TIMEOUT_MS = 8000;

/**
 * Convert a stored colour to hex.
 *
 * Accepts the HSL triplet the settings actually hold, and tolerates a hex value
 * in case a tenant was configured through a different path.
 */
export function toHex(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return fallback;
  if (/^#[0-9A-Fa-f]{6}$/.test(text)) return text.toUpperCase();

  // Confirm the string really is an HSL triplet before converting. Handing
  // unparseable input to `normalizeHslString` returns its own fallback of
  // `0 0% 0%`, which converts to a perfectly valid #000000 — so a typo'd
  // colour would silently come out black rather than using the fallback here.
  if (!/^-?\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(text)) return fallback;

  try {
    const hex = hslToHex(normalizeHslString(text, '0 0% 0%'));
    return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex.toUpperCase() : fallback;
  } catch {
    return fallback;
  }
}

/** Read PNG/JPEG intrinsic dimensions without decoding the whole image. */
function imageSize(bytes: Uint8Array): { width: number; height: number; extension: 'png' | 'jpeg' } | null {
  // PNG: 8-byte signature, then IHDR with width/height as big-endian uint32.
  if (bytes.length > 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20), extension: 'png' };
  }

  // JPEG: walk the segment markers to the first frame header (SOF0-SOF15).
  if (bytes.length > 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let offset = 2;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xFF) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      // Frame headers carry the dimensions; skip the ones that do not.
      if (marker >= 0xC0 && marker <= 0xCF
        && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7), extension: 'jpeg' };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  return null;
}

/**
 * Fetch the tenant logo and return its bytes.
 *
 * Only the tenant's own uploaded white-label asset is used. The repository's
 * legacy "logo" files are email-signature banners carrying a personal mobile
 * number and must never reach a client document — see REPORT_RULES.md §5.
 */
async function fetchLogo(url: string | null | undefined): Promise<PackLogo | null> {
  const href = typeof url === 'string' ? url.trim() : '';
  if (!href) return null;

  // Only https, and never a data: URI of unknown provenance.
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(href, { signal: controller.signal });
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_LOGO_BYTES) return null;

    const bytes = new Uint8Array(buffer);
    const size = imageSize(bytes);
    // Reject anything that is not a real PNG or JPEG — Word and Excel will
    // corrupt the file rather than fail gracefully on an unexpected format.
    if (!size || size.width <= 0 || size.height <= 0) return null;

    return {
      data: bytes,
      extension: size.extension,
      widthPx: size.width,
      heightPx: size.height,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Scale a logo to fit a bounding box while preserving aspect ratio.
 * Never enlarges — an 80px mark blown up to 200px looks broken in print.
 */
export function fitLogo(
  logo: PackLogo, maxWidth: number, maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(maxWidth / logo.widthPx, maxHeight / logo.heightPx, 1);
  return {
    width: Math.max(1, Math.round(logo.widthPx * scale)),
    height: Math.max(1, Math.round(logo.heightPx * scale)),
  };
}

/**
 * Resolve branding for a pack. Never throws — a branding lookup failing is not
 * a reason to deny somebody their document. Each source degrades independently,
 * so a missing logo still yields correct colours and contact details.
 */
export async function resolvePackBranding(): Promise<PackBranding> {
  const resolvedAt = new Date().toISOString();

  // Each source degrades independently: a missing logo still yields correct
  // colours, and unreachable settings still yield a usable pack.
  const [whitelabel, settings] = await Promise.all([
    (async () => {
      try {
        const { data } = await supabase
          .from('whitelabel_settings')
          .select('company_name, primary_color, accent_color, auth_logo, sidebar_logo')
          .limit(1)
          .maybeSingle();
        return data;
      } catch {
        return null;
      }
    })(),
    fetchGlobalReportSettings().catch(() => null),
  ]);

  const contact = settings?.contactDetails;

  // Contact details are the authoritative source for the trading name; the
  // white-label record is the fallback.
  const companyName = sanitizeReportText(contact?.company_name)
    || sanitizeReportText(whitelabel?.company_name)
    || FALLBACK_COMPANY_NAME;

  // Prefer the auth logo: it is the full lock-up sized for a light surface,
  // which is what a printed page is. The sidebar logo is optimised for a dark
  // rail and often reversed out to white — invisible on paper.
  const logo = await fetchLogo(whitelabel?.auth_logo ?? whitelabel?.sidebar_logo);

  return {
    companyName,
    brandHex: toHex(whitelabel?.primary_color, FALLBACK_BRAND_HEX),
    accentHex: toHex(whitelabel?.accent_color, FALLBACK_ACCENT_HEX),
    contactRows: companyContactRows(contact ?? null),
    logo,
    resolvedAt,
  };
}

/** Strip the leading `#` — exceljs and docx both want bare hex. */
export function bareHex(hex: string): string {
  return hex.replace(/^#/, '').toUpperCase();
}

/** exceljs wants ARGB. */
export function argb(hex: string): string {
  return `FF${bareHex(hex)}`;
}

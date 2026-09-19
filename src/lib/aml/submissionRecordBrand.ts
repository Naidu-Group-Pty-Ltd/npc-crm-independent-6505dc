/**
 * Who a submission record PDF is issued BY — the white-label identity.
 *
 * A workspace that has configured its brand (a company name in White-Label
 * settings) issues the record under that identity: its name, its colour
 * ramp, its report logo. A workspace that has not falls back to **Aurixa
 * Systems**, the platform identity — never to an empty masthead, and never
 * to another tenant's marks.
 *
 * The colour ramp comes from `getBrandPdfPalette`, the SAME resolver every
 * other white-labelled PDF in this repo uses, so the record picks up a
 * tenant's colour exactly where their reports do. The default ramp it falls
 * back to is the Aurixa aurora gold (`43 74%`), which is why the fallback
 * needs no palette of its own.
 *
 * The logo is loaded to a data URL at generation time and embedded — the
 * PDF must stay self-contained. A logo that cannot be fetched, or is not a
 * raster format jsPDF can draw (PNG/JPEG), degrades to the text wordmark
 * rather than failing the download: identity is required, a picture is not.
 */
import { getBrandAssetSrc } from '@/branding/brand-assets';
import { getBrandPdfPalette } from '@/branding/brandPalette';
import { hslToHex } from '@/branding/color-utils';
import type { BrandConfig } from '@/branding/brand-types';

export const AURIXA_FALLBACK_NAME = 'Aurixa Systems';

/** The Aurixa delta emblem, downscaled from `aurixa-emblem.png` (700px,
 *  482KB) to 240px/78KB — at the masthead's 8mm that is still ~760dpi, and
 *  it is embedded into every fallback download. */
export const AURIXA_EMBLEM_PATH = '/brand/aurixa-emblem-240.png';

/** The Aurixa Compliance Passport cover ground — the deep navy the emblem
 *  and gold wordmark sit on (≈#131f38, sampled from the Passport cover).
 *  Fallback documents wear it; a tenant brand keeps the neutral obsidian,
 *  because the navy IS Aurixa's. Derived like the obsidian, not a hex
 *  literal — the print palette has no CSS cascade to read tokens from. */
const AURIXA_NAVY_HEX = hslToHex('220 49% 15%');

/** The default company name the brand store ships with — a workspace still
 *  carrying it has not integrated a brand. */
const UNBRANDED_COMPANY_NAMES = new Set(['', 'dashboard']);

export interface RecordBrand {
  /** The issuing identity printed on the document. */
  name: string;
  /** True when the workspace's own brand is in use; false on the Aurixa fallback. */
  tenantBranded: boolean;
  /** Accent ramp, as hex. Decorative surfaces only — body ink stays neutral. */
  accent: string;
  accentDeep: string;
  accentLight: string;
  accentPale: string;
  /** The dark masthead ground — one flat hex, per the print rules. */
  ground: string;
  /** Raster logo as a data URL, or null for the text wordmark. */
  logoDataUrl: string | null;
  /** True when the logo is a bare emblem that does not carry the name —
   *  the wordmark is then drawn beside it. Tenant report logos are assumed
   *  to be complete lockups and stand alone. */
  wordmarkBesideLogo: boolean;
}

/** The masthead ground: the Aurixa obsidian token (`--aurixa-obsidian`),
 *  resolved to hex once here rather than re-typed. */
const OBSIDIAN_HEX = hslToHex('34 20% 12%');

export function resolveRecordBrand(
  settings: Pick<BrandConfig, 'companyName' | 'brandColor'>,
): RecordBrand {
  const company = (settings.companyName ?? '').trim();
  const tenantBranded = !UNBRANDED_COMPANY_NAMES.has(company.toLowerCase());
  const palette = getBrandPdfPalette(settings.brandColor);
  return {
    name: tenantBranded ? company : AURIXA_FALLBACK_NAME,
    tenantBranded,
    accent: palette.gold,
    accentDeep: palette.goldDeep,
    accentLight: palette.goldLight,
    accentPale: palette.goldPale,
    ground: tenantBranded ? OBSIDIAN_HEX : AURIXA_NAVY_HEX,
    logoDataUrl: null,
    wordmarkBesideLogo: !tenantBranded,
  };
}

/** PNG/JPEG only: jsPDF's addImage cannot draw an SVG, and silently drawing
 *  nothing would print a branded document with a hole where the mark goes. */
const RASTER_TYPES = new Set(['image/png', 'image/jpeg']);

/**
 * Fetch the identity's mark and inline it: the workspace's own report logo,
 * or — on the Aurixa fallback — the Aurixa delta emblem the Compliance
 * Passport cover carries. Best-effort by design: every failure path returns
 * null and the caller prints the wordmark. A tenant-branded workspace with
 * no logo gets its wordmark, never Aurixa's mark — the fallback is an
 * identity, not a decoration.
 */
export async function loadRecordBrandLogo(
  settings: Pick<
    BrandConfig,
    'authLogo' | 'sidebarLogo' | 'sidebarIcon' | 'favicon' | 'reportLogo' | 'reportMonoLogo'
  >,
  tenantBranded = true,
): Promise<string | null> {
  try {
    const src = tenantBranded ? getBrandAssetSrc(settings, 'report') : AURIXA_EMBLEM_PATH;
    if (!src) return null;
    if (src.startsWith('data:')) {
      const mime = src.slice(5, src.indexOf(';'));
      return RASTER_TYPES.has(mime) ? src : null;
    }
    const response = await fetch(src);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!RASTER_TYPES.has(blob.type)) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

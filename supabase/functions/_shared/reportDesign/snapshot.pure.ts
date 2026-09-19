/**
 * The brand snapshot — everything a report needs to know about who issued it,
 * frozen at generation time.
 *
 * ## Why a snapshot rather than a lookup
 *
 * A report is a dated artefact. A client who asks for a re-issue of the
 * assessment they were given eighteen months ago should receive the same
 * document, not one wearing whatever the tenant's branding happens to be today
 * — and if the tenant has since rotated their logo bucket, a lookup does not
 * even produce a document, it produces a missing image.
 *
 * The precedent is already in the schema: `client_fact_find_brand_snapshots`
 * with `client_fact_find_outputs.branding_snapshot_id ON DELETE RESTRICT`
 * (migration `20260801120000`). This is the same idea generalised, with one
 * change — snapshots are **deduplicated by content fingerprint** rather than
 * written one-per-artefact. A tenant's brand changes a handful of times a year
 * and renders a thousand reports; a row per render is a thousand identical
 * rows.
 *
 * ## What is *not* in here
 *
 * Colours other than the brand colour. Category B semantics are fixed and
 * Category C surfaces come from the preset — snapshotting them would let a
 * year-old report resurrect a palette the product has since corrected for
 * contrast. Only what genuinely belongs to the tenant is frozen.
 *
 * Pure: sibling `.pure` imports only, no I/O, no clock. `capturedAt` is an
 * input, because a snapshot that stamps itself is a snapshot that cannot be
 * tested or reproduced.
 */
import { hexToHsl, hslToHex } from './color.pure.ts';
import type { ReportPreset } from './brandResolve.pure.ts';
import type { CompanyContact, CompanyDisclaimer } from './companyBlock.pure.ts';
import {
  resolveReportAsset,
  type BrandAssetMap,
  type AssetRejection,
  type BrandLogoKey,
} from './assets.pure.ts';

/**
 * Bumped when the shape changes in a way that makes an old row unreadable.
 *
 * A stored snapshot carries its version, so a reader can refuse rather than
 * silently mis-map an old row onto a new field.
 */
export const REPORT_SNAPSHOT_VERSION = 1;

export interface SnapshotCompany {
  name: string;
  tradingName: string;
  abn: string;
  website: string;
  email: string;
  phone: string;
  address: string;
}

export interface SnapshotDocument {
  /** e.g. "Confidential · Strategic advisory". Printed on the cover foot. */
  confidentiality: string;
  /** Default "prepared by" line when the caller supplies none. */
  preparedBy: string;
}

export interface ReportBrandSnapshot {
  version: number;
  company: SnapshotCompany;
  /**
   * The tenant's Category A colour as `#RRGGBB`, or null for the house brand.
   *
   * Normalised to hex here — `whitelabel_settings` stores either a bare HSL
   * triplet (`43 74% 49%`) or a hex, and `resolveReportPalette` takes hex. Doing
   * the conversion once, at snapshot time, is what stops every consumer
   * carrying its own parser.
   */
  brandHex: string | null;
  preset: ReportPreset;
  /** Inlined marks. `null` when the tenant has none that pass asset policy. */
  logo: {
    /** The mark for paper grounds. */
    report: string | null;
    /** The mark for the dark cover and closing grounds. */
    mono: string | null;
  };
  document: SnapshotDocument;
  source: {
    /** `whitelabel_settings.id` this was read from, if any. */
    whitelabelSettingId: string | null;
    /** `whitelabel_settings.theme_version`. */
    themeVersion: number | null;
    /** ISO-8601. Supplied by the caller — this module has no clock. */
    capturedAt: string;
  };
  /** Content hash. Set by `buildReportBrandSnapshot`; see `snapshotFingerprint`. */
  fingerprint: string;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
const HSL_TRIPLET = /^\d{1,3}\s+\d{1,3}%?\s+\d{1,3}%?$/;

/**
 * `whitelabel_settings` colour → `#RRGGBB`, or null.
 *
 * The column accepts a bare HSL triplet, a 6-digit hex or a 3-digit hex — the
 * validator trigger in migration `20260423175929` permits all three — so all
 * three arrive here. Anything else is dropped rather than guessed at: a
 * malformed brand colour should print the house brand, not a colour derived
 * from a typo.
 */
export function normalizeBrandColour(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (HEX.test(raw)) return raw.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const [, r, g, b] = raw.match(/^#(.)(.)(.)$/)!;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (HSL_TRIPLET.test(raw)) {
    const hex = hslToHex(raw);
    // `hslToHex` has a fallback for unparseable input; round-tripping proves the
    // parse actually happened rather than trusting the fallback.
    return HEX.test(hex) && hexToHsl(hex) ? hex.toUpperCase() : null;
  }
  return null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export interface BuildSnapshotInput {
  /** `whitelabel_settings.theme_config` / `company_name` / `logo_config`. */
  whitelabel?: {
    id?: string | null;
    themeVersion?: number | null;
    companyName?: string | null;
    tradingName?: string | null;
    brandColour?: string | null;
    preset?: string | null;
    assets?: BrandAssetMap | null;
  } | null;
  /** `global_report_settings.contact_details` — the only place with an ABN. */
  contact?: CompanyContact | null;
  /** Cover foot and default by-line. */
  document?: Partial<SnapshotDocument> | null;
  /** ISO-8601. Required — see the module comment. */
  capturedAt: string;
}

const PRESETS: readonly ReportPreset[] = [
  'signature', 'editorial_navy', 'minimal_ink', 'high_contrast',
];

export interface BuildSnapshotResult {
  snapshot: ReportBrandSnapshot;
  /**
   * Assets present in `logo_config` that failed policy, with the reason.
   *
   * Surfaced rather than swallowed: "the logo did not appear" is a support
   * ticket, and *too large* / *wrong format* / *never uploaded* are three
   * different answers.
   */
  skippedAssets: Array<{ source: BrandLogoKey; reason: AssetRejection; detail: string }>;
}

/**
 * Build the snapshot.
 *
 * Total: every field has a defined value for any input, because a render that
 * throws because a tenant left `tradingName` blank is worse than one that
 * prints nothing there.
 */
export function buildReportBrandSnapshot(input: BuildSnapshotInput): BuildSnapshotResult {
  const wl = input.whitelabel ?? {};
  const contact = input.contact ?? {};
  const assets = wl.assets ?? {};

  const reportMark = resolveReportAsset(assets, 'report');
  const monoMark = resolveReportAsset(assets, 'report-mono');

  const presetCandidate = text(wl.preset);
  const preset = (PRESETS as readonly string[]).includes(presetCandidate)
    ? presetCandidate as ReportPreset
    : 'signature';

  const company: SnapshotCompany = {
    // The white-label name wins: it is what the tenant configured for their
    // documents. `contact_details.company_name` is the older field and is the
    // fallback rather than the source.
    name: text(wl.companyName) || text(contact.company_name),
    tradingName: text(wl.tradingName),
    abn: text(contact.abn),
    website: text(contact.website),
    email: text(contact.email),
    phone: text(contact.phone),
    address: text(contact.address),
  };

  const snapshot: ReportBrandSnapshot = {
    version: REPORT_SNAPSHOT_VERSION,
    company,
    brandHex: normalizeBrandColour(wl.brandColour),
    preset,
    logo: {
      report: reportMark.resolved?.asset.dataUri ?? null,
      mono: monoMark.resolved?.asset.dataUri ?? null,
    },
    document: {
      confidentiality: text(input.document?.confidentiality),
      preparedBy: text(input.document?.preparedBy),
    },
    source: {
      whitelabelSettingId: text(wl.id) || null,
      themeVersion: typeof wl.themeVersion === 'number' ? wl.themeVersion : null,
      capturedAt: input.capturedAt,
    },
    fingerprint: '',
  };

  snapshot.fingerprint = snapshotFingerprint(snapshot);

  // De-duplicate: the same key can be skipped by both slot walks.
  const seen = new Set<string>();
  const skippedAssets = [...reportMark.skipped, ...monoMark.skipped].filter((s) => {
    const key = `${s.source}:${s.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { snapshot, skippedAssets };
}

/** Deterministic JSON with sorted keys, so the hash does not depend on key order. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'fingerprint')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * 64-bit FNV-1a over the canonical form, as 16 lowercase hex characters.
 *
 * **A change detector, not a security primitive.** Its job is "is this the same
 * brand state as the row already stored", so that a thousand renders of an
 * unchanged brand reuse one row. Nothing authenticates a snapshot with it, and
 * nothing should — a collision costs a reused row, not a forged document.
 *
 * FNV rather than SHA-256 because this module is pure and synchronous:
 * `crypto.subtle.digest` is async and would make every caller async for a
 * dedupe key.
 */
export function snapshotFingerprint(snapshot: ReportBrandSnapshot): string {
  const input = canonicalJson(snapshot);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i += 1) {
    // Hash UTF-16 code units as bytes so a multibyte character contributes both
    // halves — a company name is frequently non-ASCII.
    const code = input.charCodeAt(i);
    hash = ((hash ^ BigInt(code & 0xff)) * prime) & mask;
    hash = ((hash ^ BigInt((code >> 8) & 0xff)) * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

// ── Adapters ────────────────────────────────────────────────────────────────
//
// A snapshot is the one input the render layer needs; these turn it into the
// shapes the existing modules already take, so nothing downstream grows a
// second notion of "the brand".

/** Input for `resolveReportPalette()`. */
export function paletteInputFor(
  snapshot: ReportBrandSnapshot,
): { preset: ReportPreset; brandHex: string | null } {
  return { preset: snapshot.preset, brandHex: snapshot.brandHex };
}

/** Input for `resolveCompanyBlock()` and `mastheadFor()`. */
export function companyContactFor(snapshot: ReportBrandSnapshot): CompanyContact {
  return {
    company_name: snapshot.company.name,
    website: snapshot.company.website,
    email: snapshot.company.email,
    phone: snapshot.company.phone,
    address: snapshot.company.address,
    abn: snapshot.company.abn,
  };
}

/** Props for `renderBrandLockup()` on a given ground. */
export function lockupFor(
  snapshot: ReportBrandSnapshot,
  ground: 'paper' | 'field',
): { markDataUri: string | null; markAlt: string; wordmark: string | null; onField: boolean } | null {
  const mark = ground === 'field' ? snapshot.logo.mono : snapshot.logo.report;
  const wordmark = snapshot.company.tradingName || snapshot.company.name;
  if (!mark && !wordmark) return null;
  return {
    markDataUri: mark,
    markAlt: wordmark || 'Brand mark',
    // With a mark present the wordmark would repeat it; without one it *is* the
    // lockup.
    wordmark: mark ? null : wordmark,
    onField: ground === 'field',
  };
}

/**
 * Everything a snapshot is missing that a client-facing report needs.
 *
 * Empty for a complete snapshot. This is advisory, not a gate: a report with no
 * ABN is a worse report, not an impossible one, and blocking the render would
 * turn a cosmetic gap into an outage. The exception a caller *should* gate on
 * is the disclaimer, which is handled separately by `resolveCompanyBlock`.
 */
export function auditSnapshot(
  snapshot: ReportBrandSnapshot,
  disclaimer?: CompanyDisclaimer | null,
): string[] {
  const gaps: string[] = [];
  if (snapshot.version !== REPORT_SNAPSHOT_VERSION) {
    gaps.push(`snapshot version ${snapshot.version} was written by a different release`);
  }
  if (!snapshot.company.name) gaps.push('no company name — the running foot will read as generic');
  if (!snapshot.logo.report && !snapshot.logo.mono) gaps.push('no brand mark passed asset policy');
  if (!snapshot.company.abn) gaps.push('no ABN — required on an Australian advisory document');
  if (!snapshot.company.email && !snapshot.company.phone) {
    gaps.push('no contact route on the closing page');
  }
  // Absent counts, not just disabled.
  //
  // This guarded on `disclaimer &&`, so the two ways it goes missing *without
  // anybody choosing that* were the two it stayed silent about: an unreadable
  // `global_report_settings` query, which the render routes warn and swallow,
  // and a settings row that was never written. Both arrive here as `null` and
  // both printed a closing page with no disclaimer and no gap recorded.
  //
  // A general-advice disclaimer is not decoration on a lending document.
  if (!disclaimer) {
    gaps.push('no professional disclaimer was found in the report settings');
  } else if (!disclaimer.is_enabled) {
    gaps.push('the professional disclaimer is disabled');
  } else if (!String(disclaimer.text ?? '').trim()) {
    gaps.push('the professional disclaimer is enabled but empty');
  }
  return gaps;
}

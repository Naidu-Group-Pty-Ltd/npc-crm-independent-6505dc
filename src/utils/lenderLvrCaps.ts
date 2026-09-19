/**
 * Per-Security LVR Caps — Phase I7
 *
 * APRA does not set a single LVR cap; lenders set per-security ceilings that
 * differ by purchase intent, property category, and borrower profile (FHB
 * concessions, foreign-buyer haircuts, lender appetite for high-LVR risk).
 *
 * BEFORE this module the engine used a single hard-coded `0.95` for both
 * equity-release (`equity_release` delta) and cross-collateralised pool
 * release (`portfolio_lvr_release` delta) regardless of whether the security
 * was an owner-occupied PPR or an investment property. That overstated
 * release potential on INV deals (real-world cap ~80–90%) and understated
 * it on OO deals at lenders that allow 97% with capitalised LMI.
 *
 * ── Source-of-truth ─────────────────────────────────────────────────────
 *  - APRA Prudential Standard APS 220 (lending standards)
 *  - Lender policy docs (CBA, ANZ, NAB, Westpac, Macquarie) FY24-25
 *  - Conservative bias — engine returns LOWER bound when policies vary
 *
 * ── Used by ─────────────────────────────────────────────────────────────
 *  - `scenarioDeltaEngine.ts` (`equity_release`, `portfolio_lvr_release`)
 *  - `computeAcquisitionCapacity` (max purchase price LMI ceiling)
 *  - PDF rationale (per-security cap shown alongside release math)
 */

export type PropertyIntent = 'owner_occupier' | 'investment' | 'rental';
export type PropertyKind =
  | 'established'
  | 'new_build'
  | 'off_the_plan'
  | 'vacant_land'
  | 'construction'
  | 'rural'
  | 'commercial';

/** A single lender's per-security cap matrix. Values are LVR ratios (0–1). */
export interface LenderLvrCapMatrix {
  /** Lender id matching `LENDER_PROFILES` in `lenderShadingProfiles.ts`. */
  lenderId: string;
  /** OO caps by property kind. Default 0.95 (with capitalised LMI on most). */
  ownerOccupier: Partial<Record<PropertyKind, number>> & { default: number };
  /** Investment caps by property kind. Default 0.90 (most lenders). */
  investment: Partial<Record<PropertyKind, number>> & { default: number };
  /** FHB scheme uplift — adds to OO cap when isFirstHomeBuyer (e.g. +0.02). */
  firstHomeBuyerUplift?: number;
  /** Foreign-buyer haircut — subtracted from cap (e.g. -0.10). */
  foreignBuyerHaircut?: number;
}

// ── Profiles ────────────────────────────────────────────────────────────

export const BANK_STANDARD_LVR_CAPS: LenderLvrCapMatrix = {
  lenderId: 'bank_standard',
  ownerOccupier: {
    default: 0.95,
    established: 0.95,
    new_build: 0.95,
    off_the_plan: 0.90,
    vacant_land: 0.80,
    construction: 0.95,
    rural: 0.80,
    commercial: 0.70,
  },
  investment: {
    default: 0.90,
    established: 0.90,
    new_build: 0.90,
    off_the_plan: 0.85,
    vacant_land: 0.75,
    construction: 0.90,
    rural: 0.70,
    commercial: 0.65,
  },
  firstHomeBuyerUplift: 0.02,
  foreignBuyerHaircut: 0.10,
};

export const ANZ_LVR_CAPS: LenderLvrCapMatrix = {
  lenderId: 'anz',
  ownerOccupier: { default: 0.95, vacant_land: 0.80, construction: 0.95, rural: 0.80, commercial: 0.70 },
  investment: { default: 0.90, vacant_land: 0.75, construction: 0.90, rural: 0.70, commercial: 0.65 },
  firstHomeBuyerUplift: 0.02,
  foreignBuyerHaircut: 0.10,
};

export const MACQUARIE_LVR_CAPS: LenderLvrCapMatrix = {
  lenderId: 'macquarie',
  // Macquarie pushes 95% OO with strong serviceability; INV capped 90%
  ownerOccupier: { default: 0.95, vacant_land: 0.80, construction: 0.90, off_the_plan: 0.90 },
  investment: { default: 0.90, vacant_land: 0.70, construction: 0.85, off_the_plan: 0.85 },
  firstHomeBuyerUplift: 0,
  foreignBuyerHaircut: 0.20, // Macquarie much stricter on non-residents
};

export const WESTPAC_LVR_CAPS: LenderLvrCapMatrix = {
  lenderId: 'westpac',
  ownerOccupier: { default: 0.95, vacant_land: 0.80, construction: 0.95, off_the_plan: 0.90 },
  investment: { default: 0.90, vacant_land: 0.75, construction: 0.90, off_the_plan: 0.85 },
  firstHomeBuyerUplift: 0.02,
  foreignBuyerHaircut: 0.10,
};

export const NON_BANK_LVR_CAPS: LenderLvrCapMatrix = {
  lenderId: 'non_bank',
  // Non-banks push 97-98% OO and 90-95% INV with risk-priced LMI
  ownerOccupier: { default: 0.98, vacant_land: 0.85, construction: 0.95, off_the_plan: 0.90, established: 0.98 },
  investment: { default: 0.95, vacant_land: 0.80, construction: 0.90, off_the_plan: 0.90 },
  firstHomeBuyerUplift: 0,
  foreignBuyerHaircut: 0.05,
};

export const LVR_CAP_MATRICES: Record<string, LenderLvrCapMatrix> = {
  bank_standard: BANK_STANDARD_LVR_CAPS,
  anz: ANZ_LVR_CAPS,
  macquarie: MACQUARIE_LVR_CAPS,
  westpac: WESTPAC_LVR_CAPS,
  non_bank: NON_BANK_LVR_CAPS,
};

/** Resolve a lender id to its LVR matrix; falls back to bank_standard. */
export function resolveLvrCapMatrix(lenderId?: string | null): LenderLvrCapMatrix {
  if (!lenderId) return BANK_STANDARD_LVR_CAPS;
  return LVR_CAP_MATRICES[lenderId.toLowerCase().trim()] ?? BANK_STANDARD_LVR_CAPS;
}

/** Map the engine's free-text `propertyType` to a `PropertyKind` enum.
 *  Used at the call site since `ScenarioProperty.propertyType` is a string. */
export function inferPropertyKind(propertyType?: string): PropertyKind {
  const t = (propertyType || '').toLowerCase().trim();
  if (t.includes('vacant') || t.includes('land')) return 'vacant_land';
  if (t.includes('off-the-plan') || t.includes('off_the_plan') || t.includes('otp')) return 'off_the_plan';
  if (t.includes('construction') || t.includes('build')) return 'construction';
  if (t.includes('rural') || t.includes('farm')) return 'rural';
  if (t.includes('commercial') || t.includes('industrial')) return 'commercial';
  if (t.includes('new')) return 'new_build';
  return 'established';
}

/** Map propertyType to OO/INV intent for cap selection. */
export function inferPropertyIntent(propertyType?: string, fallback: PropertyIntent = 'investment'): PropertyIntent {
  const t = (propertyType || '').toLowerCase().trim();
  if (t.includes('owner') || t.includes('ppr') || t === 'principal' || t === 'home') return 'owner_occupier';
  if (t.includes('invest') || t.includes('rental')) return 'investment';
  return fallback;
}

export interface ResolveLvrCapInput {
  lenderId?: string;
  intent: PropertyIntent;
  kind: PropertyKind;
  isFirstHomeBuyer?: boolean;
  isForeignBuyer?: boolean;
  /** Optional explicit override from the delta — clamps the resolved cap. */
  explicitCap?: number;
}

export interface ResolveLvrCapResult {
  cap: number;
  matrix: LenderLvrCapMatrix;
  reason: string;
}

/** The single entry point used by `scenarioDeltaEngine.ts` to derive a
 *  per-security cap. Always returns a number in (0, 0.99]. */
export function resolveLvrCap(input: ResolveLvrCapInput): ResolveLvrCapResult {
  const matrix = resolveLvrCapMatrix(input.lenderId);
  const table = input.intent === 'owner_occupier' ? matrix.ownerOccupier : matrix.investment;
  const baseCap = table[input.kind] ?? table.default;
  let adjusted = baseCap;
  const reasons: string[] = [`${matrix.lenderId} ${input.intent} ${input.kind} base ${(baseCap * 100).toFixed(0)}%`];
  if (input.isFirstHomeBuyer && matrix.firstHomeBuyerUplift && input.intent === 'owner_occupier') {
    adjusted += matrix.firstHomeBuyerUplift;
    reasons.push(`+${(matrix.firstHomeBuyerUplift * 100).toFixed(0)}% FHB`);
  }
  if (input.isForeignBuyer && matrix.foreignBuyerHaircut) {
    adjusted -= matrix.foreignBuyerHaircut;
    reasons.push(`-${(matrix.foreignBuyerHaircut * 100).toFixed(0)}% foreign`);
  }
  // Clamp to sane band
  let cap = Math.max(0.5, Math.min(0.99, adjusted));
  // Honour explicit override but never EXCEED policy cap (broker can only tighten)
  if (typeof input.explicitCap === 'number' && input.explicitCap > 0 && input.explicitCap < cap) {
    cap = input.explicitCap;
    reasons.push(`override ${(cap * 100).toFixed(0)}%`);
  } else if (typeof input.explicitCap === 'number' && input.explicitCap > cap) {
    reasons.push(`requested ${(input.explicitCap * 100).toFixed(0)}% denied (policy cap ${(cap * 100).toFixed(0)}%)`);
  }
  return { cap, matrix, reason: reasons.join(' → ') };
}

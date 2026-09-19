/**
 * Per-Security LVR Caps — Phase I7 (Deno mirror)
 * STRUCTURAL TWIN of `src/utils/lenderLvrCaps.ts`. Keep in sync.
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

export interface LenderLvrCapMatrix {
  lenderId: string;
  ownerOccupier: Partial<Record<PropertyKind, number>> & { default: number };
  investment: Partial<Record<PropertyKind, number>> & { default: number };
  firstHomeBuyerUplift?: number;
  foreignBuyerHaircut?: number;
}

export const BANK_STANDARD_LVR_CAPS: LenderLvrCapMatrix = {
  lenderId: 'bank_standard',
  ownerOccupier: {
    default: 0.95, established: 0.95, new_build: 0.95, off_the_plan: 0.90,
    vacant_land: 0.80, construction: 0.95, rural: 0.80, commercial: 0.70,
  },
  investment: {
    default: 0.90, established: 0.90, new_build: 0.90, off_the_plan: 0.85,
    vacant_land: 0.75, construction: 0.90, rural: 0.70, commercial: 0.65,
  },
  firstHomeBuyerUplift: 0.02,
  foreignBuyerHaircut: 0.10,
};

export const ANZ_LVR_CAPS: LenderLvrCapMatrix = {
  lenderId: 'anz',
  ownerOccupier: { default: 0.95, vacant_land: 0.80, construction: 0.95, rural: 0.80, commercial: 0.70 },
  investment: { default: 0.90, vacant_land: 0.75, construction: 0.90, rural: 0.70, commercial: 0.65 },
  firstHomeBuyerUplift: 0.02, foreignBuyerHaircut: 0.10,
};

export const MACQUARIE_LVR_CAPS: LenderLvrCapMatrix = {
  lenderId: 'macquarie',
  ownerOccupier: { default: 0.95, vacant_land: 0.80, construction: 0.90, off_the_plan: 0.90 },
  investment: { default: 0.90, vacant_land: 0.70, construction: 0.85, off_the_plan: 0.85 },
  firstHomeBuyerUplift: 0, foreignBuyerHaircut: 0.20,
};

export const WESTPAC_LVR_CAPS: LenderLvrCapMatrix = {
  lenderId: 'westpac',
  ownerOccupier: { default: 0.95, vacant_land: 0.80, construction: 0.95, off_the_plan: 0.90 },
  investment: { default: 0.90, vacant_land: 0.75, construction: 0.90, off_the_plan: 0.85 },
  firstHomeBuyerUplift: 0.02, foreignBuyerHaircut: 0.10,
};

export const NON_BANK_LVR_CAPS: LenderLvrCapMatrix = {
  lenderId: 'non_bank',
  ownerOccupier: { default: 0.98, vacant_land: 0.85, construction: 0.95, off_the_plan: 0.90, established: 0.98 },
  investment: { default: 0.95, vacant_land: 0.80, construction: 0.90, off_the_plan: 0.90 },
  firstHomeBuyerUplift: 0, foreignBuyerHaircut: 0.05,
};

export const LVR_CAP_MATRICES: Record<string, LenderLvrCapMatrix> = {
  bank_standard: BANK_STANDARD_LVR_CAPS,
  anz: ANZ_LVR_CAPS,
  macquarie: MACQUARIE_LVR_CAPS,
  westpac: WESTPAC_LVR_CAPS,
  non_bank: NON_BANK_LVR_CAPS,
};

export function resolveLvrCapMatrix(lenderId?: string | null): LenderLvrCapMatrix {
  if (!lenderId) return BANK_STANDARD_LVR_CAPS;
  return LVR_CAP_MATRICES[lenderId.toLowerCase().trim()] ?? BANK_STANDARD_LVR_CAPS;
}

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
  explicitCap?: number;
}

export interface ResolveLvrCapResult {
  cap: number;
  matrix: LenderLvrCapMatrix;
  reason: string;
}

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
  let cap = Math.max(0.5, Math.min(0.99, adjusted));
  if (typeof input.explicitCap === 'number' && input.explicitCap > 0 && input.explicitCap < cap) {
    cap = input.explicitCap;
    reasons.push(`override ${(cap * 100).toFixed(0)}%`);
  } else if (typeof input.explicitCap === 'number' && input.explicitCap > cap) {
    reasons.push(`requested ${(input.explicitCap * 100).toFixed(0)}% denied (policy cap ${(cap * 100).toFixed(0)}%)`);
  }
  return { cap, matrix, reason: reasons.join(' → ') };
}

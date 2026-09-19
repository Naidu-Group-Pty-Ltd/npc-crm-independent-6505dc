/**
 * Lender-Aware Income Shading Profiles — Phase I1
 *
 * APRA's serviceability buffer is uniform, but **income shading is lender-
 * specific**: the same client looks better at ANZ than at NAB if their
 * income mix is bonus + rental heavy, because ANZ accepts 100% of bonus
 * with 2 years' history, NAB shades it to 80%.
 *
 * Before this module the scenario engine used a static `blendedShadingRatio`
 * (shaded / gross) regardless of which lender the broker switched to via
 * `dtiCapOverride`. That's the gap report item #1 — when a scenario flips
 * lender to model a 7.5x DTI cap (ANZ / Macquarie / Westpac territory) the
 * shading should ALSO update because that lender's policy is more generous.
 *
 * ── Source-of-truth ─────────────────────────────────────────────────────
 * Numbers are based on broker-published lender policy as of FY24-25. They
 * are intentionally CONSERVATIVE (we'd rather under-promise than book a
 * deal that gets declined). Update via product policy reviews — do NOT
 * edit ad-hoc per scenario.
 *
 * ── Used by ─────────────────────────────────────────────────────────────
 *  • `src/utils/scenarioDeltaEngine.ts`         (client preview)
 *  • `supabase/functions/_shared/scenarioDeltaEngine.ts` (server replay)
 *  • `supabase/functions/bc-scenario-agent/aiScenarioPreview.ts` (chat)
 */

/** Categorical income component types the engine recognises. */
export type IncomeComponentType =
  | 'base_salary'
  | 'overtime_essential'
  | 'overtime_non_essential'
  | 'bonus'
  | 'commission'
  | 'allowance'
  | 'rental_residential'
  | 'rental_commercial'
  | 'self_employed'
  | 'investment_dividend'
  | 'family_tax_benefit'
  | 'centrelink_other'
  | 'child_support'
  | 'other';

/** A single income line as carried by the engine. */
export interface ScenarioIncomeComponent {
  /** Stable id (sourceId or composite key) */
  id: string;
  /** Human-readable label, e.g. "Primary Bonus" */
  label: string;
  /** Categorical type — drives lender-aware shading lookup. */
  type: IncomeComponentType;
  /** Annual gross amount in AUD. */
  grossAnnual: number;
  /** Per-line shading rate currently applied (0–1). The engine will
   *  re-derive this when a lender profile flips, BUT keeps the original
   *  for waterfall attribution. */
  currentShadingRate: number;
}

/** A lender profile is a complete shading map. Components missing from the
 *  map default to the bank-standard APRA-aligned ratios. */
export interface LenderShadingProfile {
  id: string;
  displayName: string;
  /** Per-component rate. 1.0 = 100% accepted; 0.8 = 80% (the APRA "shading"). */
  shading: Partial<Record<IncomeComponentType, number>>;
  /** When true, the lender will use the HIGHER of declared expenses or HEM
   *  (default APRA behaviour). Some non-banks accept declared as long as
   *  it's plausible — set false to skip the HEM floor for that lender. */
  enforcesHemFloor: boolean;
  /** Optional max-DTI hint — informational only; the engine reads
   *  dti_cap_change deltas as the binding limit. */
  maxDtiHint?: number;
}

// ── Profiles ────────────────────────────────────────────────────────────

/** Default APRA-aligned conservative profile. Used when no lender is
 *  specified — produces parity with the legacy `blendedShadingRatio`
 *  behaviour for clients with a typical PAYG + rental income mix. */
export const BANK_STANDARD_PROFILE: LenderShadingProfile = {
  id: 'bank_standard',
  displayName: 'Bank Standard (APRA-aligned)',
  shading: {
    base_salary: 1.00,
    overtime_essential: 1.00,
    overtime_non_essential: 0.80,
    bonus: 0.80,
    commission: 0.80,
    allowance: 0.80,
    rental_residential: 0.80,
    rental_commercial: 0.75,
    self_employed: 0.80,
    investment_dividend: 0.80,
    family_tax_benefit: 1.00,
    centrelink_other: 0.50,
    child_support: 0.80,
    other: 0.80,
  },
  enforcesHemFloor: true,
  maxDtiHint: 6,
};

/** ANZ-style profile: more generous on bonuses/commission with 2yr history,
 *  willing to push DTI to 7.5x with policy support. Used when the broker
 *  flips `dtiCapOverride.value >= 7.5` AND tags `lenderProfile = 'anz'`. */
export const ANZ_PROFILE: LenderShadingProfile = {
  id: 'anz',
  displayName: 'ANZ (policy)',
  shading: {
    base_salary: 1.00,
    overtime_essential: 1.00,
    overtime_non_essential: 0.90,
    bonus: 1.00,                 // 100% with 2yr history
    commission: 1.00,             // 100% with 2yr history
    allowance: 1.00,
    rental_residential: 0.80,
    rental_commercial: 0.80,
    self_employed: 0.80,
    investment_dividend: 0.80,
    family_tax_benefit: 1.00,
    centrelink_other: 0.50,
    child_support: 0.80,
    other: 0.80,
  },
  enforcesHemFloor: true,
  maxDtiHint: 7.5,
};

/** Macquarie-style profile: high-DTI appetite, more generous rental
 *  shading via interest-only buffers. */
export const MACQUARIE_PROFILE: LenderShadingProfile = {
  id: 'macquarie',
  displayName: 'Macquarie (policy)',
  shading: {
    base_salary: 1.00,
    overtime_essential: 1.00,
    overtime_non_essential: 0.85,
    bonus: 0.95,
    commission: 0.95,
    allowance: 0.90,
    rental_residential: 0.80,
    rental_commercial: 0.80,
    self_employed: 0.85,
    investment_dividend: 0.80,
    family_tax_benefit: 1.00,
    centrelink_other: 0.50,
    child_support: 0.80,
    other: 0.80,
  },
  enforcesHemFloor: true,
  maxDtiHint: 7.5,
};

/** Westpac-style profile: 7x cap with policy, similar to ANZ on bonus. */
export const WESTPAC_PROFILE: LenderShadingProfile = {
  id: 'westpac',
  displayName: 'Westpac (policy)',
  shading: {
    base_salary: 1.00,
    overtime_essential: 1.00,
    overtime_non_essential: 0.85,
    bonus: 0.95,
    commission: 0.95,
    allowance: 0.90,
    rental_residential: 0.80,
    rental_commercial: 0.80,
    self_employed: 0.80,
    investment_dividend: 0.80,
    family_tax_benefit: 1.00,
    centrelink_other: 0.50,
    child_support: 0.80,
    other: 0.80,
  },
  enforcesHemFloor: true,
  maxDtiHint: 7,
};

/** Non-bank profile: typically allows 8x+ DTI and skips strict HEM floor
 *  in favour of plausibility-checked declared expenses. */
export const NON_BANK_PROFILE: LenderShadingProfile = {
  id: 'non_bank',
  displayName: 'Non-Bank Lender',
  shading: {
    base_salary: 1.00,
    overtime_essential: 1.00,
    overtime_non_essential: 0.90,
    bonus: 1.00,
    commission: 1.00,
    allowance: 1.00,
    rental_residential: 0.80,
    rental_commercial: 0.80,
    self_employed: 0.85,
    investment_dividend: 0.85,
    family_tax_benefit: 1.00,
    centrelink_other: 0.65,
    child_support: 1.00,
    other: 0.85,
  },
  enforcesHemFloor: false,
  maxDtiHint: 9,
};

/** All known profiles, keyed by id. Add new profiles here. */
export const LENDER_PROFILES: Record<string, LenderShadingProfile> = {
  bank_standard: BANK_STANDARD_PROFILE,
  anz: ANZ_PROFILE,
  macquarie: MACQUARIE_PROFILE,
  westpac: WESTPAC_PROFILE,
  non_bank: NON_BANK_PROFILE,
};

/** Resolve a profile id (or free-text lender name) to a profile.
 *  Falls back to bank standard on unknown id — the engine never crashes
 *  on an unrecognised lender, it just uses APRA defaults and logs a
 *  validation note via the caller. */
export function resolveLenderProfile(
  idOrName?: string | null,
): LenderShadingProfile {
  if (!idOrName) return BANK_STANDARD_PROFILE;
  const key = idOrName.toLowerCase().trim();
  if (LENDER_PROFILES[key]) return LENDER_PROFILES[key];
  // Loose match on display name fragments
  for (const profile of Object.values(LENDER_PROFILES)) {
    if (key.includes(profile.id)) return profile;
    if (profile.displayName.toLowerCase().includes(key)) return profile;
  }
  return BANK_STANDARD_PROFILE;
}

/** Recompute the total shaded annual income for a list of components
 *  using the supplied lender profile. Components without a profile entry
 *  fall back to the BANK_STANDARD rate for that type, then to 0.8. */
export function reshadeIncome(
  components: ScenarioIncomeComponent[],
  profile: LenderShadingProfile,
): { shadedAnnual: number; perComponent: Array<ScenarioIncomeComponent & { newShadingRate: number; newShadedAnnual: number }> } {
  let total = 0;
  const perComponent = components.map(c => {
    const fromProfile = profile.shading[c.type];
    const fromBank = BANK_STANDARD_PROFILE.shading[c.type];
    const rate = typeof fromProfile === 'number'
      ? fromProfile
      : (typeof fromBank === 'number' ? fromBank : 0.8);
    const newShadedAnnual = Math.max(0, c.grossAnnual) * rate;
    total += newShadedAnnual;
    return { ...c, newShadingRate: rate, newShadedAnnual };
  });
  return { shadedAnnual: total, perComponent };
}

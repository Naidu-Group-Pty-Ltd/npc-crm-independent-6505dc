/**
 * Versioned policy and assumptions layer.
 *
 * No lender's policy is treated as universal truth. A calculation resolves its
 * assumptions through four layers, each one able to override the last:
 *
 *   1. platform defaults        (this file, versioned)
 *   2. organisation settings    (persisted; supplied by the caller)
 *   3. lender policy profile    (reuses `lenderPolicyProfiles`)
 *   4. scenario overrides       (per-assessment, per-scenario)
 *
 * The resolved set is snapshotted onto every calculation run alongside
 * `POLICY_VERSION` and `CALCULATION_ENGINE_VERSION`, so a completed assessment
 * keeps producing the number it produced on the day it was completed even
 * after platform defaults move underneath it.
 */

import {
  lenderPolicyProfiles,
} from '@/utils/commercial/borrowing/lenderPolicyProfiles';
import type { LenderPolicyProfileKey } from '@/utils/commercial/borrowing/calculatorTypes';
import type { PolicyOverrides } from './types';

/** Bump when any formula changes shape. Recorded on every calculation run. */
export const CALCULATION_ENGINE_VERSION = '1.0.0';

/** Bump when the platform default assumptions below change. */
export const POLICY_VERSION = '2026.08.0';

export interface ResolvedPolicy {
  policyVersion: string;
  engineVersion: string;
  profileKey: LenderPolicyProfileKey;
  profileLabel: string;
  effectiveFrom: string;

  /** Loan-to-value ceilings, as fractions (0.65 = 65%). */
  maxLvr: number;
  hardMaxLvr: number;
  /** Loan-to-cost ceiling on total project cost. */
  maxLtc: number;

  minIcr: number;
  minDscr: number;
  minDebtYield: number;
  debtYieldEnabled: boolean;

  /** Serviceability rate construction, all on the 0-100 scale. */
  assessmentBufferPct: number;
  assessmentFloorRatePct: number;

  /** Haircuts applied to income before it is allowed to service debt. */
  rentalShadingPct: number;
  otherIncomeShadingPct: number;
  nonRecurringIncomeShadingPct: number;

  /** Existing-commitment treatment. */
  creditCardAssessmentPct: number;
  undrawnLimitAssessed: boolean;
  livingExpenseFloorAnnual: number;

  /** Minimum surplus a deal must clear after all debt service. */
  minNetSurplusRatio: number;

  /** Profiles the platform will not let a user rely on without escalation. */
  requiresSpecialistReview: boolean;

  /** Provenance of each layer that contributed, in application order. */
  layers: PolicyLayerNote[];
}

export interface PolicyLayerNote {
  layer: 'platform_default' | 'organisation' | 'lender_profile' | 'scenario_override';
  label: string;
  fields: string[];
}

export const PROFILE_LABELS: Record<LenderPolicyProfileKey, string> = {
  conservativeBank: 'Conservative bank',
  mainstreamCommercialBank: 'Mainstream commercial bank',
  nonBankCommercial: 'Non-bank commercial',
  privateCreditShortTerm: 'Private credit (short term)',
  smsfCommercial: 'SMSF commercial',
  ownerOccupiedBusinessLending: 'Owner-occupied business lending',
  custom: 'Custom profile',
};

/**
 * Platform defaults. Deliberately conservative: they are what a user gets
 * before anyone has configured anything, and an under-conservative default is
 * the one that produces a number somebody acts on.
 */
export const PLATFORM_DEFAULT_POLICY: Omit<ResolvedPolicy, 'profileKey' | 'profileLabel' | 'layers'> = {
  policyVersion: POLICY_VERSION,
  engineVersion: CALCULATION_ENGINE_VERSION,
  effectiveFrom: '2026-08-01',

  maxLvr: 0.65,
  hardMaxLvr: 0.7,
  maxLtc: 0.7,

  minIcr: 1.5,
  minDscr: 1.25,
  minDebtYield: 0.09,
  debtYieldEnabled: true,

  assessmentBufferPct: 2,
  assessmentFloorRatePct: 7.5,

  rentalShadingPct: 20,
  otherIncomeShadingPct: 20,
  nonRecurringIncomeShadingPct: 100,

  creditCardAssessmentPct: 3.8,
  undrawnLimitAssessed: true,
  livingExpenseFloorAnnual: 0,

  minNetSurplusRatio: 0,

  requiresSpecialistReview: false,
};

/** Organisation-level settings, as persisted by an administrator. */
export type OrganisationPolicySettings = Partial<
  Pick<
    ResolvedPolicy,
    | 'maxLvr' | 'hardMaxLvr' | 'maxLtc' | 'minIcr' | 'minDscr' | 'minDebtYield'
    | 'debtYieldEnabled' | 'assessmentBufferPct' | 'assessmentFloorRatePct'
    | 'rentalShadingPct' | 'otherIncomeShadingPct' | 'nonRecurringIncomeShadingPct'
    | 'creditCardAssessmentPct' | 'undrawnLimitAssessed' | 'livingExpenseFloorAnnual'
    | 'minNetSurplusRatio'
  >
>;

export interface ResolvePolicyInput {
  profileKey: LenderPolicyProfileKey;
  organisation?: OrganisationPolicySettings | null;
  overrides?: PolicyOverrides | null;
  /** Set by the assessment type (development, lease-doc) to force escalation. */
  forceSpecialistReview?: boolean;
}

function definedKeys(source: Record<string, unknown> | null | undefined): string[] {
  if (!source) return [];
  return Object.entries(source)
    .filter(([, value]) => value !== undefined && value !== null && !Number.isNaN(value as number))
    .map(([key]) => key);
}

/**
 * Resolve the four layers into the single assumption set a calculation uses.
 * The returned object is what gets snapshotted — it is the complete answer to
 * "which policy produced this number?".
 */
export function resolvePolicy(input: ResolvePolicyInput): ResolvedPolicy {
  const profile = lenderPolicyProfiles[input.profileKey] ?? lenderPolicyProfiles.mainstreamCommercialBank;
  const layers: PolicyLayerNote[] = [
    { layer: 'platform_default', label: `Platform defaults ${POLICY_VERSION}`, fields: ['all'] },
  ];

  // Layer 2 — organisation settings.
  const organisationFields = definedKeys(input.organisation as Record<string, unknown>);
  const withOrganisation: Omit<ResolvedPolicy, 'profileKey' | 'profileLabel' | 'layers'> = {
    ...PLATFORM_DEFAULT_POLICY,
    ...(input.organisation ?? {}),
  };
  if (organisationFields.length) {
    layers.push({ layer: 'organisation', label: 'Organisation settings', fields: organisationFields });
  }

  // Layer 3 — lender policy profile.
  const profileApplied = {
    ...withOrganisation,
    maxLvr: profile.maxLvr,
    hardMaxLvr: profile.hardMaxLvr ?? profile.maxLvr,
    minIcr: profile.minIcr,
    minDscr: profile.minDscr,
    minDebtYield: profile.minDebtYield,
    assessmentBufferPct: profile.assessmentBufferPct,
    assessmentFloorRatePct: profile.assessmentFloorRatePct ?? withOrganisation.assessmentFloorRatePct,
  };
  layers.push({
    layer: 'lender_profile',
    label: PROFILE_LABELS[input.profileKey] ?? input.profileKey,
    fields: ['maxLvr', 'hardMaxLvr', 'minIcr', 'minDscr', 'minDebtYield', 'assessmentBufferPct', 'assessmentFloorRatePct'],
  });

  // Layer 4 — scenario overrides.
  const overrides = input.overrides ?? {};
  const overrideFields = definedKeys(overrides as Record<string, unknown>);
  const resolved: ResolvedPolicy = {
    ...profileApplied,
    profileKey: input.profileKey,
    profileLabel: PROFILE_LABELS[input.profileKey] ?? input.profileKey,
    maxLvr: overrides.maxLvr ?? profileApplied.maxLvr,
    hardMaxLvr: overrides.hardMaxLvr ?? profileApplied.hardMaxLvr,
    minIcr: overrides.minIcr ?? profileApplied.minIcr,
    minDscr: overrides.minDscr ?? profileApplied.minDscr,
    minDebtYield: overrides.minDebtYield ?? profileApplied.minDebtYield,
    debtYieldEnabled: overrides.debtYieldEnabled ?? profileApplied.debtYieldEnabled,
    assessmentFloorRatePct: overrides.assessmentFloorRatePercent ?? profileApplied.assessmentFloorRatePct,
    rentalShadingPct: overrides.rentalShadingPercent ?? profileApplied.rentalShadingPct,
    creditCardAssessmentPct: overrides.creditCardAssessmentPercent ?? profileApplied.creditCardAssessmentPct,
    livingExpenseFloorAnnual: overrides.livingExpenseFloorAnnual ?? profileApplied.livingExpenseFloorAnnual,
    requiresSpecialistReview:
      input.forceSpecialistReview === true
      || input.profileKey === 'smsfCommercial'
      || input.profileKey === 'privateCreditShortTerm',
    layers,
  };
  if (overrideFields.length) {
    layers.push({ layer: 'scenario_override', label: 'Scenario override', fields: overrideFields });
  }

  // A hard ceiling must never sit below the soft ceiling — an override that
  // inverts them would silently widen capacity rather than narrow it.
  resolved.hardMaxLvr = Math.max(resolved.maxLvr, resolved.hardMaxLvr);
  return resolved;
}

/**
 * The rate a facility is *assessed* at, which is never the contract rate.
 * Higher of (contract + buffer) and the policy floor.
 */
export function assessmentRate(input: {
  contractRatePct: number;
  policy: ResolvedPolicy;
  bufferOverridePct?: number;
  rateOverridePct?: number;
}): { assessmentRatePct: number; basis: string } {
  const contract = Math.max(0, Number.isFinite(input.contractRatePct) ? input.contractRatePct : 0);
  if (input.rateOverridePct && input.rateOverridePct > 0) {
    return {
      assessmentRatePct: input.rateOverridePct,
      basis: `Manual assessment rate override of ${input.rateOverridePct.toFixed(2)}%.`,
    };
  }
  const buffer = input.bufferOverridePct && input.bufferOverridePct > 0
    ? input.bufferOverridePct
    : input.policy.assessmentBufferPct;
  const buffered = contract + buffer;
  const floor = input.policy.assessmentFloorRatePct;
  if (floor > buffered) {
    return {
      assessmentRatePct: floor,
      basis: `Policy floor rate of ${floor.toFixed(2)}% exceeds contract ${contract.toFixed(2)}% plus ${buffer.toFixed(2)}% buffer.`,
    };
  }
  return {
    assessmentRatePct: buffered,
    basis: `Contract rate ${contract.toFixed(2)}% plus ${buffer.toFixed(2)}% buffer.`,
  };
}

import type { LendingAssumptions, LenderPolicyProfileKey } from './calculatorTypes';

type LenderDefaults = Omit<LendingAssumptions, 'profile' | 'contractInterestRatePct' | 'loanTermYears' | 'interestOnlyPeriodYears' | 'amortisationYears' | 'debtYieldEnabled'>;

export const lenderPolicyProfiles: Record<LenderPolicyProfileKey, LenderDefaults> = {
  conservativeBank: { maxLvr: 0.6, hardMaxLvr: 0.65, minIcr: 1.75, minDscr: 1.35, assessmentBufferPct: 2, assessmentFloorRatePct: 8, assessmentBasis: 'higherOfBufferAndFloor', minDebtYield: 0.1, sponsorUpliftAllowed: false },
  mainstreamCommercialBank: { maxLvr: 0.65, hardMaxLvr: 0.7, minIcr: 1.5, minDscr: 1.25, assessmentBufferPct: 1, assessmentFloorRatePct: 0, assessmentBasis: 'contractPlusBuffer', minDebtYield: 0.09, sponsorUpliftAllowed: true },
  nonBankCommercial: { maxLvr: 0.7, hardMaxLvr: 0.75, minIcr: 1.35, minDscr: 1.15, assessmentBufferPct: 0.5, assessmentFloorRatePct: 0, assessmentBasis: 'contractPlusBuffer', minDebtYield: 0.08, sponsorUpliftAllowed: true },
  privateCreditShortTerm: { maxLvr: 0.65, hardMaxLvr: 0.7, minIcr: 1.25, minDscr: 1.1, assessmentBufferPct: 0, assessmentFloorRatePct: 0, assessmentBasis: 'interestOnlyAssessment', minDebtYield: 0.08, sponsorUpliftAllowed: false },
  smsfCommercial: { maxLvr: 0.6, hardMaxLvr: 0.6, minIcr: 1.75, minDscr: 1.35, assessmentBufferPct: 2, assessmentFloorRatePct: 8, assessmentBasis: 'higherOfBufferAndFloor', minDebtYield: 0.1, sponsorUpliftAllowed: false },
  ownerOccupiedBusinessLending: { maxLvr: 0.65, hardMaxLvr: 0.75, minIcr: 1.5, minDscr: 1.25, assessmentBufferPct: 1, assessmentFloorRatePct: 0, assessmentBasis: 'principalAndInterestAssessment', minDebtYield: 0.09, sponsorUpliftAllowed: true },
  custom: { maxLvr: 0.65, hardMaxLvr: 0.7, minIcr: 1.5, minDscr: 1.25, assessmentBufferPct: 1, assessmentFloorRatePct: 0, assessmentBasis: 'custom', minDebtYield: 0.09, sponsorUpliftAllowed: true },
};

export function applyLenderProfile(current: LendingAssumptions, profile: LenderPolicyProfileKey): LendingAssumptions {
  const defaults = lenderPolicyProfiles[profile];
  return { ...current, ...defaults, profile };
}

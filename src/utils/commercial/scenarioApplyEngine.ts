import type { CommercialScenarioProposal } from '@/components/commercial/calculators/CommercialBCScenarioAgent';
import { lenderPolicyProfiles } from './borrowing/lenderPolicyProfiles';

/** Map of allowed adjustment keys → state setter from CommercialBorrowingCapacityCard. */
export interface CommercialScenarioSetters {
  setPurchasePrice?: (v: string) => void;
  setEstimatedValue?: (v: string) => void;
  setProposedLoan?: (v: string) => void;
  setAvailableEquity?: (v: string) => void;
  setSponsorLiquidity?: (v: string) => void;
  setBusinessEbitda?: (v: string) => void;
  setBusinessDebt?: (v: string) => void;
  setCurrentRent?: (v: string) => void;
  setProposedRent?: (v: string) => void;
  setPassingRent?: (v: string) => void;
  setMarketRent?: (v: string) => void;
  setVacancy?: (v: string) => void;
  setRecoveries?: (v: string) => void;
  setRates?: (v: string) => void;
  setWater?: (v: string) => void;
  setLandTax?: (v: string) => void;
  setInsurance?: (v: string) => void;
  setManagement?: (v: string) => void;
  setRepairs?: (v: string) => void;
  setRate?: (v: string) => void;
  setBuffer?: (v: string) => void;
  setTerm?: (v: string) => void;
  setIoPeriod?: (v: string) => void;
  setAmortisation?: (v: string) => void;
  setMaxLvr?: (v: string) => void;
  setMinIcr?: (v: string) => void;
  setMinDscr?: (v: string) => void;
  setMinDebtYield?: (v: string) => void;
  applyProfile?: (key: string) => void;
  setGstTreatment?: (v: any) => void;
  setLeaseStatus?: (v: any) => void;
  setGuarantees?: (v: any) => void;
  setRelatedPartyTenant?: (v: any) => void;
  setScenarioType?: (v: any) => void;
}

const numericKeys: Array<[keyof CommercialScenarioSetters, string]> = [
  ['setPurchasePrice', 'purchasePrice'],
  ['setEstimatedValue', 'estimatedValue'],
  ['setProposedLoan', 'proposedLoan'],
  ['setAvailableEquity', 'availableEquity'],
  ['setSponsorLiquidity', 'sponsorLiquidity'],
  ['setBusinessEbitda', 'businessEbitda'],
  ['setBusinessDebt', 'businessDebt'],
  ['setCurrentRent', 'currentRent'],
  ['setProposedRent', 'proposedRent'],
  ['setPassingRent', 'passingRent'],
  ['setMarketRent', 'marketRent'],
  ['setVacancy', 'vacancy'],
  ['setRecoveries', 'recoveries'],
  ['setRates', 'rates'],
  ['setWater', 'water'],
  ['setLandTax', 'landTax'],
  ['setInsurance', 'insurance'],
  ['setManagement', 'management'],
  ['setRepairs', 'repairs'],
  ['setRate', 'rate'],
  ['setBuffer', 'buffer'],
  ['setTerm', 'term'],
  ['setIoPeriod', 'ioPeriod'],
  ['setAmortisation', 'amortisation'],
  ['setMaxLvr', 'maxLvr'],
  ['setMinIcr', 'minIcr'],
  ['setMinDscr', 'minDscr'],
  ['setMinDebtYield', 'minDebtYield'],
];

const enumKeys: Array<[keyof CommercialScenarioSetters, string, ReadonlySet<string>]> = [
  ['setGstTreatment', 'gstTreatment', new Set(['gstInclusive', 'plusGst', 'gstFreeGoingConcern', 'marginScheme', 'unknown'])],
  ['setLeaseStatus', 'leaseStatus', new Set(['fullyLeased', 'partiallyLeased', 'vacant', 'monthToMonth', 'relatedPartyLease', 'leasePending'])],
  ['setGuarantees', 'guarantees', new Set(['yes', 'no', 'unknown'])],
  ['setRelatedPartyTenant', 'relatedPartyTenant', new Set(['yes', 'no'])],
  ['setScenarioType', 'scenarioType', new Set([
    'Base Current Position', 'Acquire Commercial Asset', 'Acquire Industrial Asset',
    'Owner-Occupied Business Premises', 'Related-Party Lease Structure', 'Sell Existing Asset',
    'Refinance Existing Debt', 'Equity Release', 'Debt Restructure', 'Cash Injection',
    'Interest Rate Stress', 'Vacancy / Rent Stress', 'Capex Shock', 'Multi-Asset Strategy',
  ])],
];

/** Cascade an AI proposal into the calculator state. Returns the list of
 *  fields that were actually changed (for audit / undo). */
export function applyCommercialScenarioProposal(
  proposal: CommercialScenarioProposal,
  setters: CommercialScenarioSetters,
): string[] {
  const adj = proposal.adjustments || {};
  const changed: string[] = [];
  for (const [setterKey, adjKey] of numericKeys) {
    const raw = (adj as any)[adjKey];
    if (raw == null || raw === '') continue;
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) continue;
    const setter = setters[setterKey] as ((v: string) => void) | undefined;
    if (setter) { setter(String(num)); changed.push(adjKey); }
  }
  for (const [setterKey, adjKey, allowedValues] of enumKeys) {
    const raw = (adj as any)[adjKey];
    if (typeof raw !== 'string' || !allowedValues.has(raw)) continue;
    const setter = setters[setterKey] as ((v: any) => void) | undefined;
    if (setter) { setter(raw); changed.push(adjKey); }
  }
  const profile = (adj as any).profile;
  if (typeof profile === 'string' && Object.prototype.hasOwnProperty.call(lenderPolicyProfiles, profile) && setters.applyProfile) {
    setters.applyProfile(profile);
    changed.push('profile');
  }
  return changed;
}

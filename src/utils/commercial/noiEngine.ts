import type { AssumptionConfidenceTag } from './assumptionRegistry';
import { deriveCalculatedConfidence } from './assumptionRegistry';

export type DataSourceMode = 'global' | 'manualOverride' | 'aiEstimate';
export type LeaseType = 'gross' | 'net' | 'semiGross' | 'tripleNet' | 'unknown';
export type IncomeType = 'passingRent' | 'marketRent' | 'stabilisedRent' | 'relatedPartyRent' | 'vacantEstimatedMarketRent';
export type NoiBasis = 'actual' | 'stabilised' | 'lenderAdjusted';

export type NumericInput = number | string | null | undefined;
export interface OutgoingsRecoverabilityItem { name: string; amount: NumericInput; recoverablePct: NumericInput; verified?: boolean; }

export interface NoiEngineInputs {
  dataSourceMode?: DataSourceMode;
  leaseType: LeaseType;
  incomeType?: IncomeType;
  grossPassingRent: NumericInput;
  otherIncome?: NumericInput;
  marketRent?: NumericInput;
  vacancyAllowancePct?: NumericInput;
  recoveredOutgoings?: NumericInput;
  simpleTotalOperatingExpenses?: NumericInput;
  outgoings?: OutgoingsRecoverabilityItem[];
  normalisedRecoveredOutgoings?: NumericInput;
  normalisedVacancyPct?: NumericInput;
  normalisedExpenses?: NumericInput;
  incentiveAdjustment?: NumericInput;
  rentFreeAdjustment?: NumericInput;
  arrearsAdjustment?: NumericInput;
  overRentAdjustment?: NumericInput;
  waleAdjustment?: NumericInput;
  leaseRiskHaircut?: NumericInput;
  tenantRiskHaircut?: NumericInput;
  documentationRiskHaircut?: NumericInput;
  lenderAdjustedNoiHaircut?: NumericInput;
  fullyLeased?: boolean;
  leaseDocsVerified?: boolean;
  confidenceTags?: AssumptionConfidenceTag[];
}

export interface NoiBridgeItem { label: string; amount: number; }
export interface NoiEngineResult {
  potentialGrossIncome: number;
  vacancyLoss: number;
  effectiveGrossIncome: number;
  totalOperatingExpenses: number;
  ownerBorneExpenses: number;
  recoveredOutgoings: number;
  actualNoi: number;
  stabilisedNoi: number;
  lenderAdjustedNoi: number;
  selectedNoi: number;
  selectedBasis: NoiBasis;
  confidenceTag: AssumptionConfidenceTag;
  bridge: NoiBridgeItem[];
  warnings: string[];
}

const pct = (n = 0) => Math.max(0, n) / 100;
const sum = (arr: number[]) => arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
const parseNumeric = (value: NumericInput, { allowNegative = false }: { allowNegative?: boolean } = {}): number | null => {
  if (value === '' || value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s%]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return !allowNegative && parsed < 0 ? null : parsed;
};
const optional = (value: NumericInput, calculationReady: boolean, opts?: { allowNegative?: boolean }) => parseNumeric(value, opts) ?? (calculationReady ? 0 : null);
const required = (value: NumericInput, opts?: { allowNegative?: boolean }) => parseNumeric(value, opts);
/**
 * An input that OVERRIDES a computed default, and is absent when not supplied.
 *
 * `optional()` cannot express this. Its fallback is `calculationReady ? 0 :
 * null`, so on a ready calculation it returns **0 for an unsupplied input** —
 * which makes any `optional(x, ready) ?? computedDefault` idiom dead code, and
 * the stabilised NOI used that idiom three times. See `stabilisedNoi` below.
 */
const override = (value: NumericInput, opts?: { allowNegative?: boolean }) => parseNumeric(value, opts);

export function calculateNoiEngine(inputs: NoiEngineInputs, selectedBasis: NoiBasis = 'lenderAdjusted'): NoiEngineResult {
  const warnings: string[] = [];
  const grossPassingRent = required(inputs.grossPassingRent);
  const vacancyAllowancePct = required(inputs.vacancyAllowancePct);
  const calculationReady = grossPassingRent !== null && vacancyAllowancePct !== null;
  const otherIncome = optional(inputs.otherIncome, calculationReady) ?? 0;
  const potentialGrossIncome = calculationReady ? grossPassingRent + otherIncome : 0;
  const vacancyLoss = potentialGrossIncome * pct(vacancyAllowancePct ?? 0);
  const outgoings = inputs.outgoings ?? [];
  const simpleTotalOperatingExpenses = parseNumeric(inputs.simpleTotalOperatingExpenses);
  const itemisedOperatingExpenses = calculationReady ? sum(outgoings.map(o => optional(o.amount, true) ?? 0)) : 0;
  const totalOperatingExpenses = simpleTotalOperatingExpenses ?? itemisedOperatingExpenses;
  const matrixRecovered = calculationReady ? sum(outgoings.map(o => (optional(o.amount, true) ?? 0) * Math.min(1, Math.max(0, (optional(o.recoverablePct, true) ?? 0) / 100)))) : 0;
  const recoveredOutgoings = optional(inputs.recoveredOutgoings, calculationReady) ?? matrixRecovered;
  const ownerBorneExpenses = totalOperatingExpenses - recoveredOutgoings;
  /*
   * A pending calculation reports nothing, not the part that happened to parse.
   *
   * `potentialGrossIncome` is gated on `calculationReady`; `recoveredOutgoings`
   * was not, and `optional()` returns a parsed value whatever the flag says —
   * the flag only chooses the FALLBACK. So a form with no gross rent and no
   * vacancy allowance, but $2,000 of recovered outgoings typed in, produced an
   * NOI of $2,000 while warning that the calculation was pending. A figure
   * beside a "pending" warning is worse than no figure: it is the one the
   * reader takes away.
   */
  const effectiveGrossIncome = calculationReady
    ? potentialGrossIncome - vacancyLoss + recoveredOutgoings
    : 0;
  const actualNoi = effectiveGrossIncome - totalOperatingExpenses;
  const marketRent = optional(inputs.marketRent, calculationReady) ?? grossPassingRent ?? 0;
  /*
   * The stabilised basis ignored vacancy, recoveries and expenses.
   *
   * All three read `optional(inputs.normalisedX, calculationReady) ?? default`,
   * and `optional` answers **0** rather than null for an unsupplied input on a
   * ready calculation — so every `??` here was unreachable and each term
   * collapsed to zero. On the fixture below that is
   *
   *     (110,000 + 5,000) x (1 - 0) + 0 - 0 = 115,000
   *
   * where the formula this line is written to express gives
   *
   *     (110,000 + 5,000) x (1 - 0.05) + 20,000 - 10,000 = 119,250
   *
   * Stabilised NOI is what the cap-rate valuation and the max-loan figures are
   * taken from, so the effect was a valuation computed on gross market rent
   * with no vacancy allowance and no operating expenses — overstated, and
   * silently, because every input still appeared on the screen that produced
   * it. The normalised inputs are OVERRIDES; absent means "use the actual",
   * which is what `override()` lets the `??` say.
   */
  const normalisedVacancyPct = override(inputs.normalisedVacancyPct) ?? vacancyAllowancePct ?? 0;
  const normalisedVacancy = (marketRent + otherIncome) * pct(normalisedVacancyPct);
  const stabilisedNoi = ((marketRent + otherIncome) * (1 - pct(normalisedVacancyPct)))
    + (override(inputs.normalisedRecoveredOutgoings) ?? recoveredOutgoings)
    - (override(inputs.normalisedExpenses) ?? totalOperatingExpenses);
  const lenderAdjustments = sum([
    inputs.incentiveAdjustment,
    inputs.rentFreeAdjustment,
    inputs.arrearsAdjustment,
    inputs.overRentAdjustment,
    inputs.waleAdjustment,
    inputs.leaseRiskHaircut,
    inputs.tenantRiskHaircut,
    inputs.documentationRiskHaircut,
    inputs.lenderAdjustedNoiHaircut,
  ].map(n => Math.max(0, optional(n, calculationReady, { allowNegative: true }) ?? 0)));
  const lenderAdjustedNoi = actualNoi - lenderAdjustments;
  if (!calculationReady) warnings.push('NOI calculation pending required gross rent and vacancy allowance inputs.');
  if (inputs.fullyLeased && (grossPassingRent ?? 0) <= 0) warnings.push('Fully leased assets require rent greater than zero.');
  if (inputs.leaseType === 'unknown') warnings.push('Lease type is unknown; NOI cannot be treated as verified.');
  if (recoveredOutgoings > totalOperatingExpenses && totalOperatingExpenses > 0) warnings.push('Recovered outgoings exceed total outgoings; verify recoverability matrix.');
  if (lenderAdjustedNoi > actualNoi) warnings.push('Lender-adjusted NOI exceeds actual NOI; explanation required.');
  if (inputs.leaseDocsVerified === false) warnings.push('Lease documentation is not verified.');
  const confidenceTag = inputs.leaseType === 'unknown' || inputs.leaseDocsVerified === false
    ? 'Specialist Review Required'
    : deriveCalculatedConfidence(inputs.confidenceTags ?? ['Manual Estimate']);
  const selectedNoi = selectedBasis === 'actual' ? actualNoi : selectedBasis === 'stabilised' ? stabilisedNoi : lenderAdjustedNoi;
  return {
    potentialGrossIncome,
    vacancyLoss,
    effectiveGrossIncome,
    totalOperatingExpenses,
    ownerBorneExpenses,
    recoveredOutgoings,
    actualNoi,
    stabilisedNoi,
    lenderAdjustedNoi,
    selectedNoi,
    selectedBasis,
    confidenceTag,
    warnings,
    bridge: [
      { label: 'Potential Gross Income', amount: potentialGrossIncome },
      { label: 'Vacancy Loss', amount: -vacancyLoss },
      { label: 'Recovered Outgoings', amount: recoveredOutgoings },
      { label: 'Total Operating Expenses', amount: -totalOperatingExpenses },
      { label: 'Actual NOI', amount: actualNoi },
      { label: 'Lender Adjustments', amount: -lenderAdjustments },
      { label: 'Lender-Adjusted NOI', amount: lenderAdjustedNoi },
    ],
  };
}

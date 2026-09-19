/**
 * Resolution of the "Original Value (API)" figure shown for each field in the
 * Manual Data Override modal.
 *
 * Background: an investment report stores its computed figures NESTED inside
 * `financial_calculations` (e.g. `initialCosts.propertyValue`, `keyMetrics.lvr`,
 * `loanDetails.interestRate`), while the raw/original source figures for fields
 * that the calculator does not compute (land price, build price, car spaces,
 * weekly rent, market value, loan type/term) are seeded into the flat
 * `manual_overrides` column at generation time. The modal historically read the
 * Original Value from FLAT `financial_calculations.<field>` paths that are never
 * populated, so it displayed "Not available" even when the figure existed.
 *
 * This module resolves the Original Value from the same set data sources the app
 * actually persists to, so an unchanged field reflects the same figure shown in
 * the Manual Override column instead of "Not available".
 */

/**
 * Canonical nested path inside `financial_calculations` for each override field.
 * This is the single source of truth also consumed by the save handler, so the
 * value the user reads back is pulled from the exact location overrides persist to.
 */
export const OVERRIDE_FIELD_PATHS: Record<string, string> = {
  purchasePrice: 'initialCosts.propertyValue',
  propertyType: 'propertySpecs.propertyType',
  carSpaces: 'propertySpecs.carSpaces',
  stampDuty: 'initialCosts.stampDuty',
  isFirstHomeBuyer: 'purchaseDetails.isFirstHomeBuyer',
  depositValue: 'initialCosts.deposit',
  loanToValueRatio: 'keyMetrics.lvr',
  interestRate: 'loanDetails.interestRate',
  weeklyRent: 'income.weeklyRent',
  councilRates: 'annualCosts.councilRates',
  waterRates: 'annualCosts.waterRates',
  bodyCorporateFees: 'annualCosts.strataFees',
  strataAdminFund: 'annualCosts.strataAdminFund',
  strataSinkingFund: 'annualCosts.strataSinkingFund',
  strataSpecialLevies: 'annualCosts.strataSpecialLevies',
  landTax: 'annualCosts.landTax',
  buildingLandlordInsurance: 'annualCosts.landlordInsurance',
  propertyManagementFees: 'annualCosts.propertyManagementPercent',
  solicitorFees: 'initialCosts.legalFees',
  repairsMaintenance: 'annualCosts.maintenance',
  lettingFees: 'annualCosts.lettingFees',
  capitalGrowth: 'assumptions.capitalGrowth',
  buildPrice: 'initialCosts.buildPrice',
  landPrice: 'initialCosts.landPrice',
  landSizeSqm: 'propertySpecs.landSizeSqm',
  buildSizeSqm: 'propertySpecs.buildSizeSqm',
  // Cash flow and loan fields
  marketValueNow: 'cashFlow.marketValueNow',
  loanAmount: 'cashFlow.loanAmount',
  loanType: 'cashFlow.loanType',
  loanTermYears: 'cashFlow.loanTermYears',
  interestOnlyPeriodYears: 'cashFlow.interestOnlyPeriodYears',
  repaymentFrequency: 'cashFlow.repaymentFrequency',
  extraRepaymentPerMonth: 'cashFlow.extraRepaymentPerMonth',
  offsetBalance: 'cashFlow.offsetBalance',
  occupancyRate: 'cashFlow.occupancyRate',
  cpiGrowthRate: 'cashFlow.cpiGrowthRate',
  depreciation: 'cashFlow.depreciation',
  taxRate: 'cashFlow.taxRate',
  constructionYear: 'cashFlow.constructionYear',
  // Construction stage fields
  constructionDurationMonths: 'construction.durationMonths',
  agentFee: 'initialCosts.agentFee',
  stageDepositPercent: 'construction.stageDepositPercent',
  stageSlabPercent: 'construction.stageSlabPercent',
  stageFramePercent: 'construction.stageFramePercent',
  stageLockupPercent: 'construction.stageLockupPercent',
  stageFixingPercent: 'construction.stageFixingPercent',
  stageCompletionPercent: 'construction.stageCompletionPercent',
};

/**
 * Additional nested locations where a field's ORIGINAL generated figure can live
 * when that differs from where an override is persisted. Probed BEFORE the save
 * path so the true source figure wins over a previously-overridden value.
 * (e.g. the calculator writes the base loan amount to `initialCosts.loanAmount`,
 * whereas an override is saved to `cashFlow.loanAmount`.)
 */
export const ORIGINAL_VALUE_EXTRA_PATHS: Record<string, string[]> = {
  loanAmount: ['initialCosts.loanAmount', 'loanDetails.loanAmount'],
  loanToValueRatio: ['loanDetails.lvr'],
  loanType: ['loanDetails.loanType'],
  loanTermYears: ['loanDetails.loanTermYears'],
};

/** Safely read a dot-delimited nested path (e.g. `initialCosts.propertyValue`). */
export function getNestedValue(source: unknown, path?: string): unknown {
  if (source == null || !path) return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Resolve the Original Value to display for a field, in priority order:
 *   1. Canonical/known nested location(s) inside `financial_calculations`.
 *   2. The field's own definition fallback (legacy flat path or a sensible default).
 *   3. The figure held in `manual_overrides` — the original source value for
 *      fields the calculator never computes, which also makes an unchanged field
 *      reflect the same figure shown in the Manual Override column.
 * Returns `null` only when no source holds a value (genuine "Not available").
 */
export type OriginalFieldValue = number | string | null;

/** Coerce an arbitrary present source value into the shape `formatValue` accepts. */
function toDisplayValue(value: unknown): OriginalFieldValue {
  if (typeof value === 'number' || typeof value === 'string') return value;
  // Booleans (e.g. first-home-buyer) and other primitives display as their string form.
  return String(value);
}

export function resolveOriginalFieldValue(
  financialCalculations: unknown,
  manualOverrides: Record<string, unknown> | null | undefined,
  fieldKey: string,
  fallbackOriginal?: unknown,
): OriginalFieldValue {
  const probePaths = [
    ...(ORIGINAL_VALUE_EXTRA_PATHS[fieldKey] ?? []),
    OVERRIDE_FIELD_PATHS[fieldKey],
  ].filter((p): p is string => Boolean(p));

  for (const path of probePaths) {
    const nested = getNestedValue(financialCalculations, path);
    if (isPresent(nested)) return toDisplayValue(nested);
  }

  if (isPresent(fallbackOriginal)) return toDisplayValue(fallbackOriginal);

  const overrideValue = manualOverrides?.[fieldKey];
  if (isPresent(overrideValue)) return toDisplayValue(overrideValue);

  return null;
}

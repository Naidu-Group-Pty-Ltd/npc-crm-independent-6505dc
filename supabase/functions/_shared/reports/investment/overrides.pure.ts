/**
 * Manual overrides → the financial engine, one mapping for every writer.
 *
 * A report's manual overrides used to reach `financial_calculations` three
 * different ways, and every one of them wrote an incoherent row:
 *
 *  * `generate-investment-report` called the calculator with override-merged
 *    INPUTS, then splatted override values over the response's leaves — so an
 *    overridden council rate landed in `annualCosts.councilRates` while the
 *    totals, projections, metrics and sensitivity all still described the
 *    formula-derived costs (the captured production row: overridden line
 *    items summing $13,578 beside a stored `totalAnnual` of $21,418).
 *
 *  * `ManualDataOverrideModal` splatted client-side and re-footed only
 *    `totalAnnual` from six of the eight cost lines — no land tax, no
 *    letting fees, no `totalAnnualExcludingLandTax`, and never the
 *    projections, key metrics or upfront total.
 *
 *  * `manage-investment-reports` persisted whatever the client sent.
 *
 * The rule now: **an override that changes an input the engine models goes
 * INTO the engine**, so everything downstream — totals, series, sensitivity,
 * headline metrics — is recomputed from it; only fields the engine does not
 * model (tax treatment, occupancy display, loan flavour labels, build
 * splits) are merged onto the result afterwards, and that merge is the one
 * implemented here.
 */

import {
  operatingExpensesFrom,
  type AnnualCostOverrides,
  type LoanCalculationInput,
} from './financialEngine.pure.ts';

/** Loose numeric coercion for override payloads ("$1,190,000" → 1190000). */
export const toFiniteNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};
const num = toFiniteNumber;

const isRecord = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The flat override keys whose values the engine models as INPUT. */
export const MODELLED_OVERRIDE_KEYS = [
  'purchasePrice', 'depositValue', 'interestRate', 'weeklyRent',
  'stampDuty', 'solicitorFees', 'isFirstHomeBuyer', 'buildType',
  'capitalGrowth', 'cpiGrowthRate',
  'councilRates', 'waterRates', 'bodyCorporateFees',
  'buildingLandlordInsurance', 'propertyManagementFees',
  'repairsMaintenance', 'lettingFees', 'landTax', 'propertyType',
] as const;

/**
 * Flat override key → path in the stored object, for the fields the engine
 * does NOT model. These are the only leaves a writer may splat after the
 * engine has run; splatting a modelled field here is how a row stops
 * footing against itself.
 */
export const DISPLAY_OVERRIDE_PATHS: Record<string, string> = {
  loanToValueRatio: 'keyMetrics.lvr',
  buildPrice: 'initialCosts.buildPrice',
  landPrice: 'initialCosts.landPrice',
  landSizeSqm: 'propertySpecs.landSizeSqm',
  buildSizeSqm: 'propertySpecs.buildSizeSqm',
  depreciation: 'taxBenefits.depreciation',
  taxRate: 'taxBenefits.marginalTaxRate',
  occupancyRate: 'assumptions.occupancyWeeks',
  capitalGrowth: 'assumptions.capitalGrowth',
  cpiGrowthRate: 'assumptions.cpiGrowth',
  loanType: 'loanDetails.loanType',
  loanAmount: 'loanDetails.loanAmount',
  interestOnlyPeriodYears: 'loanDetails.interestOnlyPeriod',
};

/** The Australian jurisdiction named in a property address, if any. */
export function stateFromAddress(address: unknown): string | undefined {
  if (typeof address !== 'string') return undefined;
  const matches = address.toUpperCase().match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/g);
  return matches ? matches[matches.length - 1] : undefined;
}

const PROPERTY_TYPES = new Set(['house', 'unit', 'townhouse']);

/**
 * The engine's property-type vocabulary, from whatever the record spells.
 *
 * Exported because there were TWO vocabularies in one flow: this normaliser
 * served the overrides path (`apartment` -> `unit`, `villa`/`duplex` ->
 * `townhouse`) while `generate-investment-report` sent the RAW string to the
 * calculator with a silent `|| 'house'` fallback. The calculator's only use of
 * the type is `strataFees = o.strataFees ?? (propertyType === 'unit' ? 4800 : 0)`,
 * so `apartment` never matched and never drew the strata estimate — measured
 * 2026-09-07, 264 of 1,071 reports carried a type outside the vocabulary.
 *
 * Returning `undefined` for an unrecognised type is the point: an unresolved
 * type is not a house, and asserting one is the silent assumption this
 * programme exists to remove.
 */
export function normalisePropertyType(v: unknown): 'house' | 'unit' | 'townhouse' | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (PROPERTY_TYPES.has(t)) return t as 'house' | 'unit' | 'townhouse';
  if (t === 'apartment' || t === 'flat') return 'unit';
  if (t === 'villa' || t === 'duplex') return 'townhouse';
  return undefined;
}

/** Cost overrides in the engine's vocabulary, or undefined when none apply. */
export function buildAnnualCostOverrides(overrides: Record<string, any>): AnnualCostOverrides | undefined {
  const out: AnnualCostOverrides = {};
  const map: Array<[string, keyof AnnualCostOverrides]> = [
    ['councilRates', 'councilRates'],
    ['waterRates', 'waterRates'],
    ['bodyCorporateFees', 'strataFees'],
    ['buildingLandlordInsurance', 'landlordInsurance'],
    ['propertyManagementFees', 'propertyManagementPercent'],
    ['repairsMaintenance', 'maintenance'],
    ['lettingFees', 'lettingFees'],
    ['landTax', 'landTax'],
  ];
  for (const [flat, engineKey] of map) {
    const v = num(overrides?.[flat]);
    if (v !== undefined) out[engineKey] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface StoredReportContext {
  property_address?: unknown;
  property_specs?: unknown;
  financial_calculations?: unknown;
}

export interface CalculatorInputBuild {
  ok: boolean;
  /** Complete when ok; absent otherwise. */
  input?: LoanCalculationInput;
  /** What could not be established, for the caller's log line. */
  missing: string[];
}

/**
 * A complete calculator input from a stored report row plus its overrides —
 * override first, then the row's own recorded values, then a stated default.
 * Refuses (ok:false) rather than guessing when the load-bearing inputs
 * cannot be established; a recompute on invented numbers is worse than
 * leaving the stored row alone.
 */
export function buildCalculatorInput(
  overrides: Record<string, any>,
  row: StoredReportContext,
): CalculatorInputBuild {
  const ov = isRecord(overrides) ? overrides : {};
  const fin = isRecord(row.financial_calculations) ? row.financial_calculations : {};
  const specs = isRecord(row.property_specs) ? row.property_specs : {};
  const initial = isRecord(fin.initialCosts) ? fin.initialCosts : {};
  const loan = isRecord(fin.loanDetails) ? fin.loanDetails : {};
  const income = isRecord(fin.income) ? fin.income : {};
  const assumptions = isRecord(fin.assumptions) ? fin.assumptions : {};
  const finSpecs = isRecord(fin.propertySpecs) ? fin.propertySpecs : {};

  const missing: string[] = [];

  const landPlusBuild = (num(ov.landPrice) ?? 0) + (num(ov.buildPrice) ?? 0);
  const propertyValue = num(ov.purchasePrice)
    ?? num(initial.propertyValue)
    ?? num(specs.purchase_price)
    ?? (landPlusBuild > 0 ? landPlusBuild : undefined);
  if (propertyValue === undefined || propertyValue <= 0) missing.push('propertyValue');

  const lvrPct = num(ov.loanToValueRatio);
  const deposit = num(ov.depositValue)
    ?? (propertyValue !== undefined && lvrPct !== undefined && lvrPct > 0 && lvrPct <= 100
      ? Math.round(propertyValue * (1 - lvrPct / 100))
      : undefined)
    ?? num(initial.deposit)
    ?? (propertyValue !== undefined ? Math.round(propertyValue * 0.2) : undefined);
  if (deposit === undefined || deposit < 0) missing.push('deposit');

  const weeklyRent = num(ov.weeklyRent) ?? num(income.weeklyRent);
  if (weeklyRent === undefined || weeklyRent <= 0) missing.push('weeklyRent');

  const state = stateFromAddress(row.property_address)
    ?? (typeof specs.state === 'string' ? String(specs.state).toUpperCase() : undefined);
  if (!state) missing.push('state');

  if (missing.length) return { ok: false, missing };

  const propertyType = normalisePropertyType(ov.propertyType)
    ?? normalisePropertyType(specs.property_type)
    ?? normalisePropertyType(finSpecs.propertyType)
    ?? 'house';

  const input: LoanCalculationInput = {
    propertyValue: propertyValue!,
    deposit: deposit!,
    loanTerm: num(loan.loanTerm) ?? 30,
    weeklyRent: weeklyRent!,
    state: state!,
    propertyType,
  };

  const interestRate = num(ov.interestRate) ?? num(loan.interestRate);
  if (interestRate !== undefined && interestRate > 0) input.interestRate = interestRate;

  const capitalGrowth = num(ov.capitalGrowth) ?? num(assumptions.capitalGrowth);
  if (capitalGrowth !== undefined && capitalGrowth > 0) input.capitalGrowthRate = capitalGrowth;

  const cpiGrowth = num(ov.cpiGrowthRate) ?? num(assumptions.cpiGrowth);
  if (cpiGrowth !== undefined && cpiGrowth > 0) input.cpiGrowthRate = cpiGrowth;

  if (ov.isFirstHomeBuyer === true) input.isFirstHomeBuyer = true;
  if (typeof ov.buildType === 'string' && ov.buildType !== '' && ov.buildType !== 'existing_property') {
    input.isNewBuild = true;
  }

  const costOverrides = buildAnnualCostOverrides(ov);
  if (costOverrides) input.annualCostOverrides = costOverrides;

  const stampDuty = num(ov.stampDuty);
  if (stampDuty !== undefined) input.stampDutyOverride = stampDuty;

  const legalFees = num(ov.solicitorFees);
  if (legalFees !== undefined) input.legalFeesOverride = legalFees;

  return { ok: true, input, missing };
}

/**
 * Merge the non-modelled override fields onto a freshly computed
 * financial_calculations object. Returns a new object; never touches
 * modelled leaves — those are already right, computed from the same
 * overrides as engine input.
 */
export function applyDisplayOverrides(
  fin: Record<string, any>,
  overrides: Record<string, any>,
): Record<string, any> {
  const ov = isRecord(overrides) ? overrides : {};
  return splatByPaths(fin, ov, DISPLAY_OVERRIDE_PATHS);
}

/**
 * Historic-row overlay: the full flat-key → stored-path vocabulary, modelled
 * fields included, exactly as the browser generator has always splatted it.
 *
 * A row written before the recompute-on-update era stores financials that
 * ignore its own `manual_overrides`, so a reader that wants the overridden
 * figures has no choice but to overlay them — knowing the derived fields
 * (a stamp duty computed from the old price, a total footed without the
 * override) stay stale. That is a display compromise for old rows only;
 * current rows are override-coherent at rest and the overlay is a no-op on
 * them. This lived as a fourth hand-written copy in `ClientPDFGenerator`;
 * one copy, named for what it is, is the fix.
 */
const HISTORIC_ROW_OVERLAY_PATHS: Record<string, string> = {
  purchasePrice: 'initialCosts.propertyValue',
  stampDuty: 'initialCosts.stampDuty',
  depositValue: 'initialCosts.deposit',
  interestRate: 'loanDetails.interestRate',
  weeklyRent: 'income.weeklyRent',
  councilRates: 'annualCosts.councilRates',
  waterRates: 'annualCosts.waterRates',
  bodyCorporateFees: 'annualCosts.strataFees',
  buildingLandlordInsurance: 'annualCosts.landlordInsurance',
  propertyManagementFees: 'annualCosts.propertyManagementPercent',
  solicitorFees: 'initialCosts.legalFees',
  repairsMaintenance: 'annualCosts.maintenance',
  lettingFees: 'annualCosts.lettingFees',
  landTax: 'annualCosts.landTax',
  marketValueNow: 'cashFlow.marketValueNow',
  cpiGrowthRate: 'cashFlow.cpiGrowthRate',
};

function splatByPaths(
  fin: Record<string, any>,
  overrides: Record<string, any>,
  paths: Record<string, string>,
): Record<string, any> {
  const out: Record<string, any> = { ...fin };
  for (const [flatKey, path] of Object.entries(paths)) {
    const value = overrides[flatKey];
    if (value === undefined || value === null || value === '') continue;
    const keys = path.split('.');
    let current: Record<string, any> = out;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      current[k] = isRecord(current[k]) ? { ...current[k] } : {};
      current = current[k];
    }
    current[keys[keys.length - 1]] = value;
  }
  return out;
}

/**
 * What a display surface should hand a legacy renderer for a row that may
 * predate the recompute-on-update era: the modelled overlay above, then the
 * ordinary display paths. Never used on a write path — a writer recomputes.
 */
export function overlayOverridesForHistoricRow(
  fin: Record<string, any>,
  overrides: unknown,
): Record<string, any> {
  const ov = isRecord(overrides) ? overrides : {};
  if (!Object.keys(ov).length) return fin;
  return splatByPaths(splatByPaths(fin, ov, HISTORIC_ROW_OVERLAY_PATHS), ov, DISPLAY_OVERRIDE_PATHS);
}

/**
 * Whether an override payload contains anything the engine models — the
 * gate for a recompute. A payload of purely display fields (a tax rate, a
 * loan label) changes no computed figure and needs no engine run.
 */
export function overridesAffectModel(overrides: unknown): boolean {
  if (!isRecord(overrides)) return false;
  return MODELLED_OVERRIDE_KEYS.some((k) => {
    const v = overrides[k];
    return v !== undefined && v !== null && v !== '';
  });
}

export { operatingExpensesFrom };

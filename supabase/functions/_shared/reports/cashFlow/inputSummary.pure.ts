/**
 * The Input Summary — every figure the projection was run on, as the legacy
 * export printed it, in the order it printed it.
 *
 * The typeset document printed nine of the thirty: the purchase and the loan,
 * but not the council and water rates, the management fee, insurance, letting
 * fees, maintenance, strata, the land/build split, the CPI and tax rates, the
 * loan structure or the rent basis. Every one of those moves a figure in the
 * ten-year table, so a reader could not check the table against what it rests
 * on. This module is the one statement of that summary; the browser sends the
 * inputs as numbers and the server lays them out with it.
 *
 * Three rules carried over from the legacy export, each paid for once:
 *
 *  - **A figure nobody recorded says so** (QA-02): `(assumed)` follows any
 *    input the record defaulted.
 *  - **A land or build price the record does not hold is "Not stated"**, never
 *    the purchase price (QA-13); a build price derived from price less land
 *    says it was derived.
 *  - **The yield is on the purchase price**, rent × occupied weeks ÷ price,
 *    because this sits beside the purchase price and the table's grown-value
 *    yield answers a different question.
 *
 * Pure: every number is formatted here, without `toLocaleString`, so Deno and
 * the browser print identical text.
 */
import type { SchedulePreset } from './constructionSchedule.pure.ts';

/** The structured inputs the browser sends. Bare numbers; rates percent-scaled. */
export interface CashFlowInputs {
  /** The report is recorded as a new build (`manual_overrides.buildType`). */
  isNewBuild: boolean;
  /**
   * The new build is a build PLANNED on a land-only purchase
   * (`plannedBuild.pure.ts`). Optional: a caller that predates it sends none.
   */
  plannedBuild?: boolean;
  purchasePrice: number;
  weeklyRent: number;
  landPrice: number | null;
  buildPrice: number | null;
  /** The build price is the purchase price less the land, not a stated contract. */
  buildDerived: boolean;
  deposit: number;
  loanAmount: number;
  interestRate: number;
  capitalGrowth: number;
  cpiGrowth: number;
  taxRate: number;
  depreciation: number;
  councilRates: number;
  waterRates: number;
  managementFeePercent: number;
  landlordInsurance: number;
  lettingFees: number;
  repairsMaintenance: number;
  bodyCorporate: number;
  stampDuty: number;
  solicitorFees: number;
  inspectionFees: number;
  agentFee: number;
  lmiAmount: number;
  occupancyWeeks: number;
  /** `interest_only` / `principal_interest`. */
  loanType: string;
  interestOnlyYears: number;
  loanTermYears: number;
  /** Field names the record defaulted (`BaseFinancials.assumedInputs`). */
  assumed: readonly string[];
  /** Eight hex digits naming the case these inputs describe. */
  caseFingerprint: string | null;
  /** How the build contract is staged. Absent on an established property. */
  construction: {
    durationMonths: number;
    preset: SchedulePreset;
    /** Six percentages, in `CONSTRUCTION_STAGES` order. */
    stagePercents: number[];
    /** Six months, in `CONSTRUCTION_STAGES` order. */
    stageMonths: number[];
  } | null;
}

export interface InputSummaryCell {
  label: string;
  value: string;
}

/** One printed line: a pair on the left and, usually, a pair on the right. */
export interface InputSummaryLine {
  left: InputSummaryCell | null;
  right: InputSummaryCell | null;
}

// ── Formatting, deterministic ───────────────────────────────────────────────

function group(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `$1,110,000`, `-$4,200`. Whole dollars, as the legacy export printed them. */
export function formatDollars(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return `${n < 0 ? '-' : ''}$${group(String(Math.abs(n)))}`;
}

/** `$1,234.56` — for the construction schedule's monthly interest. */
export function formatCents(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  const [whole, frac = ''] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}$${group(whole)}.${frac}`;
}

/** A percentage the way it was entered: `7.5%`, `30%`, never `7.50%` unless asked. */
function percent(value: number, fixed?: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${fixed === undefined ? String(Math.round(n * 1000) / 1000) : n.toFixed(fixed)}%`;
}

/** A holding cost: its dollars, or `Nil` where the record states none. */
function cost(value: number): string {
  return Number.isFinite(value) && value !== 0 ? formatDollars(value) : 'Nil';
}

// ── The summary ─────────────────────────────────────────────────────────────

export function inputSummaryLines(i: CashFlowInputs): InputSummaryLine[] {
  const assumed = new Set(i.assumed);
  const mark = (field: string, text: string) => (assumed.has(field) ? `${text} (assumed)` : text);
  const cell = (label: string, value: string): InputSummaryCell => ({ label, value });

  const annualRent = i.weeklyRent * i.occupancyWeeks;
  const purchaseYield = i.purchasePrice > 0 ? percent((annualRent / i.purchasePrice) * 100, 2) : 'Not stated';
  const land = i.landPrice === null ? 'Not stated' : formatDollars(i.landPrice);
  const build = i.buildPrice === null
    ? 'Not stated'
    : `${formatDollars(i.buildPrice)}${i.plannedBuild ? ' (planned)' : i.buildDerived ? ' (price less land)' : ''}`;
  const ioYears = i.loanType === 'interest_only' ? i.interestOnlyYears : 0;
  const structure = ioYears > 0
    ? `Interest only ${ioYears} yr${ioYears === 1 ? '' : 's'}${assumed.has('interestOnlyPeriodYears') ? ' (assumed)' : ''}, `
      + `then P&I (${i.loanTermYears} yr term)`
    : `Principal & interest (${i.loanTermYears} yr term)`;

  const lines: InputSummaryLine[] = [
    // A planned build's "purchase" is the lot plus the contract to build on it.
    { left: cell(i.plannedBuild ? 'Total project (land + build)' : 'Purchase price', formatDollars(i.purchasePrice)), right: cell('Weekly rent', formatDollars(i.weeklyRent)) },
    { left: cell('Land price', land), right: cell('Gross rental yield (on purchase)', purchaseYield) },
    { left: cell('Build price', build), right: cell('Council rates (p.a.)', cost(i.councilRates)) },
    { left: cell('Deposit amount', formatDollars(i.deposit)), right: cell('Water rates (p.a.)', cost(i.waterRates)) },
    {
      left: cell('Loan amount', formatDollars(i.loanAmount)),
      right: cell('Property management', mark('propertyManagementFees', percent(i.managementFeePercent))),
    },
    {
      left: cell('Interest rate', mark('interestRate', percent(i.interestRate, 2))),
      right: cell('Landlord insurance', cost(i.landlordInsurance)),
    },
    {
      left: cell('Capital growth rate', mark('capitalGrowth', percent(i.capitalGrowth))),
      right: cell('Letting fees', cost(i.lettingFees)),
    },
    {
      left: cell('CPI growth rate', mark('cpiGrowthRate', percent(i.cpiGrowth))),
      right: cell('Repairs & maintenance', cost(i.repairsMaintenance)),
    },
    {
      left: cell('Tax rate (MTR)', mark('taxRate', percent(i.taxRate))),
      right: cell('Body corporate', cost(i.bodyCorporate)),
    },
    {
      left: cell('Depreciation (Yr 1)', mark('depreciation', i.depreciation > 0 ? formatDollars(i.depreciation) : 'Excluded')),
      right: cell('Stamp duty', formatDollars(i.stampDuty)),
    },
    {
      left: cell('Loan structure', structure),
      right: cell('Rent basis', mark('occupancyRate', `${i.occupancyWeeks} weeks p.a.`)),
    },
  ];

  // The tail of the right-hand column, as the legacy export lays it out.
  const tail: InputSummaryCell[] = [cell('Conveyancing', formatDollars(i.solicitorFees))];
  if (i.inspectionFees > 0) tail.push(cell('Inspections', formatDollars(i.inspectionFees)));
  if (i.agentFee > 0) tail.push(cell('Agent fee', formatDollars(i.agentFee)));
  if (i.lmiAmount > 0) tail.push(cell('LMI', formatDollars(i.lmiAmount)));
  if (i.construction) {
    tail.push(cell('Construction period', `${i.construction.durationMonths} months`));
  }

  const fingerprint = i.caseFingerprint ? cell('Case inputs', `fingerprint ${i.caseFingerprint}`) : null;
  tail.forEach((right, idx) => {
    lines.push({ left: idx === 0 ? fingerprint : null, right });
  });
  if (!tail.length && fingerprint) lines.push({ left: fingerprint, right: null });
  return lines;
}

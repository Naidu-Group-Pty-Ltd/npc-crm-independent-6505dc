/**
 * Turning what the browser sent into a document payload — or refusing to.
 *
 * The wire shape is plain numbers. Units are attached here and nowhere else,
 * which is the point of the boundary: the modal knows the arithmetic, this
 * module knows what a number *is*. A figure that arrives without a unit cannot
 * be printed as one by accident.
 *
 * Everything that can be derived is derived here rather than accepted: equity,
 * LVR, the weekly figures, the year-one block, the ten-year outcome and the
 * narrative. That is a smaller surface for the caller to get wrong, and it means
 * the sentence under the headline cannot disagree with the table above it —
 * which is exactly the defect the Borrowing Capacity waterfall had.
 *
 * `NaN` and `Infinity` are rejected rather than rendered. A projection table
 * with a hole in it, printed on company letterhead and emailed to a client, is
 * worse than an error the adviser sees before it is sent.
 */
import type { Measure } from '../../reportDesign/measure.pure.ts';
import {
  aud,
  audPerWeek,
  audPerYear,
  percent,
  years as yearsUnit,
} from '../../reportDesign/measure.pure.ts';
import type {
  AcquisitionBlock,
  AssumptionRow,
  CashFlowProjection,
  LabelledAmount,
  OutcomeBlock,
  ProjectionYear,
  YearOneBlock,
} from './payload.pure.ts';

/** Weeks in a year, as the modal's own projection uses. */
const WEEKS_PER_YEAR = 52;

/** A projection longer than this is a mistake, not a request. */
export const MAX_PROJECTION_YEARS = 40;
/** Fewer than this and there is no projection to draw. */
export const MIN_PROJECTION_YEARS = 1;
/** Enough for a full itemised purchase; past it, someone is pasting. */
export const MAX_ACQUISITION_COSTS = 24;
export const MAX_ASSUMPTIONS = 40;
export const MAX_NOTES = 12;

/** A field arrived wrong, and the message says which. */
export class CashFlowPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashFlowPayloadError';
  }
}

// ── Reading primitives ──────────────────────────────────────────────────────

function num(source: Record<string, unknown>, key: string, where: string): number {
  const raw = source[key];
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    throw new CashFlowPayloadError(`${where}.${key} must be a finite number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/** A number the caller may omit. Absent is `0`; present-but-broken still throws. */
function optionalNum(source: Record<string, unknown>, key: string, where: string): number {
  if (source[key] === undefined || source[key] === null) return 0;
  return num(source, key, where);
}

function text(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CashFlowPayloadError(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

// ── Years ───────────────────────────────────────────────────────────────────

/**
 * One year, with its units attached.
 *
 * `equity` and `lvr` are computed rather than read even though the modal has
 * both: two sources for one relationship is how a document ends up saying the
 * loan is 62% of a value it also prints, and 58% two rows down.
 */
export function toProjectionYear(raw: unknown, index: number): ProjectionYear {
  const where = `years[${index}]`;
  const r = record(raw, where);

  const propertyValue = num(r, 'propertyValue', where);
  const loanBalance = num(r, 'loanBalance', where);
  const equity = propertyValue - loanBalance;
  const lvr = propertyValue > 0 ? (loanBalance / propertyValue) * 100 : 0;

  const preTaxAnnual = num(r, 'preTaxAnnual', where);
  const afterTaxAnnual = num(r, 'afterTaxAnnual', where);

  const yearNumber = Math.trunc(optionalNum(r, 'year', where)) || index + 1;
  const calendarRaw = r.calendarYear;
  const calendarYear = typeof calendarRaw === 'number' && Number.isFinite(calendarRaw)
    ? Math.trunc(calendarRaw)
    : null;

  return {
    year: yearNumber,
    calendarYear,

    propertyValue: aud(propertyValue),
    loanBalance: aud(loanBalance),
    equity: aud(equity),
    lvr: percent(lvr, 1),

    rentalIncome: audPerYear(num(r, 'rentalIncome', where)),
    grossYield: percent(num(r, 'grossYield', where)),
    netYield: percent(num(r, 'netYield', where)),

    expenses: audPerYear(num(r, 'expenses', where)),
    interestRate: percent(num(r, 'interestRate', where)),
    interest: audPerYear(num(r, 'interest', where)),
    principal: audPerYear(optionalNum(r, 'principal', where)),

    preTaxAnnual: audPerYear(preTaxAnnual),
    preTaxWeekly: audPerWeek(preTaxAnnual / WEEKS_PER_YEAR),
    afterTaxAnnual: audPerYear(afterTaxAnnual),
    afterTaxWeekly: audPerWeek(afterTaxAnnual / WEEKS_PER_YEAR),

    depreciation: audPerYear(optionalNum(r, 'depreciation', where)),
    taxRefund: audPerYear(optionalNum(r, 'taxRefund', where)),
    // The SIGNED tax effect. A client that predates the fix sends no
    // `taxEffect`, and the refund is then the whole of it — which is exactly
    // what this renderer assumed before a rental PROFIT started being taxed.
    taxEffect: audPerYear(
      r.taxEffect === undefined || r.taxEffect === null
        ? optionalNum(r, 'taxRefund', where)
        : optionalNum(r, 'taxEffect', where),
    ),
    landTax: audPerYear(optionalNum(r, 'landTax', where)),

    capitalGrowth: percent(optionalNum(r, 'capitalGrowth', where), 1),
    cpiGrowth: percent(optionalNum(r, 'cpiGrowth', where), 1),
  };
}

// ── The purchase ────────────────────────────────────────────────────────────

const LOAN_TYPE_LABEL: Record<string, string> = {
  interest_only: 'Interest only',
  principal_interest: 'Principal & interest',
  principal_and_interest: 'Principal & interest',
  pi: 'Principal & interest',
  io: 'Interest only',
};

/** A loan type as a reader would say it, falling back to what was sent. */
export function loanTypeLabel(raw: unknown): string {
  const key = text(raw, 40).toLowerCase().replace(/[\s-]+/g, '_');
  return LOAN_TYPE_LABEL[key] ?? (text(raw, 40) || 'Not stated');
}

export function toAcquisition(raw: unknown): AcquisitionBlock {
  const where = 'acquisition';
  const r = record(raw, where);

  const purchasePrice = num(r, 'purchasePrice', where);
  const loanAmount = num(r, 'loanAmount', where);
  const marketValue = optionalNum(r, 'marketValue', where) || purchasePrice;

  const costs: LabelledAmount[] = (Array.isArray(r.costs) ? r.costs : [])
    .slice(0, MAX_ACQUISITION_COSTS)
    .map((entry, i): LabelledAmount | null => {
      const c = record(entry, `${where}.costs[${i}]`);
      const label = text(c.label, 60);
      if (!label) return null;
      const amount = num(c, 'amount', `${where}.costs[${i}]`);
      // A zero cost is a line that says nothing. The legacy generator prints
      // "$0" for every item a client did not incur, and the table reads as
      // though they did.
      return amount === 0 ? null : { label, amount: aud(amount) };
    })
    .filter((c): c is LabelledAmount => c !== null);

  return {
    purchasePrice: aud(purchasePrice),
    marketValue: aud(marketValue),
    deposit: aud(optionalNum(r, 'deposit', where)),
    loanAmount: aud(loanAmount),
    lvr: percent(marketValue > 0 ? (loanAmount / marketValue) * 100 : 0, 1),
    loanTerm: yearsUnit(Math.trunc(optionalNum(r, 'loanTermYears', where)) || 30),
    interestRate: percent(num(r, 'interestRate', where)),
    loanType: loanTypeLabel(r.loanType),
    weeklyRent: audPerWeek(optionalNum(r, 'weeklyRent', where)),
    costs,
  };
}

// ── Derived blocks ──────────────────────────────────────────────────────────

export function toYearOne(first: ProjectionYear): YearOneBlock {
  return {
    rentalIncome: first.rentalIncome,
    expenses: first.expenses,
    interest: first.interest,
    preTaxAnnual: first.preTaxAnnual,
    preTaxWeekly: first.preTaxWeekly,
    afterTaxAnnual: first.afterTaxAnnual,
    afterTaxWeekly: first.afterTaxWeekly,
    grossYield: first.grossYield,
    netYield: first.netYield,
    taxRefund: first.taxRefund,
    taxEffect: first.taxEffect,
  };
}

export function toOutcome(rows: readonly ProjectionYear[]): OutcomeBlock {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const cumulative = rows.reduce((sum, y) => sum + y.afterTaxAnnual.value, 0);
  const breakEven = rows.find((y) => y.afterTaxAnnual.value >= 0);

  return {
    endingValue: last.propertyValue,
    endingLoanBalance: last.loanBalance,
    endingEquity: last.equity,
    capitalGain: aud(last.propertyValue.value - first.propertyValue.value),
    cumulativeAfterTax: aud(cumulative),
    breakEvenYear: breakEven ? breakEven.year : null,
  };
}

// ── The sentence under the headline ─────────────────────────────────────────

const money = (m: Measure): string => {
  const abs = Math.abs(Math.round(m.value));
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${m.value < 0 ? '-' : ''}$${grouped}`;
};

/**
 * Two sentences that agree with the table, because they are built from it.
 *
 * Deliberately not free text and deliberately not model-written: this is the
 * paragraph a client reads first, and every figure in it has to be the same
 * figure that appears below.
 */
export function describeProjection(
  meta: { propertyAddress: string; termYears: number },
  yearOne: YearOneBlock,
  outcome: OutcomeBlock,
): string {
  const holding = yearOne.afterTaxWeekly.value;
  const position = holding >= 0
    ? `returns ${money(yearOne.afterTaxWeekly)} a week after tax in year one`
    : `costs ${money({ ...yearOne.afterTaxWeekly, value: Math.abs(holding) })} a week after tax to hold in year one`;

  const breakEven = outcome.breakEvenYear
    ? (outcome.breakEvenYear === 1
      ? 'It is cash-flow positive from the first year.'
      : `On these assumptions it turns cash-flow positive in year ${outcome.breakEvenYear}.`)
    : 'On these assumptions it does not turn cash-flow positive within the projected term.';

  return `${meta.propertyAddress || 'The property'} ${position}. `
    + `Over ${meta.termYears} years the projection shows ${money(outcome.capitalGain)} of capital growth `
    + `and ${money(outcome.endingEquity)} of equity at the end of the term. ${breakEven}`;
}

// ── The whole payload ───────────────────────────────────────────────────────

export interface BuildProjectionInput {
  /** The request body's `projection`, straight off the wire. */
  source: unknown;
  /** Read from the `investment_reports` row, never from the caller. */
  propertyAddress: string;
  /** Read from the `clients` row, never from the caller. */
  clientName: string;
  /** The clock lives at the edge. */
  now: string;
}

export function buildProjection(input: BuildProjectionInput): CashFlowProjection {
  const source = record(input.source, 'projection');

  const rawYears = Array.isArray(source.years) ? source.years : [];
  if (rawYears.length < MIN_PROJECTION_YEARS) {
    throw new CashFlowPayloadError('projection.years must contain at least one year');
  }
  if (rawYears.length > MAX_PROJECTION_YEARS) {
    throw new CashFlowPayloadError(
      `projection.years has ${rawYears.length} entries; at most ${MAX_PROJECTION_YEARS} are accepted`,
    );
  }

  const years = rawYears.map(toProjectionYear);
  const acquisition = toAcquisition(source.acquisition);
  const yearOne = toYearOne(years[0]);
  const outcome = toOutcome(years);

  const assumptions: AssumptionRow[] = (Array.isArray(source.assumptions) ? source.assumptions : [])
    .slice(0, MAX_ASSUMPTIONS)
    .map((entry) => {
      const a = record(entry, 'projection.assumptions[]');
      return { label: text(a.label, 60), value: text(a.value, 120) };
    })
    .filter((a) => a.label && a.value);

  const notes: string[] = (Array.isArray(source.notes) ? source.notes : [])
    .slice(0, MAX_NOTES)
    .map((n) => text(n, 240))
    .filter(Boolean);

  const meta = {
    propertyAddress: input.propertyAddress,
    clientName: input.clientName,
    preparedOn: input.now,
    termYears: years.length,
  };

  return {
    meta,
    narrative: describeProjection(meta, yearOne, outcome),
    acquisition,
    yearOne,
    years,
    outcome,
    assumptions,
    notes,
  };
}

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
  SettlementBlock,
  YearOneBlock,
} from './payload.pure.ts';
import {
  buildConstructionSchedule,
  CONSTRUCTION_STAGES,
  scheduleDuration,
  type ConstructionSchedule,
  type SchedulePreset,
} from './constructionSchedule.pure.ts';
import { acquisitionExpenditure } from './expenditure.pure.ts';
import { inputSummaryLines, type CashFlowInputs } from './inputSummary.pure.ts';

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

  // The two summary lines of the legacy table. Sent by a current client (the
  // engine computes them); DERIVED where an older client did not send them, by
  // the engine's own definition — expenses, interest, depreciation and land
  // tax are the deductions, and the rent less them is the profit or loss.
  const rentalIncome = num(r, 'rentalIncome', where);
  const expenses = num(r, 'expenses', where);
  const interest = num(r, 'interest', where);
  const depreciation = optionalNum(r, 'depreciation', where);
  const landTax = optionalNum(r, 'landTax', where);
  const totalDeductions = r.totalDeductions === undefined || r.totalDeductions === null
    ? expenses + interest + depreciation + landTax
    : num(r, 'totalDeductions', where);
  const netProfitLoss = r.netProfitLoss === undefined || r.netProfitLoss === null
    ? rentalIncome - totalDeductions
    : num(r, 'netProfitLoss', where);

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

    rentalIncome: audPerYear(rentalIncome),
    grossYield: percent(num(r, 'grossYield', where)),
    netYield: percent(num(r, 'netYield', where)),

    expenses: audPerYear(expenses),
    interestRate: percent(num(r, 'interestRate', where)),
    interest: audPerYear(interest),
    principal: audPerYear(optionalNum(r, 'principal', where)),

    preTaxAnnual: audPerYear(preTaxAnnual),
    preTaxWeekly: audPerWeek(preTaxAnnual / WEEKS_PER_YEAR),
    afterTaxAnnual: audPerYear(afterTaxAnnual),
    afterTaxWeekly: audPerWeek(afterTaxAnnual / WEEKS_PER_YEAR),

    depreciation: audPerYear(depreciation),
    taxRefund: audPerYear(optionalNum(r, 'taxRefund', where)),
    // The SIGNED tax effect. A client that predates the fix sends no
    // `taxEffect`, and the refund is then the whole of it — which is exactly
    // what this renderer assumed before a rental PROFIT started being taxed.
    taxEffect: audPerYear(
      r.taxEffect === undefined || r.taxEffect === null
        ? optionalNum(r, 'taxRefund', where)
        : optionalNum(r, 'taxEffect', where),
    ),
    landTax: audPerYear(landTax),
    totalDeductions: audPerYear(totalDeductions),
    netProfitLoss: audPerYear(netProfitLoss),

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

// ── The inputs, the expenditure and the construction schedule ──────────────

const PRESETS: readonly SchedulePreset[] = ['rapid', 'even', 'custom'];
/** A price past this is a mistake in the units, not a property. */
const MAX_PRICE = 1e10;

function bounded(source: Record<string, unknown>, key: string, where: string, max = MAX_PRICE): number {
  const value = optionalNum(source, key, where);
  if (Math.abs(value) > max) {
    throw new CashFlowPayloadError(`${where}.${key} is out of range (${value})`);
  }
  return value;
}

function sixNumbers(raw: unknown, where: string): number[] {
  if (!Array.isArray(raw) || raw.length !== CONSTRUCTION_STAGES.length) {
    throw new CashFlowPayloadError(`${where} must list exactly ${CONSTRUCTION_STAGES.length} numbers`);
  }
  return raw.map((v, i) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) throw new CashFlowPayloadError(`${where}[${i}] must be a finite number`);
    return n;
  });
}

/**
 * The structured inputs, or null where the caller predates them.
 *
 * Every figure is re-read here with its unit and its range: the summary is
 * printed as the case the table rests on, so a field the caller got wrong must
 * fail here with its name rather than print.
 */
export function toInputs(raw: unknown): CashFlowInputs | null {
  if (raw === undefined || raw === null) return null;
  const where = 'projection.inputs';
  const r = record(raw, where);
  const nullablePrice = (key: string): number | null => {
    if (r[key] === undefined || r[key] === null) return null;
    const v = bounded(r, key, where);
    return v > 0 ? v : null;
  };

  let construction: CashFlowInputs['construction'] = null;
  if (r.construction !== undefined && r.construction !== null) {
    const c = record(r.construction, `${where}.construction`);
    const preset = text(c.preset, 12) as SchedulePreset;
    const stagePercents = sixNumbers(c.stagePercents, `${where}.construction.stagePercents`);
    if (stagePercents.some((p) => p < 0 || p > 100)) {
      throw new CashFlowPayloadError(`${where}.construction.stagePercents must each lie between 0 and 100`);
    }
    construction = {
      durationMonths: scheduleDuration(optionalNum(c, 'durationMonths', `${where}.construction`)),
      preset: PRESETS.includes(preset) ? preset : 'rapid',
      stagePercents,
      stageMonths: sixNumbers(c.stageMonths, `${where}.construction.stageMonths`),
    };
  }

  const assumed = (Array.isArray(r.assumed) ? r.assumed : [])
    .slice(0, 60)
    .map((v) => text(v, 40))
    .filter(Boolean);
  const fingerprint = text(r.caseFingerprint, 16);

  return {
    isNewBuild: r.isNewBuild === true,
    // Only a new build can be a planned one.
    plannedBuild: r.isNewBuild === true && r.plannedBuild === true,
    purchasePrice: bounded(r, 'purchasePrice', where),
    weeklyRent: bounded(r, 'weeklyRent', where, 1e7),
    landPrice: nullablePrice('landPrice'),
    buildPrice: nullablePrice('buildPrice'),
    buildDerived: r.buildDerived === true,
    deposit: bounded(r, 'deposit', where),
    loanAmount: bounded(r, 'loanAmount', where),
    interestRate: bounded(r, 'interestRate', where, 100),
    capitalGrowth: bounded(r, 'capitalGrowth', where, 100),
    cpiGrowth: bounded(r, 'cpiGrowth', where, 100),
    taxRate: bounded(r, 'taxRate', where, 100),
    depreciation: bounded(r, 'depreciation', where),
    councilRates: bounded(r, 'councilRates', where),
    waterRates: bounded(r, 'waterRates', where),
    managementFeePercent: bounded(r, 'managementFeePercent', where, 100),
    landlordInsurance: bounded(r, 'landlordInsurance', where),
    lettingFees: bounded(r, 'lettingFees', where),
    repairsMaintenance: bounded(r, 'repairsMaintenance', where),
    bodyCorporate: bounded(r, 'bodyCorporate', where),
    stampDuty: bounded(r, 'stampDuty', where),
    solicitorFees: bounded(r, 'solicitorFees', where),
    inspectionFees: bounded(r, 'inspectionFees', where),
    agentFee: bounded(r, 'agentFee', where),
    lmiAmount: bounded(r, 'lmiAmount', where),
    occupancyWeeks: bounded(r, 'occupancyWeeks', where, 53) || WEEKS_PER_YEAR,
    loanType: text(r.loanType, 40),
    interestOnlyYears: Math.max(0, Math.trunc(bounded(r, 'interestOnlyYears', where, 40))),
    loanTermYears: Math.max(1, Math.trunc(bounded(r, 'loanTermYears', where, 50)) || 30),
    assumed,
    caseFingerprint: /^[0-9a-f]{4,16}$/i.test(fingerprint) ? fingerprint : null,
    construction,
  };
}

/**
 * A new build's staged contract, computed HERE from its inputs by the same
 * module the on-screen analysis uses — never accepted as a table of figures.
 * Only a new build, with a build contract, is staged.
 */
export function toConstruction(inputs: CashFlowInputs | null): ConstructionSchedule | null {
  if (!inputs?.isNewBuild || !inputs.construction || inputs.buildPrice === null) return null;
  return buildConstructionSchedule({
    landPrice: inputs.landPrice ?? 0,
    buildPrice: inputs.buildPrice,
    interestRate: inputs.interestRate,
    durationMonths: inputs.construction.durationMonths,
    stagePercents: inputs.construction.stagePercents,
    stageMonths: inputs.construction.stageMonths,
  });
}

/** The "Today" column: the position at settlement. */
export function toSettlement(raw: unknown, acquisition: AcquisitionBlock): SettlementBlock {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const where = 'projection.settlement';
  const value = r.propertyValue === undefined || r.propertyValue === null
    ? acquisition.purchasePrice.value
    : num(r, 'propertyValue', where);
  const loan = r.loanBalance === undefined || r.loanBalance === null
    ? acquisition.loanAmount.value
    : num(r, 'loanBalance', where);
  return {
    propertyValue: aud(value),
    purchasePrice: acquisition.purchasePrice,
    loanBalance: aud(loan),
    equity: aud(value - loan),
    lvr: percent(settlementLoanShare(loan, value), 1),
    weeklyRent: acquisition.weeklyRent,
  };
}

/** The loan as a percentage of the value, the same relationship `toProjectionYear` prints. */
function settlementLoanShare(loan: number, value: number): number {
  return value > 0 ? (loan / value) * 100 : 0;
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

/**
 * What the term adds up to.
 *
 * `startValue` is the value TODAY, at settlement. Capital growth over a
 * ten-year term is year ten's value less today's — the legacy export's
 * definition. Measured from the end of year one instead, as this module first
 * did, it drops a whole year of growth: $1,094,495 printed where the term's
 * growth was $1,177,745 on 37 Bolin Street. The first projected year is the
 * fallback only for a caller that cannot say what today's value is.
 */
export function toOutcome(rows: readonly ProjectionYear[], startValue?: number): OutcomeBlock {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const start = typeof startValue === 'number' && Number.isFinite(startValue)
    ? startValue
    : first.propertyValue.value;
  const cumulative = rows.reduce((sum, y) => sum + y.afterTaxAnnual.value, 0);
  const breakEven = rows.find((y) => y.afterTaxAnnual.value >= 0);

  return {
    endingValue: last.propertyValue,
    endingLoanBalance: last.loanBalance,
    endingEquity: last.equity,
    capitalGain: aud(last.propertyValue.value - start),
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
  const inputs = toInputs(source.inputs);
  const construction = toConstruction(inputs);
  const expenditure = inputs
    ? acquisitionExpenditure({
      purchasePrice: inputs.purchasePrice,
      deposit: inputs.deposit,
      stampDuty: inputs.stampDuty,
      solicitorFees: inputs.solicitorFees,
      inspectionFees: inputs.inspectionFees,
      agentFee: inputs.agentFee,
      lmiAmount: inputs.lmiAmount,
      schedule: construction,
    })
    : null;
  const showConstructionSchedule = Boolean(
    construction && source.inputs && (source.inputs as Record<string, unknown>).showConstructionSchedule !== false,
  );
  const yearOne = toYearOne(years[0]);
  const settlement = toSettlement(source.settlement, acquisition);
  const outcome = toOutcome(years, settlement.propertyValue.value);

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
    inputs: inputs ? inputSummaryLines(inputs) : [],
    expenditure,
    construction,
    showConstructionSchedule,
    plannedBuild: Boolean(construction && inputs?.plannedBuild),
    settlement,
    yearOne,
    years,
    outcome,
    assumptions,
    notes,
  };
}

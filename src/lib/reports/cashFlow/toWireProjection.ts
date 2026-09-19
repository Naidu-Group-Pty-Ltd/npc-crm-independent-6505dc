/**
 * The modal's projection, as the render route wants it.
 *
 * A rename and a reshape, and nothing else — no arithmetic. That is the whole
 * point of keeping it here instead of inline in a 6,000-line component: the
 * mapping from `YearlyProjection` to the wire is the one place a field can be
 * silently dropped, and it is small enough to read in one screen and test.
 *
 * Two decisions worth naming:
 *
 *  - **Year 0 is not a projected year.** The modal computes eleven rows, and
 *    the first is the settlement position with every cash-flow figure forced to
 *    zero. Printing it as "Year 0" in a client's projection table puts a row of
 *    zeroes at the head of the document; it belongs in the acquisition block,
 *    where it already is.
 *  - **Rates arrive percent-scaled.** The modal multiplies by 100 before it
 *    stores them (`capitalGrowthRate: yearCapitalGrowthRate * 100`), so `5`
 *    means five percent all the way through. The server's `percent` unit means
 *    the same thing, so nothing is converted here — which is the only reason
 *    that is safe to say.
 */
import type { WireAcquisition, WireProjection, WireProjectionYear } from './requestCashFlowPdf';

/** The fields this mapper reads off one of the modal's projected years. */
export interface ModalProjectionYear {
  year: number;
  capitalGrowthRate: number;
  cpiGrowthRate: number;
  propertyMarketValue: number;
  loanAmount: number;
  rentalIncome: number;
  grossYield: number;
  netYield: number;
  propertyExpenses: number;
  interestRate: number;
  interestPayments: number;
  principalPayments: number;
  preTaxCashFlowPA: number;
  depreciation: number;
  taxRefund: number;
  taxPayable?: number;
  taxEffect?: number;
  landTax: number;
  afterTaxCashFlowPA: number;
}

/** The fields this mapper reads off the modal's `baseFinancialData`. */
export interface ModalBaseFinancials {
  purchasePrice: number;
  marketValueNow: number;
  depositValue: number;
  loanAmount: number;
  loanTermYears: number;
  interestRate: number;
  loanType: string;
  weeklyRent: number;
  stampDuty: number;
  solicitorFees: number;
  inspectionFees?: number;
  lmiAmount: number;
  capitalGrowth: number;
  cpiGrowthRate: number;
  taxRate: number;
  occupancyRate: number;
  depreciation: number;
  includeDepreciationInCashFlow: boolean;
}

const finite = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

function toYear(row: ModalProjectionYear, calendarYear: number | null): WireProjectionYear {
  return {
    year: finite(row.year),
    calendarYear,
    propertyValue: finite(row.propertyMarketValue),
    loanBalance: finite(row.loanAmount),
    rentalIncome: finite(row.rentalIncome),
    grossYield: finite(row.grossYield),
    netYield: finite(row.netYield),
    expenses: finite(row.propertyExpenses),
    interestRate: finite(row.interestRate),
    interest: finite(row.interestPayments),
    principal: finite(row.principalPayments),
    preTaxAnnual: finite(row.preTaxCashFlowPA),
    afterTaxAnnual: finite(row.afterTaxCashFlowPA),
    depreciation: finite(row.depreciation),
    taxRefund: finite(row.taxRefund),
    // The signed effect, so the renderer can say "(payable)" rather than
    // printing a zero refund beside a cash flow that fell.
    taxEffect: row.taxEffect === undefined ? finite(row.taxRefund) : finite(row.taxEffect),
    landTax: finite(row.landTax),
    capitalGrowth: finite(row.capitalGrowthRate),
    cpiGrowth: finite(row.cpiGrowthRate),
  };
}

function toAcquisition(base: ModalBaseFinancials): WireAcquisition {
  // Only costs the client actually incurred. A `$0` line for a fee they did not
  // pay reads as though they paid nothing for something, rather than nothing at
  // all — the server drops zeroes too, and this is the same rule stated twice
  // on purpose, because each end is readable on its own.
  const costs = [
    { label: 'Stamp duty', amount: finite(base.stampDuty) },
    { label: 'Legal fees', amount: finite(base.solicitorFees) },
    { label: 'Inspection fees', amount: finite(base.inspectionFees) },
    { label: "Lenders mortgage insurance", amount: finite(base.lmiAmount) },
  ].filter((c) => c.amount > 0);

  return {
    purchasePrice: finite(base.purchasePrice),
    marketValue: finite(base.marketValueNow) || finite(base.purchasePrice),
    deposit: finite(base.depositValue),
    loanAmount: finite(base.loanAmount),
    loanTermYears: finite(base.loanTermYears) || 30,
    interestRate: finite(base.interestRate),
    loanType: String(base.loanType ?? ''),
    weeklyRent: finite(base.weeklyRent),
    costs,
  };
}

/**
 * The assumptions the projection was run on.
 *
 * Stated rather than implied. Every figure past year one is these five numbers
 * compounded, and a client who cannot see them cannot judge the table.
 */
function toAssumptions(base: ModalBaseFinancials): Array<{ label: string; value: string }> {
  const pct = (n: number) => `${finite(n).toFixed(2).replace(/\.00$/, '')}%`;
  return [
    { label: 'Capital growth', value: `${pct(base.capitalGrowth)} per year` },
    { label: 'Expense inflation (CPI)', value: `${pct(base.cpiGrowthRate)} per year` },
    { label: 'Interest rate', value: pct(base.interestRate) },
    { label: 'Marginal tax rate', value: pct(base.taxRate) },
    { label: 'Occupancy', value: `${finite(base.occupancyRate)} weeks per year` },
    {
      label: 'Depreciation',
      value: base.includeDepreciationInCashFlow
        ? `Included, $${Math.round(finite(base.depreciation)).toLocaleString('en-AU')} in year one`
        : 'Excluded from this projection',
    },
  ];
}

export interface ToWireProjectionInput {
  /** All eleven rows, year 0 first, exactly as the modal computed them. */
  projections: readonly ModalProjectionYear[];
  base: ModalBaseFinancials;
  /** The calendar year year 1 falls in. Omitted when the caller cannot say. */
  firstCalendarYear?: number | null;
  /** Anything the adviser should have said out loud on the page. */
  notes?: readonly string[];
}

export function toWireProjection(input: ToWireProjectionInput): WireProjection {
  // Year 0 is the settlement position, not a projected year — see the module
  // comment. Filtering by the year number rather than slicing means a caller
  // that already dropped it is not punished for it.
  const projected = input.projections.filter((row) => finite(row.year) >= 1);

  const first = input.firstCalendarYear ?? null;

  return {
    acquisition: toAcquisition(input.base),
    years: projected.map((row, i) => toYear(row, first === null ? null : first + i)),
    assumptions: toAssumptions(input.base),
    notes: [...(input.notes ?? [])],
  };
}

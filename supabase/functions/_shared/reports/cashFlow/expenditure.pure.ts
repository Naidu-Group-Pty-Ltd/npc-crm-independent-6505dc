/**
 * "Total Upfront Costs" and "Total Overall Expenditure to Completion" — what a
 * purchase costs the buyer on the day, and what it costs all told.
 *
 * Written once. The same rows used to be composed THREE times inside
 * `CashFlowAnalysisModal` (the jsPDF export, the HTML print and the screen),
 * and the typeset document composed none of them, so a new build's document
 * never said what the build contract, the land deposit or the construction
 * interest came to.
 *
 * Two shapes, as the legacy export draws them:
 *
 *  - **An established property**: the deposit, stamp duty, conveyancing,
 *    inspections, the agent's fee and LMI up front; the price, duty,
 *    conveyancing and agent's fee all told.
 *  - **A new build with a staged contract**: 10% of the land and 5% of the
 *    build up front with duty, conveyancing and the interest carried during
 *    construction; the land, duty, conveyancing, the build contract and that
 *    interest all told.
 *
 * Every total is the SUM OF ITS OWN ROWS — `CASH_FLOW.md` records what a total
 * printed under figures it does not add up to costs a client — and a row the
 * buyer did not pay (a zero) is left out rather than printed as `$0`, which
 * never changes a total.
 */
import type { ConstructionSchedule } from './constructionSchedule.pure.ts';

export interface ExpenditureLine {
  label: string;
  amount: number;
}

export interface ExpenditureTable {
  rows: ExpenditureLine[];
  total: number;
}

export interface AcquisitionExpenditure {
  basis: 'established' | 'new_build';
  upfront: ExpenditureTable;
  overall: ExpenditureTable;
}

export interface ExpenditureInput {
  purchasePrice: number;
  /** The buyer's own contribution at settlement. */
  deposit: number;
  stampDuty: number;
  solicitorFees: number;
  inspectionFees: number;
  agentFee: number;
  lmiAmount: number;
  /** Present only for a new build with a staged contract. */
  schedule: ConstructionSchedule | null;
}

const money = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function table(lines: ExpenditureLine[]): ExpenditureTable {
  const rows = lines.filter((l) => l.amount !== 0);
  return { rows, total: rows.reduce((s, l) => s + l.amount, 0) };
}

export function acquisitionExpenditure(input: ExpenditureInput): AcquisitionExpenditure {
  const stampDuty = money(input.stampDuty);
  const solicitor = money(input.solicitorFees);
  const inspections = money(input.inspectionFees);
  const agentFee = money(input.agentFee);
  const lmi = money(input.lmiAmount);
  const s = input.schedule;

  if (s) {
    const interestLabel = `Construction Progress Payment Interest (${s.durationMonths} months)`;
    const interest = s.totals.totalCombinedRepayment;
    return {
      basis: 'new_build',
      upfront: table([
        { label: '10% Land Deposit', amount: s.upfrontCosts.tenPercentLand },
        { label: '5% Build Contract Deposit', amount: s.upfrontCosts.fivePercentBuild },
        { label: 'Stamp Duty', amount: stampDuty },
        { label: 'Solicitor / Conveyancer Cost', amount: solicitor },
        { label: interestLabel, amount: interest },
        { label: 'LMI (Lenders Mortgage Insurance)', amount: lmi },
      ]),
      overall: table([
        { label: 'Purchase Price (Land)', amount: s.landPrice },
        { label: 'Stamp Duty', amount: stampDuty },
        { label: 'Solicitor / Conveyancer Cost', amount: solicitor },
        { label: 'Build Price', amount: s.buildPrice },
        { label: interestLabel, amount: interest },
      ]),
    };
  }

  const price = money(input.purchasePrice);
  const deposit = money(input.deposit);
  const depositPct = price > 0 ? Math.round((deposit / price) * 100) : 0;
  return {
    basis: 'established',
    upfront: table([
      { label: `Deposit (${depositPct}% — from your funds)`, amount: deposit },
      { label: 'Stamp Duty', amount: stampDuty },
      { label: 'Solicitor / Conveyancer Cost', amount: solicitor },
      { label: 'Building & Pest Inspections', amount: inspections },
      { label: 'Agent Fee', amount: agentFee },
      { label: 'LMI (Lenders Mortgage Insurance)', amount: lmi },
    ]),
    overall: table([
      { label: 'Purchase Price', amount: price },
      { label: 'Stamp Duty', amount: stampDuty },
      { label: 'Solicitor / Conveyancer Cost', amount: solicitor },
      { label: 'Agent Fee', amount: agentFee },
    ]),
  };
}

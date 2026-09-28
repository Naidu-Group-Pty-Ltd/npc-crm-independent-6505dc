/**
 * The Borrowing Capacity Snapshot, as data.
 *
 * The shipping generator types its input as `assessment: any` and then reaches
 * into ten nested shapes across 1300 lines; the real contract is spread through
 * the drawing code, which is why three implementations of the same report each
 * guessed at it differently (`BORROWING_CAPACITY.md` §3, F9).
 *
 * This is that contract, written down. Two rules hold throughout:
 *
 *  - **Every number is a `Measure`.** Nothing here is a bare `number` that a
 *    renderer has to guess the unit of.
 *  - **Absence is `null`, not a zero or an empty object.** A report with no LMI
 *    is different from one with a $0 premium, and the renderer must be able to
 *    tell.
 *
 * Nothing in this module renders anything. Phase 2 turns it into HTML; the
 * types here say nothing about how it should look.
 */

import type { Measure } from '../../reportDesign/measure.pure.ts';
import type { AuditCategory, Direction } from './audit.pure.ts';

/**
 * The serviceability band, named rather than coloured.
 *
 * The row stores `'green' | 'amber' | 'red'` — a colour where a judgement
 * belongs, which is how the same three values ended up hard-coded as three
 * different greens and two different ambers across the five generators (F7).
 * The payload carries the judgement; Phase 2 decides what colour it is.
 */
export type Band = 'strong' | 'moderate' | 'limited';

export interface IncomeRow {
  label: string;
  gross: Measure;
  /** The shading applied, as a 0–1 fraction — `rate`, never `percent`. */
  shading: Measure;
  shaded: Measure;
}

export interface LiabilityRow {
  /** The liability's kind, title-cased: "Credit Card", "Mortgage". */
  kind: string;
  /** The provider or account name, when one is recorded. */
  provider: string | null;
  balance: Measure | null;
  limit: Measure | null;
  monthlyServicing: Measure;
  note: string | null;
}

/** One line of the capacity ledger — the running arithmetic on page 4. */
export interface LedgerRow {
  label: string;
  amount: Measure;
  /**
   * `total` is the final line; `subtotal` is a line the rows above it add up
   * to (after-tax income, the monthly surplus). Renderers may rule them.
   */
  emphasis: 'normal' | 'subtotal' | 'total';
  /**
   * Whether this line helps or hurts the client. A deduction is `adverse`
   * whatever the sign of the number printed next to it (F6).
   */
  direction: Direction;
}

export interface AuditRow {
  seq: number;
  label: string;
  category: AuditCategory;
  action: string;
  rule: string;
  note: string | null;
  raw: Measure;
  assessed: Measure;
  /** `null` when the two sides are not the same unit, or the action is unknown. */
  delta: Measure | null;
  direction: Direction;
  /**
   * False when this module does not know the action. The row still renders —
   * with its label and rule — but without a delta and without a colour.
   */
  known: boolean;
}

export interface AuditSection {
  /** Grouped in the order the report shows them, entries in `seq` order. */
  groups: { category: AuditCategory; rows: AuditRow[] }[];
  summary: {
    incomeShading: Measure;
    expenseAdjustments: Measure;
    liabilityAdjustments: Measure;
    taxImpact: Measure;
    transformations: Measure;
  };
}

export interface ExplanationStep {
  title: string;
  narrative: string;
  figures: { label: string; value: Measure }[];
}

export interface ExplanationSection {
  headline: string | null;
  steps: ExplanationStep[];
}

export interface ScenarioRow {
  name: string;
  capacity: Measure;
  monthlySurplus: Measure;
  band: Band;
  /** Change against the base case. `null` on the base row itself. */
  change: Measure | null;
  /** "Rate +1.00%", "Commitments -$240/mo" — the inputs that moved. */
  adjustments: string[];
  /** Strategy actions, purchase power, capital flow. */
  details: string[];
}

export interface LmiSection {
  premium: Measure;
  lvr: Measure | null;
  propertyValue: Measure | null;
  deposit: Measure | null;
  netForPurchase: Measure | null;
  /** `debt_capitalised` adds the premium to the loan; `display_deduction` takes it off the cash. */
  mode: 'display_deduction' | 'debt_capitalised';
}

export interface UtilisationSection {
  proposedLoan: Measure;
  capacity: Measure;
  /** Proposed ÷ capacity, as a 0–1 fraction. */
  share: Measure;
  withinCapacity: boolean;
}

/**
 * The debt-to-income ratio, shown with its working.
 *
 * The engine divides every debt balance it counted — liabilities AND the loans
 * on properties held — plus the new capacity by an APS 220 income figure. The
 * Snapshot printed the ratio alone beside a liabilities table that lists only
 * the liabilities, so 10.7x sat next to a single $455,000 mortgage and could
 * not be checked. The row stores the ratio and the denominator, not the debt,
 * so the existing debt is derived back from them and stated as the approximation
 * it is (`existingDebt` is rounded to the nearest $10,000, because the ratio is
 * stored to two decimals).
 */
export interface DebtToIncome {
  ratio: Measure;
  /** The income divided by: APS 220's adjusted figure where recorded, else gross. */
  income: Measure;
  /** The new loan the ratio includes — the assessed capacity. */
  capacity: Measure;
  /** Every existing debt the engine counted, approximately. Null when it cannot be derived. */
  existingDebt: Measure | null;
  /**
   * True when the debt counted is clearly more than the liabilities listed —
   * the loans on properties held, which the liabilities table does not show.
   */
  includesPropertyLoans: boolean;
}

export interface BorrowingCapacitySnapshot {
  meta: {
    clientName: string;
    /** ISO-8601. The renderer formats it; the payload does not carry prose dates. */
    assessedOn: string;
    assessmentId: string | null;
    /** The lender policy this assessment was run under, when one was chosen. */
    lenderName: string | null;
  };

  headline: {
    capacity: Measure;
    monthlySurplus: Measure;
    band: Band;
    stressTested: Measure | null;
    /** The rate the stress test ran at: the assessment rate plus the increment. */
    stressRate: Measure | null;
    /** Null when no income is recorded: a ratio over zero income is undefined, not 0.0x. */
    dti: Measure | null;
    assessmentRate: Measure;
    interestRate: Measure;
    bufferRate: Measure;
    loanTerm: Measure;
  };

  /** The executive-summary paragraph. Prose, assembled by the normaliser. */
  narrative: string;

  utilisation: UtilisationSection | null;
  lmi: LmiSection | null;

  /**
   * The settings the assessment ran under, curated (`basis.pure.ts`): read in
   * the report's words, tidied, and without the figures the document states
   * elsewhere.
   */
  assumptions: { label: string; value: string }[];

  income: {
    gross: Measure;
    shaded: Measure;
    rows: IncomeRow[];
    /**
     * False when the record holds no income at all. The engine still returns a
     * capacity ($0), a DTI (0.0x) and a band for it; the document says what is
     * missing instead of presenting those as an assessment.
     */
    recorded: boolean;
  };

  debtToIncome: DebtToIncome | null;

  expenses: {
    /** `hem`, `declared`, `hybrid` — as recorded, title-cased for display. */
    method: string;
    monthlyLiving: Measure;
    monthlyCommitments: Measure;
    liabilities: LiabilityRow[];
  };

  ledger: LedgerRow[];

  recommendations: string[];
  warnings: string[];

  explanation: ExplanationSection | null;
  audit: AuditSection | null;
  scenarios: ScenarioRow[] | null;
}

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
  /** `total` is the final line; renderers may treat it differently. */
  emphasis: 'normal' | 'total';
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

  assumptions: { label: string; value: string }[];

  income: {
    gross: Measure;
    shaded: Measure;
    rows: IncomeRow[];
  };

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

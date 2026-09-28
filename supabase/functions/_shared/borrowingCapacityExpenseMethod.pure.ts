/**
 * Which living-expense method an assessment was run under, and what is
 * restored when it is reopened.
 *
 * The Calculator offers three methods: HEM, Declared, and the higher of the
 * two ("hybrid", the lender standard and the default). It sends the figure
 * the chosen method produces as an explicit `livingExpenses` override, and
 * `calculate-borrowing-capacity` stamped every assessment that carried an
 * override `expense_method: 'declared'`, whatever had been chosen. That value
 * describes "the UI sent a figure", not the method.
 *
 * The modal then restored that stamp as though the adviser had chosen
 * Declared. Where a client has no declared expenses on file, Declared is $0,
 * so reopening the Calculator assessed the household as spending nothing on
 * living costs. The next save stamped 'declared' again, so it never corrected
 * itself.
 *
 * Measured on 28 Sep 2026 in the function's own log for the reported client:
 * `HEM=$3360, Declared=$0, Base=$0 (declared)` on every calculation. The
 * Calculator showed $1,258,615. The Snapshot and the scenario engine, which
 * floor living costs at HEM, showed $856,932. The difference is exactly
 * $3,360 a month repaid at the 9.44% assessment rate over 30 years. Every
 * What-If scenario was measured against the inflated base, so every one read
 * as a loss of about $400k.
 *
 * Two rules:
 *
 * - **The method is recorded as the adviser's choice**, in the assessment's
 *   `assumptions.expenseMethod`, beside the lender settings that are already
 *   restored from there. The `expense_method` column records what was
 *   applied: HEM, Declared, or declared-above-HEM.
 * - **Only a recorded choice is restored.** The old column value cannot be
 *   told apart from the stamp above, so a row without a recorded choice opens
 *   on the default, the higher of HEM or declared.
 */

export const EXPENSE_METHOD_CHOICES = ['hem', 'declared', 'hybrid'] as const;
export type ExpenseMethodChoice = typeof EXPENSE_METHOD_CHOICES[number];

/** The default a Calculator opens on when nothing was recorded. */
export const DEFAULT_EXPENSE_METHOD: ExpenseMethodChoice = 'hybrid';

export function readExpenseMethodChoice(value: unknown): ExpenseMethodChoice | null {
  return typeof value === 'string' && (EXPENSE_METHOD_CHOICES as readonly string[]).includes(value)
    ? (value as ExpenseMethodChoice)
    : null;
}

/**
 * What the `expense_method` column records for a calculation.
 *
 * `fallback` is the label the server used before the choice travelled. It is
 * kept for a caller that sends no choice, so an older browser writes exactly
 * what it wrote before.
 */
export function recordedExpenseMethod(input: {
  choice: ExpenseMethodChoice | null;
  hemBenchmark: number;
  declaredExpenses: number;
  fallback: string;
}): string {
  switch (input.choice) {
    case 'hem': return 'hem';
    case 'declared': return 'declared';
    case 'hybrid':
      return input.declaredExpenses > input.hemBenchmark ? 'declared_higher' : 'hem';
    default:
      return input.fallback;
  }
}

/** The method a reopened Calculator starts on: a recorded choice, or the default. */
export function restorableExpenseMethod(
  assumptions: Record<string, unknown> | null | undefined,
): ExpenseMethodChoice {
  return readExpenseMethodChoice(assumptions?.expenseMethod) ?? DEFAULT_EXPENSE_METHOD;
}

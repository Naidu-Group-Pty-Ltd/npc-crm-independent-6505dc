/**
 * Bridge. The implementation lives with the Edge Functions, so the Calculator
 * and `calculate-borrowing-capacity` read the same rule.
 */
export * from '../../supabase/functions/_shared/borrowingCapacityExpenseMethod.pure.ts';

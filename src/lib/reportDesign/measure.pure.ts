/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * A figure and the unit it is in. This began as part of the Borrowing Capacity
 * payload and turned out to be the design system's vocabulary: the Cash Flow
 * projection needs the same `$1,240/mo` against `$14,880 pa` distinction, and a
 * second implementation of it would be a second set of rounding rules on the
 * same client's money. Nothing may be added here; see
 * `__tests__/designSystemSourceOfTruth.spec.ts`.
 */
export * from '../../../supabase/functions/_shared/reportDesign/measure.pure.ts';

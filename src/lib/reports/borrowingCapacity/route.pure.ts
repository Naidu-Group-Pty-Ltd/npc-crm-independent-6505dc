/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * A Borrowing Capacity Snapshot is built server-side and, for the What-If
 * export, client-side. Both must agree on what the payload is, so there is one
 * implementation and this re-exports it. Nothing may be added here; see
 * `__tests__/borrowingCapacitySourceOfTruth.spec.ts`.
 */
export * from '../../../../supabase/functions/_shared/reports/borrowingCapacity/route.pure.ts';

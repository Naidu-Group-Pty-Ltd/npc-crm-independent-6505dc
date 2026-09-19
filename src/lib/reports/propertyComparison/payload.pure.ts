/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The Property Comparison Analysis is typeset server-side from one stored row,
 * and the browser needs the same types to describe what it is asking for. There
 * is one implementation and this re-exports it. Nothing may be added here; see
 * `__tests__/propertyComparisonSourceOfTruth.spec.ts`.
 */
export * from '../../../../supabase/functions/_shared/reports/propertyComparison/payload.pure.ts';

/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * The Portfolio Performance Review is rendered server-side from two stored
 * rows, and the browser needs the same types to describe what it is asking for.
 * There is one implementation and this re-exports it. Nothing may be added
 * here; see `__tests__/portfolioSourceOfTruth.spec.ts`.
 */
export * from '../../../../supabase/functions/_shared/reports/portfolio/payload.pure.ts';

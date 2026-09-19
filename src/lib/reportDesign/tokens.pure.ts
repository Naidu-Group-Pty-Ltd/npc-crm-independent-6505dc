/**
 * Frontend entry point — re-exports the single CANONICAL implementation in
 * `_shared` so the app, the Edge Functions and Vitest consume the same
 * contract. Edge Functions cannot import from `src/`; `src/` can import from
 * `_shared/`. See docs/reports/DESIGN_SYSTEM.md §3.2.
 *
 * Do not add logic here — `designSystemSourceOfTruth.spec.ts` fails the build
 * if this file is anything other than a re-export.
 */
export * from '../../../supabase/functions/_shared/reportDesign/tokens.pure.ts';

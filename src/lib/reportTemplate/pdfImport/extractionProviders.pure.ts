/**
 * governed extraction provider ensemble (E9) — frontend entry point.
 *
 * Re-exports the single CANONICAL shared implementation so the frontend, the Edge
 * Functions and Vitest all consume the same versioned contracts, fail-closed
 * default policy, safe-error vocabulary and DETERMINISTIC identities — no
 * handwritten duplication that could drift from the sidecar provider package.
 */
export * from '../../../../supabase/functions/_shared/extractionProviders.pure.ts';

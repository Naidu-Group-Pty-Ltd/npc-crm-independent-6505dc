/**
 * PDF Extraction V3 · E10 — frontend entry point for pdfExtractionPlanV3.
 *
 * Re-exports the single CANONICAL shared implementation so the frontend, the Edge
 * Functions and Vitest all consume the same versioned Planner V3 contracts, the
 * same fail-closed routing, the same cache-safety rules and the same
 * DETERMINISTIC identities — no handwritten duplication that could drift from
 * the sidecar `planner_v3` package.
 */
export * from '../../../../supabase/functions/_shared/pdfExtractionPlanV3.pure.ts';

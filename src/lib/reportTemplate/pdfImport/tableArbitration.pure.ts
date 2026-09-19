/**
 * table arbitration + preservation (E4) — frontend entry point.
 *
 * Re-exports the single CANONICAL implementation in `_shared` so the frontend,
 * the Edge Functions and Vitest all consume the same contracts, the same
 * deterministic candidate/cell IDs and the same suppression/report helpers — no
 * handwritten duplication that could drift from the sidecar producer
 * (`pdf-parse-service/table_candidates.py` + `table_integrity.py`).
 */
export * from '../../../../supabase/functions/_shared/tableArbitration.pure.ts';

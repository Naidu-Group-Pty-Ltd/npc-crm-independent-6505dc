/**
 * typography fidelity + preservation (E5) — frontend entry point.
 *
 * Re-exports the single CANONICAL implementation in `_shared` so the frontend,
 * the Edge Functions and Vitest all consume the same contracts, the same
 * deterministic run/font-asset IDs and the same fidelity/resolution/preservation
 * helpers — no handwritten duplication that could drift from the sidecar
 * producers (`pdf-parse-service/source_typography.py` + `font_assets.py`).
 */
export * from '../../../../supabase/functions/_shared/typographyFidelity.pure.ts';

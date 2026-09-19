/**
 * chart-preservation-v1 (E3) — frontend entry point.
 *
 * Re-exports the single CANONICAL implementation that lives in `_shared` so the
 * frontend, the Edge Functions and Vitest all consume the same chart render-plan,
 * suppression resolver and preservation metrics — no handwritten duplication that
 * could silently drift from the sidecar producer (`source_scene_graph.py`).
 */
export * from '../../../../supabase/functions/_shared/chartPreservation.pure.ts';

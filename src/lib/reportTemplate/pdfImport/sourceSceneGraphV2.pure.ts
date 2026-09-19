/**
 * source-scene-graph-v2 (E1) — frontend entry point.
 *
 * Re-exports the single CANONICAL implementation that lives in `_shared` so the
 * frontend, the Edge Functions and Vitest all consume the same types, the same
 * FNV-1a region-ID algorithm and the same validators — no handwritten
 * duplication that could silently drift from the sidecar producer.
 */
export * from '../../../../supabase/functions/_shared/sourceSceneGraphV2.pure.ts';

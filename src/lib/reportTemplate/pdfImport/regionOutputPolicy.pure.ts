/**
 * unified region output policy (E6) — frontend entry point.
 *
 * Re-exports the single CANONICAL implementation in `_shared` so the frontend,
 * the Edge Functions and Vitest all consume the same composition contracts,
 * adapters, ownership graph, render plan, suppression and hashing — no
 * handwritten duplication that could drift from the sidecar / edge producers.
 */
export * from '../../../../supabase/functions/_shared/regionOutputPolicy.pure.ts';

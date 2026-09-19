/**
 * Browser entry point for the node catalog.
 *
 * The catalog itself is shared with the Edge Function that dispatches live
 * workflows — see `supabase/functions/_shared/workflow/catalog/index.pure.ts`.
 * Only `uncoveredIntegrations` stays here: it is the one thing in the catalog's
 * surface that reads the integration registry, and the registry is a browser
 * module the Edge runtime has no business importing.
 */
import { INTEGRATIONS } from '@/lib/integrations/registry';
import { COVERED_INTEGRATIONS } from '../../../supabase/functions/_shared/workflow/catalog/index.pure.ts';

export * from '../../../supabase/functions/_shared/workflow/catalog/index.pure.ts';

/**
 * Integrations with no node yet. Surfaced in the palette as a short "not wired
 * up yet" list rather than hidden, so the gap is visible instead of silently
 * looking like the integration does not exist.
 */
export function uncoveredIntegrations() {
  return INTEGRATIONS.filter((i) => !COVERED_INTEGRATIONS.has(i.id));
}

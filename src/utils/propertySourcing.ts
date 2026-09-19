/**
 * Property sourcing helpers
 *
 * The `sourced_by` enum on `client_properties` was renamed from the brand-specific
 * value `'npc'` to the neutral value `'advisory'` as part of the Tier 6 branding
 * migration. Existing rows have been backfilled to `'advisory'` but legacy callers
 * may still emit `'npc'` for a short rollover period, so all comparisons must
 * accept either token. New writes should always use `ADVISORY_SOURCE`.
 */

export const ADVISORY_SOURCE = 'advisory' as const;

/** Returns true when the property was sourced by our in-house advisory team. */
export function isAdvisorySourced(value: string | null | undefined): boolean {
  return value === ADVISORY_SOURCE || value === 'npc';
}

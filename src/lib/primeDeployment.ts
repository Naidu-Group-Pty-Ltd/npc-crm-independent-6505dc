/**
 * Whether this build is NPC's own deployment — the prime — rather than a clone.
 *
 * ## Why this exists
 *
 * A handful of surfaces are internal operations tooling rather than product.
 * The GHL migration pages are the worked example: they were built to handle a
 * security incident on NPC's own GoHighLevel account, and no tenant has that
 * account, that incident, or any use for the pages.
 *
 * The prime and every clone are built from ONE repository, so a route cannot
 * be removed from a clone by deleting it — that removes it from the prime too,
 * which is where it is still wanted. And it cannot be settled by the module
 * entitlements either: `ModuleGuard` deliberately opens every available module
 * to a SUPERADMIN as the deployment's operator, and a tenant's own
 * administrator is a superadmin of their own workspace. So an entitlement gate
 * closes the door to a tenant's ordinary staff and leaves it open to the one
 * person most likely to go looking.
 *
 * What actually separates the two is which backend the build talks to.
 *
 * ## Why the ref is named here and not shared with the Turnstile resolver
 *
 * `turnstileSiteKey.ts` names the same string, and that is deliberate rather
 * than an oversight to be tidied away. It answers a different question — where
 * the built-in widget's `TURNSTILE_SECRET_KEY` lives — which happens to have
 * the same answer today because the widget belongs to the prime. Collapsing
 * them into one constant would assert that the two must always coincide, and
 * the day the prime's widget is reissued against another project the pairing
 * rule and this one need to move apart, not together.
 */
import { SUPABASE_PROJECT_REF } from '@/integrations/supabase/env';

/**
 * The Supabase project the prime runs on.
 *
 * A clone is provisioned its own project by Mission Control and is pointed at
 * it by `VITE_SUPABASE_URL`, so no clone can match this by accident. A fork
 * that has not been repointed yet is, correctly, still the prime as far as
 * this question goes — it is talking to the prime's backend.
 */
export const PRIME_BACKEND_REF = 'dduzbchuswwbefdunfct';

/**
 * True only where this build talks to the prime's own backend.
 *
 * Fails CLOSED on an unreadable ref: a build whose Supabase URL cannot be
 * parsed is not a deployment anything should be assumed about, and the cost of
 * the two answers is not symmetric — a hidden internal tool is an
 * inconvenience to NPC staff who know where it lives, and a visible one is a
 * tenant reading the inside of somebody else's incident response.
 */
export function isPrimeDeployment(projectRef: string | null = SUPABASE_PROJECT_REF): boolean {
  return projectRef === PRIME_BACKEND_REF;
}

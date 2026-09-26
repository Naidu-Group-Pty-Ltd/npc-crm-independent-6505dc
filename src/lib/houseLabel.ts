/**
 * The words the product puts in front of a partner or a member of staff where
 * the prime has always said "NPC".
 *
 * The owner's rule (26 Sep 2026): the house's identity is a legacy the prime
 * keeps and a clone never sees. The partner portals were written for the
 * prime, so on every clone a solicitor was offered a "Direct line to the NPC
 * team", a finance partner pinged an "NPC owner", matters were "Flagged by
 * NPC", and staff chose a report tier described as carrying the "NPC view".
 *
 * Each site keeps the prime's words as its first argument, verbatim, so the
 * prime reads exactly what it always read, and says beside them what a clone
 * reads instead. A clone reads the staff side as "the Command Centre": it is
 * the product's own name for it, the name the sign-in page carries on every
 * deployment, and several of these screens already used it beside "NPC".
 * Where the house was only the source of something, a clone's sentence leaves
 * the source out rather than naming a stand-in.
 *
 * The deployment is the backend this build talks to (`isPrimeDeployment`),
 * fixed when the app is built, so a label never changes while a page is open.
 * `houseLabelsGuard.spec.ts` holds every literal in the frontend that names
 * the house to this helper, or to a recorded reason.
 */
import { isPrimeDeployment } from './primeDeployment';

/** The prime's words on the prime; the clone's words everywhere else. */
export function houseLabel<P extends string, C extends string>(
  prime: P,
  clone: C,
  isPrime: boolean = isPrimeDeployment(),
): P | C {
  return isPrime ? prime : clone;
}

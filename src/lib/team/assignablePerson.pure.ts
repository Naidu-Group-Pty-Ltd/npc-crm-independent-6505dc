/**
 * Who may be offered as a person to assign work to, or invite to a meeting.
 *
 * Audit item 28: `synthetic.aml.auditor` and `synthetic.aml.mlro` were offered
 * as attendees on an Outlook invite. They are seeded compliance accounts —
 * created together on 2026-08-06, addressed at `@example.invalid` — so an
 * invite sent to either could never arrive anywhere.
 *
 * They are FILTERED, never deleted. Both hold real AML records: between them
 * they carry rows in `aml.case_events`, `aml.client_requests`,
 * `aml.role_assignments`, `aml.verification_checks` and `aml.cases`. Those are
 * compliance history, and this platform's rule for compliance history is that
 * withdrawal is not deletion — removing the accounts would orphan an audit
 * trail to tidy a picker.
 *
 * The test is the ADDRESS, not the name. `.invalid`, `.test`, `.example` and
 * the `example.*` domains are reserved by RFC 2606 and RFC 6761 precisely so
 * they resolve nowhere, so an account addressed at one cannot be contacted by
 * definition — which is exactly what disqualifies it from a list of people to
 * contact. A name list would have to be extended for every future seed; this
 * does not.
 */

export interface AssignableCandidate {
  username?: string | null;
  email?: string | null;
}

/** Domains that are reserved to resolve nowhere. */
const UNROUTABLE_SUFFIXES = [
  '.invalid',
  '.test',
  '.example',
  '.localhost',
  '@example.com',
  '@example.net',
  '@example.org',
];

/** Can mail addressed here ever arrive? */
export function isUnroutableAddress(email: string | null | undefined): boolean {
  const address = (email ?? '').trim().toLowerCase();
  if (!address) return false;
  return UNROUTABLE_SUFFIXES.some((suffix) => address.endsWith(suffix));
}

/**
 * Should this account appear in a picker?
 *
 * An account with NO address stays: plenty of internal records name a
 * colleague who has simply never had an email recorded, and hiding them would
 * remove real people from every assignment list in the product. Only an
 * address that provably goes nowhere disqualifies one.
 */
export function isAssignablePerson(user: AssignableCandidate): boolean {
  return !isUnroutableAddress(user.email);
}

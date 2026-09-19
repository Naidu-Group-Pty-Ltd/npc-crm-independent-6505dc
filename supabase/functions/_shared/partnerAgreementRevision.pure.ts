/**
 * Which revision of the executed-agreement document this build produces.
 *
 * Its own module, with no imports, because **both sides need it**: the Edge
 * Function that renders the copy, and the Command Centre that has to be able to
 * say whether the service it is talking to is the one it expects. Importing the
 * document builder into the browser to read one integer would pull the whole
 * report stylesheet and primitive library into the bundle.
 *
 * ## Why a copy carries a revision at all
 *
 * A copy is written once and never overwritten — that is what lets the Command
 * Centre say the bytes a partner holds are the bytes it holds. It is also why
 * improving the document would otherwise reach only agreements executed after
 * the improvement: every copy already on disk would keep the old presentation
 * for ever, and two partners asking on the same day would receive two
 * different-looking documents.
 *
 * So the revision is part of the object's path (`builder/2026/<id>-r2.pdf`;
 * revision 1 has no suffix, so copies stored before revisions existed still
 * resolve). A re-issue writes a **new** object and repoints the acceptance. No
 * stored object is ever replaced, and no schema column tracks this.
 *
 * ## Why the number is also on the wire
 *
 * Merging is not deploying, and in this repo that gap is not hypothetical: the
 * deploy workflow is opt-in by a `SUPABASE_ACCESS_TOKEN` secret that has never
 * been set, so it reports what it *would* deploy and exits green. Between
 * 2026-08-07 and 2026-08-08 the document was rebuilt on the report design
 * system, merged, and shown green — and every agreement downloaded from all
 * three portals kept coming out in the previous format, because the function
 * rendering them was still the previous function. Nothing anywhere said so. The
 * symptom was a PDF that looked wrong, three portals deep, to the person who
 * had asked for it to look right.
 *
 * The frontend ships on the site build, which *does* deploy. So the app carries
 * the revision it expects, `list_records` and `download_record` report the
 * revision the function is actually running, and a mismatch — including the
 * field being absent, which is what a pre-revision function returns — is stated
 * on screen instead of being discovered in a partner's inbox.
 *
 * ## Changing it
 *
 * Bump when the document's presentation changes materially. Every stored copy
 * below the new number then reports as `superseded`, the Agreements section
 * offers to re-issue them, and any single download re-issues on the spot.
 */
export const AGREEMENT_DOCUMENT_REVISION = 2;

/** Which revision produced the copy at this path. `0` when there is no copy. */
export function agreementRevisionForPath(path: string | null | undefined): number {
  if (!path) return 0;
  const match = /-r(\d+)\.pdf$/.exec(path);
  return match ? Number(match[1]) : 1;
}

/**
 * Whether this acceptance has a copy produced by the current template.
 *
 * `false` covers both "no copy at all" and "a copy the template has moved on
 * from"; the caller treats them the same way, because from a partner's side
 * they are the same problem.
 */
export function hasCurrentAgreementCopy(path: string | null | undefined): boolean {
  return agreementRevisionForPath(path) >= AGREEMENT_DOCUMENT_REVISION;
}

/**
 * What the Command Centre should say about the service it is talking to.
 *
 * `reported` is the revision the function sent back. **`null` means the
 * function did not send one at all**, which is not a missing field to shrug at
 * — it is a function deployed before revisions existed, and therefore one that
 * renders the old document. That is the exact state this whole mechanism was
 * written to make visible, so it is a distinct answer rather than folded into
 * "unknown".
 */
export type AgreementServiceState = 'current' | 'behind' | 'ahead';

export function agreementServiceState(
  reported: number | null | undefined,
  expected: number = AGREEMENT_DOCUMENT_REVISION,
): AgreementServiceState {
  const running = typeof reported === 'number' && Number.isFinite(reported) ? reported : 1;
  if (running < expected) return 'behind';
  // A function ahead of the app is the ordinary order of a staged deploy and is
  // harmless: the copies it writes are newer than the app knows how to describe,
  // not older than the ones it promises.
  if (running > expected) return 'ahead';
  return 'current';
}

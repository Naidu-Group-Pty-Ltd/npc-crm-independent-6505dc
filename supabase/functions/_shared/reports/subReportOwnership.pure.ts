/**
 * Who owns a sub-report, and when a caller may regenerate one that exists.
 *
 * ## What was wrong
 *
 * The 37 Bolin Street Briefing and Snapshot (27 Sep 2026) failed on every
 * attempt with "We couldn't generate the Briefing report", and the function
 * log said why only by omission: `Parent report found`, then a 404 two hundred
 * milliseconds later with nothing written. `condense-investment-report`
 * created each child WITHOUT `generated_by` — `fork-investment-report` has
 * always stamped `parent.generated_by` — so the FIRST Briefing of a Compass
 * succeeded and every regeneration after it looked up that child, asked
 * whether the caller could access a row with no owner and no client property,
 * was told no, and answered "Parent Compass report not found". The parent had
 * just been found.
 *
 * ## The rule
 *
 * A sub-report is a projection of its parent, so it belongs to whoever owns
 * the parent. A caller who may regenerate from the parent may regenerate the
 * parent's own child in place when:
 *
 *  - the child has no owner (the rows this defect wrote), or
 *  - the child's owner is the parent's owner, or
 *  - the child's owner is the caller.
 *
 * A child owned by somebody else entirely is a different adviser's document:
 * it is never overwritten, and the refusal says so rather than claiming the
 * parent is missing. Anything the caller could reach on its own (a client they
 * created) is decided by the caller's own access check, which runs as well.
 *
 * Pure: identifiers in, a decision out.
 */

export interface OwnedRow {
  generated_by?: string | null;
}

/** The owner a newly created child is stamped with — the parent's, as the fork does. */
export function ownerForNewChild(parent: OwnedRow, callerId: string | null | undefined): string | null {
  if (parent.generated_by) return parent.generated_by;
  if (callerId && callerId !== 'service_role') return callerId;
  return null;
}

/**
 * Whether an existing child of an accessible parent may be regenerated in place.
 * `callerCanAccessChild` is the caller's own access check on the child, for the
 * cases this rule does not cover (a client the caller created).
 */
export function mayRegenerateChild(
  child: OwnedRow,
  parent: OwnedRow,
  callerId: string,
  callerCanAccessChild: boolean,
): boolean {
  if (callerId === 'service_role') return true;
  if (callerCanAccessChild) return true;
  const owner = child.generated_by ?? null;
  if (!owner) return true;
  if (parent.generated_by && owner === parent.generated_by) return true;
  return owner === callerId;
}

/** The owner a regenerated child keeps: its own, or the parent's where it had none. */
export function ownerForRegeneratedChild(child: OwnedRow, parent: OwnedRow, callerId: string): string | null {
  return child.generated_by ?? ownerForNewChild(parent, callerId);
}

/** What the caller is told when another adviser's child blocks a regeneration. */
export const CHILD_OWNED_ELSEWHERE =
  'This report already has a version prepared by another adviser, so it was not replaced. Ask them to regenerate it, or generate from your own copy of the Compass.';

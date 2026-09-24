/**
 * Whether a Commercial & Industrial assessment may be permanently deleted.
 *
 * ## Why deletion is narrower than archiving
 *
 * Archiving hides an assessment and can be undone. Deleting removes the record,
 * and the database takes its calculation runs, scenarios, client-link history
 * and audit trail with it (`ON DELETE CASCADE` on all four). That is exactly
 * right for the thing people ask to delete — a draft nobody finished, a test,
 * an "Untitled assessment" created by a stray click — and exactly wrong for an
 * assessment that has left the building. So deletion is refused, with the
 * reason stated, in four situations, and archiving is offered instead:
 *
 *  - **It is linked to a client.** It is part of that client's Commercial /
 *    Industrial file, and deleting it would take it out of their record.
 *  - **It was linked to a client before.** The link history records what the
 *    assessment wrote to the client's record at the time; deleting the
 *    assessment deletes that history, and a change to a client record with no
 *    trace of where it came from is worse than a stale entry in a list.
 *  - **A report was issued from it.** The document is evidence of what a client
 *    or lender was told. The report ledger holds its renders with
 *    `ON DELETE RESTRICT` for this reason ("deleting an assessment must not
 *    silently delete the evidence that a document was issued from it"), and a
 *    document drawn through a report template is recorded in
 *    `template_render_jobs`, which has no foreign key at all — so it is checked
 *    here, where nothing else would notice it.
 *  - **A report was requested from it**, even where no document resulted. The
 *    ledger row still exists, the database still refuses, and a render row's
 *    `storage_path` is written *before* the upload — so a failed row cannot
 *    prove that no file was stored. Nothing in the report ledger is deleted to
 *    make room for a delete, ever.
 *
 * A report being generated *right now* is the fifth answer, and the only
 * temporary one: wait for it.
 *
 * ## One rule, two callers
 *
 * `manage-ci-assessments` gathers the facts and enforces this; the dialog in
 * the app renders the same verdict the server returned. The server is the
 * authority — the app never decides on its own that something may be deleted.
 */

/** One report render recorded against the assessment, from either ledger. */
export interface RenderFact {
  /** `running` | `succeeded` | `failed` (the ledgers share the vocabulary). */
  status: string;
  /** ISO timestamp the render was started. */
  createdAt: string;
  /** Which ledger recorded it. Only the direct route's rows block the database. */
  ledger: 'capacity_report' | 'template';
}

export interface DeletionFacts {
  /** The assessment's own status. */
  status: string;
  /** Set while the assessment is linked to a client. */
  clientId: string | null;
  /** Rows in the client-link history, current or since unlinked. */
  clientLinkCount: number;
  /** Every render recorded against the assessment, in either ledger. */
  renders: readonly RenderFact[];
}

export type DeletionBlock =
  | 'linked_to_client'
  | 'client_history'
  | 'report_issued'
  | 'report_in_progress'
  | 'report_requested';

export interface DeletionVerdict {
  allowed: boolean;
  block: DeletionBlock | null;
  /** One sentence, in the operator's words, saying why — or what deleting does. */
  message: string;
  /**
   * Whether archiving is the offered alternative. False while a report is in
   * flight (the answer there is "wait"), and for an assessment that is already
   * archived (it is already out of the way).
   */
  archiveOffered: boolean;
}

/**
 * A render still marked `running` after this long has died without saying so.
 *
 * Both render routes run inside an edge function whose wall clock is measured
 * in seconds, so a quarter of an hour is far past any render that could still
 * finish. An abandoned row is still a request that was made — it blocks as
 * `report_requested`, not as `report_in_progress`, so nobody is told to wait
 * for something that will never arrive.
 */
export const ABANDONED_RENDER_AFTER_MS = 15 * 60 * 1000;

function isInFlight(render: RenderFact, now: number): boolean {
  if (render.status !== 'running') return false;
  const started = Date.parse(render.createdAt);
  // An unreadable timestamp is treated as fresh: "wait" is the conservative
  // answer, and it is never wrong for longer than the row stays unreadable.
  if (!Number.isFinite(started)) return true;
  return now - started < ABANDONED_RENDER_AFTER_MS;
}

/**
 * Whether a render counts as a document having been issued.
 *
 * Only a success in the capacity-report ledger, or a success in the template
 * ledger. A template job that failed has no row in the capacity ledger and no
 * foreign key, so it neither issued anything nor blocks the database.
 */
function issuedADocument(render: RenderFact): boolean {
  return render.status === 'succeeded';
}

export function decideDeletion(facts: DeletionFacts, now: number = Date.now()): DeletionVerdict {
  const alreadyArchived = facts.status === 'archived';
  const archiveOffered = !alreadyArchived;
  const archiveHint = alreadyArchived
    ? 'It stays archived, out of your working lists.'
    : 'Archive it instead — archiving removes it from your working lists and can be undone.';

  if (facts.clientId) {
    return {
      allowed: false,
      block: 'linked_to_client',
      archiveOffered,
      message: `This assessment is linked to a client and forms part of their Commercial & Industrial file. ${archiveHint}`,
    };
  }

  if (facts.clientLinkCount > 0) {
    return {
      allowed: false,
      block: 'client_history',
      archiveOffered,
      message: 'This assessment has been linked to a client before, and its link history records what it '
        + `wrote to that client's record. Deleting it would erase that history. ${archiveHint}`,
    };
  }

  if (facts.renders.some(issuedADocument)) {
    return {
      allowed: false,
      block: 'report_issued',
      archiveOffered,
      message: 'A report has been issued from this assessment, and the assessment is kept as the record of '
        + `what that document states. ${archiveHint}`,
    };
  }

  if (facts.renders.some((render) => isInFlight(render, now))) {
    return {
      allowed: false,
      block: 'report_in_progress',
      archiveOffered: false,
      message: 'A report is being generated from this assessment right now. Wait for it to finish, then try again.',
    };
  }

  // Any render row left in the capacity-report ledger — a failure, or a render
  // that died mid-flight — still holds a foreign key the database will not let
  // go of, and cannot prove that no file was stored.
  if (facts.renders.some((render) => render.ledger === 'capacity_report')) {
    return {
      allowed: false,
      block: 'report_requested',
      archiveOffered,
      message: 'A report was requested from this assessment, and the report ledger keeps a record of every '
        + `request. ${archiveHint}`,
    };
  }

  return {
    allowed: true,
    block: null,
    archiveOffered: false,
    message: 'Deleting permanently removes this assessment with its calculation runs, scenarios and audit '
      + 'history. It has never been linked to a client and no report has been issued from it, so no client '
      + 'record, property record or document is affected.',
  };
}

/**
 * Whether a completed assessment is being deleted, which the dialog asks the
 * operator to confirm by typing its reference.
 *
 * A draft is usually a stray click and deserves a plain confirmation; a
 * completed assessment is a finished position somebody worked for, and a
 * single misplaced click should not be able to remove one.
 */
export function deletionNeedsTypedConfirmation(status: string): boolean {
  return status === 'completed' || status === 'linked';
}

/**
 * The status an assessment returns to when it is restored from the archive.
 *
 * Restoring used to set `draft` for every unlinked assessment, so archiving a
 * completed assessment and restoring it the same afternoon silently demoted it
 * — its report would no longer generate, and nothing said why. The status held
 * before archiving is now recorded on the `assessment_archived` audit event and
 * restored from there. For an assessment archived before that was recorded,
 * the status is derived from what the record can prove: a linked client means
 * `linked`, a saved calculation means `calculated` (completing it again is one
 * action), and anything else is `data_entry`.
 */
export const RESTORABLE_STATUSES: ReadonlySet<string> = new Set([
  'draft', 'data_entry', 'ready_to_calculate', 'calculated', 'requires_review', 'completed', 'linked',
]);

export function statusAfterRestore(input: {
  /** The status recorded when the assessment was archived, if one was. */
  recordedStatus: unknown;
  clientId: string | null;
  currentCalculationId: string | null;
}): string {
  const recorded = typeof input.recordedStatus === 'string' ? input.recordedStatus : null;
  if (recorded && RESTORABLE_STATUSES.has(recorded)) {
    // A recorded `linked` whose client has since gone is not linked any more,
    // and a recorded `completed` with no calculation cannot be completed.
    if (recorded === 'linked' && !input.clientId) {
      return input.currentCalculationId ? 'completed' : 'data_entry';
    }
    if (recorded === 'completed' && !input.currentCalculationId) return 'data_entry';
    return recorded;
  }
  if (input.clientId) return 'linked';
  if (input.currentCalculationId) return 'calculated';
  return 'data_entry';
}

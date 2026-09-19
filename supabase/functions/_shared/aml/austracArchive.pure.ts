/**
 * Archiving an AUSTRAC report — putting it away, never throwing it away.
 *
 * ── Why archiving is not deleting ─────────────────────────────────────
 * `delete_report` refuses anything past the draft statuses, and that is
 * correct: a report that has been approved, lodged, acknowledged, rejected or
 * withdrawn is a RETAINED RECORD. The AML/CTF Act requires a reporting entity
 * to keep its reports and the evidence behind them for seven years, so the
 * one thing this product must never offer is a button that makes a lodged
 * report disappear.
 *
 * What the register actually needed was somewhere for finished reports to go.
 * A hub that lists every report the entity has ever made, for ever, buries
 * the two that still need something — so archiving hides a row from the
 * working list and keeps every byte of it: the row, its versions, its
 * submissions, its receipts and its case events. It is reversible by anybody
 * who can write, and both directions are recorded on the customer's case
 * timeline.
 *
 * ── The rule that matters ─────────────────────────────────────────────
 * **A report may be archived only once nothing is owed to AUSTRAC.**
 *
 * An archive that can hide an approved-but-unlodged Suspicious Matter Report
 * is not a tidy-up feature, it is a way to lose a statutory deadline: the
 * report vanishes from the list, the clock keeps running, and nobody is
 * looking. So the statuses that still owe an act — draft, in review, awaiting
 * the MLRO, and approved-but-not-lodged — refuse, and say why.
 */

/** Statuses where the lodgement decision is behind the report. */
export const ARCHIVABLE_STATUSES: ReadonlySet<string> = new Set([
  "submitted", "acknowledged", "rejected", "withdrawn",
]);

/**
 * Why this report cannot be archived, or null when it can be.
 *
 * The wording names what is still owed rather than the status, because the
 * status is the schema's word and the obligation is the operator's.
 */
export function archiveBlockReason(status: string | null | undefined): string | null {
  const s = (status ?? "").trim();
  if (ARCHIVABLE_STATUSES.has(s)) return null;
  if (s === "approved") {
    return "This report is approved and has not been lodged. Archiving it would hide the one "
      + "thing still owed to AUSTRAC.";
  }
  if (s === "draft" || s === "in_review" || s === "awaiting_mlro") {
    return "This report is still being written. A draft is deleted, not archived — archiving is "
      + "for a report whose lodgement is behind it.";
  }
  return `A report with status "${s}" cannot be archived.`;
}

/**
 * What to say before archiving, when there is something worth saying.
 *
 * A lodged report with no receipt on file is archivable — AUSTRAC's
 * acknowledgement may never arrive, and waiting for one for ever is not a
 * filing system — but the operator should know it is going away without one.
 */
export function archiveWarning(args: {
  status: string | null | undefined;
  hasReceipt: boolean;
}): string | null {
  if ((args.status ?? "") === "submitted" && !args.hasReceipt) {
    return "No AUSTRAC receipt is on file for this report yet. It will still be archived, and "
      + "the receipt can be recorded after it is restored.";
  }
  return null;
}

/** True when a stored row has been archived. */
export function isArchived(row: { archived_at?: string | null } | null | undefined): boolean {
  return Boolean(row?.archived_at);
}

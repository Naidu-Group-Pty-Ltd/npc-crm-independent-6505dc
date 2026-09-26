/**
 * Whether a report row may be recorded as FAILED — one rule, asked by the
 * browser before it writes the stamp and enforced by `manage-investment-reports`
 * when it is asked to.
 *
 * ## Why this exists
 *
 * On 24 Sep 2026 the regeneration of 60 Lawley Street, Spalding finished. The
 * generator banked 16 of 16 sections, ran finalisation and wrote
 * `status: 'completed'` at 05:31:01.6Z. Three seconds later the Supabase edge
 * runtime answered four requests with HTTP 503
 * `SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED` in six to eighty-one milliseconds —
 * no worker ever saw them — and two of those four were this browser's:
 *
 *   05:31:05.2  OPTIONS condense-investment-report   503  (a soft step; skipped)
 *   05:31:07.1  POST    get-investment-reports       503  (the final status check)
 *   05:31:08.2  manage-investment-reports  update  → status: 'failed'
 *   05:31:27.0  "token release for failed report" — 16 jobs, 316 tokens
 *
 * The final status check discarded its `error` and read
 * `Number(undefined) >= 16` — `NaN`, so false — as "the record holds 0 of 16
 * sections". The catch then asked the row again, and a row that cannot be read
 * was, by the one rule the catch has, stamped failed. A finished document was
 * recorded as a failure and refunded as one, and the progress widget said
 * `Failed · 16/16 sections · 100%` for ever after, because nothing resumes a
 * report whose sections are all banked.
 *
 * Nothing about the document was uncertain. The generator's own answer to this
 * very run had said `isComplete: true`, and the row, had anybody been able to
 * read it, said `completed`. Two things were missing, and this module is both.
 *
 *  1. **A read that FAILED is not a row that is ABSENT** — the rule this
 *     repository has already paid for twice (the AML case read, the builder
 *     portal's stock-list count). The browser must tell "the server said this
 *     report is incomplete" apart from "the server could not be asked", and
 *     where the generator itself reported the document complete, an
 *     unreadable row is not a reason to overrule it.
 *  2. **The server decides from the row it can read.** The browser can only
 *     guess at a row it failed to read; `manage-investment-reports` can read
 *     it, so it refuses a failure stamp over a document that is already
 *     complete. That guard ships with the edge functions, so it protects every
 *     browser, including one running a build from before this rule existed.
 *
 * A complete row is one the server calls `completed`, or one whose banked
 * sections meet the total the server itself stated — the same reading
 * `shouldMarkRunFailed` has applied since 20 Sep, now in one place because the
 * server enforces it too and two copies of a rule is how they come to
 * disagree.
 *
 * What this never does: it never stops a stamp on a row that is genuinely
 * short of its sections — a Stop pressed mid-run, a section that failed twice,
 * a run whose counter was rewound — and it never marks anything complete. It
 * only refuses to record, as a failure, a document that the record itself
 * shows was finished.
 */

/** The three columns the rule reads. Anything else on the row is ignored. */
export interface ReportRunRow {
  status?: string | null;
  last_completed_section?: number | null;
  total_sections?: number | null;
}

/**
 * The row holds a finished document: the server calls it `completed`, or every
 * section of the total the server itself stated is banked.
 *
 * A total of zero or none is not a statement, so a row that has not yet stated
 * its section plan is never complete by count — only by status.
 */
export function rowHoldsCompleteDocument(row: ReportRunRow | null | undefined): boolean {
  if (!row) return false;
  if (String(row.status ?? '').trim().toLowerCase() === 'completed') return true;
  const total = Number(row.total_sections) || 0;
  const done = Number(row.last_completed_section) || 0;
  return total > 0 && done >= total;
}

/** Why the server refused to record a failure. */
export type FailureStampRefusal = {
  code: 'report_complete';
  /** Said to whoever asked, in words: the reason, and that nothing was changed. */
  message: string;
};

/**
 * The server's answer to "record this report as failed", decided from the row
 * it just read. `null` means the stamp may be written.
 */
export function refuseFailureStamp(row: ReportRunRow | null | undefined): FailureStampRefusal | null {
  if (!rowHoldsCompleteDocument(row)) return null;
  const total = Number(row?.total_sections) || 0;
  const done = Number(row?.last_completed_section) || 0;
  const held = total > 0 && done >= total
    ? `all ${total} of its sections are saved`
    : 'it is recorded as completed';
  return {
    code: 'report_complete',
    message: `This report is complete — ${held} — so it was not marked as failed. Nothing was changed.`,
  };
}

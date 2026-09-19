/**
 * A report that asserts a governed fact it does not hold is not a client
 * document, whichever presentation it would have come out in.
 *
 * ## Why this exists in the browser
 *
 * The check is `governedAuthorityBlockFromFlags`, and it was applied in two
 * Edge Functions: `render-template-pdf` (the template route) and
 * `render-investment-report-pdf` (the standard route). Both were render
 * services, and both are off the Investment path now — the presentation
 * renderer runs in this tab. A gate that lived inside a service that no longer
 * renders is a gate on nothing, so it moves to where the document is produced.
 *
 * It is the SAME function, imported rather than re-implemented, so the browser
 * and the client portal (`get-portal-client-data`, which still applies it)
 * cannot come to different conclusions about the same row.
 *
 * ## It is stronger here than it was there
 *
 * It now runs BEFORE either presentation is chosen, so the standard document
 * is refused on the same terms as a templated one. Previously the browser's
 * own standard generator had no gate at all: a blocked report drew a PDF and
 * saved it.
 *
 * ## Failing open, deliberately
 *
 * Only an explicit blocking flag blocks. Absent flags, an empty array, a row
 * that carries none: all render, because 1,190 stored reports predate this and
 * withholding a document over a missing field is the worse failure. The read
 * itself is the caller's; a read that FAILED throws there and never reaches
 * this, which is the distinction `aml.cases` and the fifty-eight-column sweep
 * were about.
 */
import {
  governedAuthorityBlockFromFlags,
} from '../../../../supabase/functions/_shared/reports/contract/governedNarrativeAuthority.pure';

/**
 * Thrown instead of producing a document. The message is what the operator
 * reads, and it names no column, no flag type and no renderer.
 */
export class ReportNotClientReadyError extends Error {
  readonly categories: string[];

  constructor(categories: string[]) {
    super(
      'This report states a figure for a category its own record shows as unavailable, so it '
      + 'cannot be issued as a client document. It is kept with its validation evidence — remove '
      + 'the claim, or regenerate once the underlying data is available.',
    );
    this.name = 'ReportNotClientReadyError';
    this.categories = categories;
  }
}

/** Throws when the row carries a blocking governed-authority flag. */
export function assertInvestmentReportClientReady(row: unknown): void {
  const flags = (row as { validation_flags?: unknown } | null | undefined)?.validation_flags;
  const block = governedAuthorityBlockFromFlags(flags);
  if (block.blocked) throw new ReportNotClientReadyError(block.categories);
}

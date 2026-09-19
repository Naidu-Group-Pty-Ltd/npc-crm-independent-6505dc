/**
 * Two badges on one row must not say the same word.
 *
 * ## The defect this exists for
 *
 * The agreements ledger draws the agreement's own lifecycle status and, beside
 * it, the DocuSign envelope status. They are genuinely different facts — what
 * our record says, and what the envelope says — but they share a vocabulary
 * (`sent`, `delivered`, `viewed`, `signed`, `completed`, `declined`,
 * `voided`), and once an agreement is sent the two almost always agree. So the
 * row rendered
 *
 *     [✈ SENT] [✉ SENT]
 *
 * and the audit reported it as "it shows sent twice in the status". A reader
 * cannot tell that two identical words are two different sources; they read it
 * as a rendering fault, and it costs the second badge whatever meaning it had.
 *
 * ## The rule
 *
 * The envelope badge earns its place only when it says something the
 * agreement badge does not. Comparison is on the LABELS — what a reader
 * actually sees — rather than on the status codes, because two different codes
 * that render the same word are the defect, and two identical codes that
 * render differently are not.
 *
 * Subsumption counts: an agreement reading "Generated · Ready" already
 * contains the envelope's "Generated", so the envelope adds nothing there
 * either.
 *
 * What this deliberately does NOT do is merge words that differ. An agreement
 * marked "Signed" beside an envelope marked "Completed" keeps both, because
 * that is two facts and one of them may be the one you need.
 */

/** Words of a label, lowercased, with separators and punctuation dropped. */
function words(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[·•|—–-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Does the envelope badge repeat what the agreement badge already says?
 *
 * `true` means: do not draw it. An absent or blank envelope label is
 * redundant by definition — there is nothing to draw.
 */
export function envelopeBadgeIsRedundant(
  agreementLabel: string | null | undefined,
  envelopeLabel: string | null | undefined,
): boolean {
  const envelope = words(envelopeLabel ?? '');
  if (envelope.length === 0) return true;

  const agreement = new Set(words(agreementLabel ?? ''));
  if (agreement.size === 0) return false;

  // Every word the envelope would show is already on the row.
  return envelope.every((word) => agreement.has(word));
}

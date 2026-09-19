/**
 * The platform's position on partner agreements, in one place.
 *
 * ## What changed and why
 *
 * This product used to run the whole agreement lifecycle between two
 * independent businesses: a Command Centre user drafted a referral/commission
 * agreement, issued it into the partner's portal, the partner accepted it,
 * requested changes, and executed it with a typed signature; the platform
 * recorded every step, froze versions, stored the executed master and notified
 * both sides.
 *
 * That has been retired. Facilitating, recording and stepping through the
 * formation of a contract between two other parties made the platform look like
 * a participant in — and arguably a party to, or a service provider warranting
 * — a commercial relationship it has no part in. The agreements involved are
 * real instruments under Australian credit law (licence and credit
 * representative numbers, aggregator terms, AML/CTF obligations), and the
 * platform is not in a position to stand behind any of it.
 *
 * ## What replaces it
 *
 * The two templates remain, as **optional resources** either party may take
 * away, review, amend and use — or ignore entirely. Nothing is issued, nothing
 * is accepted, nothing is executed, nothing is tracked, and nothing is stored
 * about whether two parties reached an agreement.
 *
 * The single rule this module exists to hold: **downloading a template is the
 * end of the platform's involvement.** Any surface that offers one must say so
 * in the same words, and the words must be as true of the Finance Portal as of
 * the Command Centre — both sides are downloading the same neutral document on
 * the same terms.
 */

/** The one-line description of what these are, above any list of templates. */
export const TEMPLATE_RESOURCE_INTRO =
  'Optional templates you are free to download, adapt and use — or not. '
  + 'Any agreement is made directly between you and the other party.';

/**
 * The standing position, shown wherever a template can be downloaded.
 *
 * Deliberately about what the platform does NOT do. A disclaimer that only says
 * "seek legal advice" still leaves the reader assuming the platform is running
 * something; these four sentences say plainly that it is not.
 */
export const TEMPLATE_NEUTRALITY_NOTICE: readonly string[] = [
  'These templates are provided as a convenience only. They are not legal advice, '
  + 'and they are not tailored to your circumstances.',
  'Any agreement you enter into is solely between you and the other party. '
  + 'Aurixa is not a party to it, does not facilitate it, and keeps no record of it.',
  'You are responsible for having the document reviewed, for your own licensing, '
  + 'credit representative, privacy, aggregator and AML/CTF obligations, and for '
  + 'how the agreement is signed and stored.',
  'Whether to use a template at all is entirely your choice.',
];

/** The short form, for a document footer or a compact card. */
export const TEMPLATE_NEUTRALITY_SHORT =
  'Template only. Not legal advice. Any agreement is between you and the other '
  + 'party — Aurixa is not a party to it and keeps no record of it. Obtain your '
  + 'own legal, licensing, privacy and aggregator advice before use.';

/**
 * ## Removed: `WORKFLOW_RETIRED_NOTICE`
 *
 * The template desk used to open with a line explaining that issuing and
 * executing agreements had been retired — written for whoever followed an old
 * bookmark to the register.
 *
 * It is gone at the product owner's direction. The reasoning it served has an
 * expiry: an explanation of what a page *used to be* is useful in the weeks
 * after a change and is dead weight afterwards, and by then it is the first
 * thing every routine visitor reads before the thing they came for. The page
 * still explains itself — its title, and `TEMPLATE_RESOURCE_INTRO` above the
 * cards — and the retired routes still redirect here rather than 404.
 *
 * Recorded rather than deleted silently so nobody re-adds it as a fix for a
 * problem that was considered and closed.
 */

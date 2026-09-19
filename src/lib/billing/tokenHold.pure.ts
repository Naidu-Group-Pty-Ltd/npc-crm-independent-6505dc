/**
 * Telling somebody what a report actually cost them.
 *
 * ## The defect this exists for
 *
 * A report generation failed and the token balance went 200 → 180 and later
 * back to 200. Reported in the 19 Sep 2026 clone audit as tokens deducted for
 * a run that failed.
 *
 * Nothing was deducted. `reportMetering.ts` states the invariant at the top of
 * the file — "a report that does not finish successfully must cost the caller
 * nothing" — takes a RESERVATION before the run, HOLDS it across every chunk,
 * and releases or refunds it on any failure. What the operator saw was the
 * hold, which Mission Control subtracts from `available` exactly as it should,
 * followed by the release.
 *
 * So the machinery was right and the product said nothing:
 *
 *  - `TokenBalance.reserved` is populated on every read and the balance pill
 *    deliberately stopped rendering it, on the ground that a second number
 *    moving beside the first "made the balance look like it moved twice". True,
 *    and it left a hold indistinguishable from a charge.
 *  - `manage-investment-reports` returns `tokenRelease`
 *    (`{ jobsReleased, tokensReleased, failures }`) on every failure write, and
 *    **nothing in the frontend read it** — the same "recorded and read by
 *    nothing" shape as the scraper's `scrapedFromPage`.
 *
 * ## The rules
 *
 * **A hold is stated as a hold, in words, and only while there is one.** Not a
 * second figure competing with the balance — the reason it was removed stands.
 *
 * **A release is reported as "not charged", never as a refund.** A refund says
 * money moved twice; these tokens were never spent, and the difference is what
 * the operator is actually asking about.
 *
 * **A release that did not fully succeed says so.** `failures > 0` means some
 * job could not be released, and claiming the run was free would be a promise
 * this module cannot keep.
 *
 * Pure + deterministic: no DOM, no network, no clocks.
 */

export interface TokenReleaseSummary {
  jobsReleased?: number;
  tokensReleased?: number;
  failures?: number;
}

const formatTokens = (n: number): string => n.toLocaleString('en-AU');

/**
 * What to tell somebody whose report just failed, or null where there is
 * nothing to say.
 */
export function describeTokenRelease(release: unknown): string | null {
  const summary = (release ?? null) as TokenReleaseSummary | null;
  if (!summary || typeof summary !== 'object') return null;

  const failures = Number(summary.failures ?? 0);
  const jobs = Number(summary.jobsReleased ?? 0);
  const tokens = Number(summary.tokensReleased ?? 0);

  if (failures > 0) {
    // Never promise what could not be confirmed.
    return 'Some of the tokens held for this run could not be released automatically. '
      + 'Check your balance, and contact support if it has not returned.';
  }
  if (jobs <= 0) return null;
  if (tokens > 0) {
    return `You were not charged for this run — ${formatTokens(tokens)} `
      + `token${tokens === 1 ? '' : 's'} held for it have been released.`;
  }
  return 'You were not charged for this run.';
}

/**
 * The billing policy, for a failure this surface did not itself report.
 *
 * Distinct from `describeTokenRelease`, and deliberately so: that one states
 * what a specific release actually did, this one states the rule
 * `reportMetering.ts` enforces. Saying "20 tokens were released" without the
 * summary that says so would be a promise nothing here can keep; saying what
 * the product's rule is, is not.
 */
export const UNFINISHED_REPORT_IS_FREE =
  'A report that does not finish is not charged. Any tokens held for it are released.';

/**
 * The one line the balance surface adds while a hold is outstanding.
 *
 * `available` already has the hold subtracted, which is what makes a balance
 * look like it dropped; this says why, without putting a second moving number
 * beside it.
 */
export function describeTokenHold(reserved: unknown): string | null {
  const held = Number(reserved ?? 0);
  if (!Number.isFinite(held) || held <= 0) return null;
  return `${formatTokens(held)} held for a report in progress. A hold is not a charge — `
    + 'it is released if the report does not finish.';
}

/**
 * Turning a provider result into the canonical `aml.verification_checks`
 * columns.
 *
 * ## Why this is shared
 *
 * Two things write an outcome onto the same canonical row: the outbox worker
 * (`verificationConsumer`) and the staff re-run in `aml-verification`. They had
 * drifted apart, and every difference favoured the customer badly:
 *
 *  - the staff path decided `exhausted` from `attempt_number`, which is a
 *    capture sequence — so three unusable captures followed by one genuine
 *    failure exhausted a client who had used one attempt;
 *  - the staff path never set `attempt_consumed`, so an outcome it recorded
 *    was invisible to the portal's accounting;
 *  - it never set `processing_status`, leaving a completed check looking like
 *    one still in flight and blocking resubmission;
 *  - it detected an unusable capture from the face verdict alone, missing the
 *    quality signal the adapter reports from liveness.
 *
 * One function, so the two agree by construction rather than by review.
 */

export type CanonicalStatus = 'pending' | 'passed' | 'failed' | 'referred' | 'exhausted';

/** Provider outcome → identity status. Anything unrecognised goes to a human. */
export const OUTCOME_TO_STATUS: Record<string, CanonicalStatus> = {
  verified: 'passed',
  failed: 'failed',
  manual_review: 'referred',
};

export interface ProviderOutcomeLike {
  status: string;
  raw?: Record<string, unknown> | null;
}

export interface CanonicalOutcome {
  /** Leave `status` untouched when null — an unusable capture is not a result. */
  status: CanonicalStatus | null;
  processingStatus: 'completed' | 'capture_unusable';
  attemptConsumed: boolean;
  providerErrorCategory: string | null;
}

/**
 * The provider looked but could not examine identity.
 *
 * `pending`/`in_progress` is how the adapter reports both an unusable face
 * capture and a selfie too poor for the liveness heuristic to run. Neither is
 * an identity outcome and neither may consume an attempt.
 */
export function isUnusableCapture(result: ProviderOutcomeLike): boolean {
  if (result.status === 'pending' || result.status === 'in_progress') return true;
  const face = (result.raw ?? {})['face'] as { verdict?: string } | null | undefined;
  return face?.verdict === 'unusable';
}

export function canonicalOutcome(
  result: ProviderOutcomeLike,
  opts: { attemptsConsumed: number; maxAttempts: number },
): CanonicalOutcome {
  if (isUnusableCapture(result)) {
    return {
      status: null,
      processingStatus: 'capture_unusable',
      attemptConsumed: false,
      providerErrorCategory: 'capture_unusable',
    };
  }

  const status = OUTCOME_TO_STATUS[result.status] ?? 'referred';

  // Only a genuine failure that uses the last attempt exhausts the client.
  // Counted from attempts actually consumed — never from the row number.
  const consumedAfterThis = opts.attemptsConsumed + 1;
  const finalStatus: CanonicalStatus =
    status === 'failed' && consumedAfterThis >= opts.maxAttempts ? 'exhausted' : status;

  return {
    status: finalStatus,
    processingStatus: 'completed',
    attemptConsumed: true,
    providerErrorCategory: null,
  };
}

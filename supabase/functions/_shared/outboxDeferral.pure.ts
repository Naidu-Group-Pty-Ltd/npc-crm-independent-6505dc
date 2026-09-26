/**
 * What the cross-portal worker does with a job that did not complete.
 *
 * An ordinary failure keeps the outbox's backoff (2^attempts seconds, capped
 * at an hour) and is terminal at the tenth attempt, when it is dead-lettered.
 *
 * A DEFERRAL is not a failure. It says the work is held by something that
 * will end at a known time — the acknowledgement email's lease, held by a
 * worker that died mid-send — and asks to be offered again then. Every claim
 * of an outbox event consumes an attempt, and the outbox's own lock lease is
 * shorter than the email's, so a deferral counted as a failure could reach the
 * tenth attempt while the lease still stood and dead-letter an email that was
 * never sent. So a deferral is never terminal, and it waits until the time it
 * names (never less than a minute, so a time already past cannot spin).
 *
 * Every claim also counts an attempt, and a claim that found the lease held
 * made no delivery attempt, so a deferral gives that count back (`attempts`
 * is the count to store). Otherwise a worker that died mid-send would leave
 * the email with fewer than ten real attempts before it is dead-lettered.
 */
export class OutboxDeferral extends Error {
  constructor(message: string, readonly retryAt: string) {
    super(message);
    this.name = 'OutboxDeferral';
  }
}

export const OUTBOX_TERMINAL_ATTEMPTS = 10;
const MIN_DEFERRAL_MS = 60_000;

export function outboxFailureDisposition(
  error: unknown, attempts: number, now: number,
): { terminal: boolean; availableAt: string; deferred: boolean; attempts: number } {
  if (error instanceof OutboxDeferral) {
    const until = Date.parse(error.retryAt);
    const at = Number.isFinite(until) ? Math.max(until, now + MIN_DEFERRAL_MS) : now + MIN_DEFERRAL_MS;
    return { terminal: false, availableAt: new Date(at).toISOString(), deferred: true, attempts: Math.max(0, attempts - 1) };
  }
  return {
    terminal: attempts >= OUTBOX_TERMINAL_ATTEMPTS,
    availableAt: new Date(now + Math.min(3600, 2 ** attempts) * 1000).toISOString(),
    deferred: false,
    attempts,
  };
}

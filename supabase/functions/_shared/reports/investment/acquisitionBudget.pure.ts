/**
 * Deadlines for the acquisition phase, and what a bounded call is allowed to
 * conclude.
 *
 * ## Why this exists
 *
 * The generator's acquisition block issues eight service calls with plain
 * `fetch` and no `AbortSignal` of any kind. Their combined duration is
 * therefore unbounded, while the run they sit inside is not: `runStartedAt` is
 * taken before acquisition, the platform kills the invocation at ~150s, and a
 * section model call is refused below `SECTION_MIN_CALL_WINDOW_MS`. So one slow
 * provider can consume the entire invocation and the first section is deferred
 * having never been attempted — measured on the 18 Annabelle Crescent run of
 * 19 Sep 2026 as `Section 1 of 15 · 0/15 · 21m` across repeated attempts.
 *
 * The fix is not a shorter constant. It is that **acquisition answers to the
 * run's own clock**: every call is given the window that actually remains after
 * reserving enough for the section loop to start and for a checkpoint to be
 * written, and a call with no window left is not started at all.
 *
 * ## The rule that matters most
 *
 * **A timeout is not evidence of absence.** A register that did not answer in
 * time has told us nothing about the property; a register that answered and
 * held nothing has told us something real. Collapsing the two is how "no flood
 * overlay was returned in 4s" becomes "this property has no flood overlay" in a
 * client's document. `AcquisitionOutcome` keeps them apart by construction, and
 * the acquisition ledger already has distinct vocabulary for each
 * (`empty` vs `failed`) — this module's job is to hand it the right one.
 */

/** What a bounded acquisition call concluded. Never collapse these. */
export type AcquisitionOutcome =
  /** The provider answered in time. `data` may still be legitimately empty. */
  | { kind: 'answered'; elapsedMs: number }
  /** Our deadline fired. We learned nothing about the subject. */
  | { kind: 'timeout'; elapsedMs: number; budgetMs: number }
  /** The provider answered, and said no. */
  | { kind: 'http_error'; elapsedMs: number; status: number }
  /** The request never completed: DNS, TLS, reset, abort from elsewhere. */
  | { kind: 'transport_error'; elapsedMs: number; message: string }
  /** No window remained; the call was never made. Not a failure of the provider. */
  | { kind: 'not_attempted'; reason: 'no_window' };

/**
 * Whether this outcome permits a statement about the subject.
 *
 * Only `answered` does. Everything else is a fact about this invocation, and a
 * report that says "no X applies" on the strength of one of them is asserting
 * something nobody measured.
 */
export function describesSubject(outcome: AcquisitionOutcome): boolean {
  return outcome.kind === 'answered';
}

/**
 * Whether a later invocation should try this dependency again.
 *
 * Everything that is not an answer is worth retrying, because none of them is
 * a statement about the subject. This is what stops a transient failure being
 * frozen into the record as a permanent absence.
 */
export function shouldRetryLater(outcome: AcquisitionOutcome): boolean {
  return outcome.kind !== 'answered';
}

export interface AcquisitionBudgetInput {
  /** `Date.now()` at the top of the invocation — the same clock the sections use. */
  runStartedAt: number;
  /** Now. Passed in so this module stays pure and testable. */
  now: number;
  /**
   * The last instant a model call may still be in flight, from the run's start.
   * The generator's `SECTION_CALL_HARD_STOP_MS`.
   */
  hardStopMs: number;
  /**
   * Held back for the section loop: enough for one model call to be worth
   * starting. The generator's `SECTION_MIN_CALL_WINDOW_MS`.
   */
  sectionReserveMs: number;
  /**
   * Held back so the acquisition checkpoint can be written even when the phase
   * runs long. A checkpoint that cannot be persisted is work done twice.
   */
  checkpointReserveMs: number;
  /** This call's own ceiling, however much room there is. */
  perCallCeilingMs: number;
  /** Below this a call is not worth starting at all. */
  minCallMs: number;
}

/**
 * The window this acquisition call may have, or null when it may not run.
 *
 * Returning null is a real answer and the caller must record it as
 * `not_attempted` rather than as a provider failure — we never asked.
 */
export function acquisitionWindowMs(input: AcquisitionBudgetInput): number | null {
  const {
    runStartedAt, now, hardStopMs,
    sectionReserveMs, checkpointReserveMs, perCallCeilingMs, minCallMs,
  } = input;

  const elapsed = now - runStartedAt;
  const remainingToHardStop = hardStopMs - elapsed;
  const spendable = remainingToHardStop - sectionReserveMs - checkpointReserveMs;

  if (spendable < minCallMs) return null;
  return Math.min(perCallCeilingMs, spendable);
}

/**
 * Whether the acquisition phase should stop issuing calls entirely.
 *
 * Distinct from "this one call has no window": once we are inside the reserve,
 * the phase hands over so the checkpoint can be written and the section loop
 * can still start. Everything not yet acquired stays outstanding and is
 * retried on the next invocation — it is not recorded as absent.
 */
export function acquisitionExhausted(
  input: Omit<AcquisitionBudgetInput, 'perCallCeilingMs'>,
): boolean {
  return acquisitionWindowMs({ ...input, perCallCeilingMs: Number.POSITIVE_INFINITY }) === null;
}

/**
 * Default ceilings per dependency class, in milliseconds.
 *
 * These are ceilings, never guarantees: the run's own clock always wins, so a
 * generous ceiling here cannot overrun the invocation. They are set from what
 * each class is observed to need, with the slower open registers given more
 * room than a local table read.
 */
export const CALL_CEILING_MS = {
  /** A local Postgres-backed service in the same project. */
  local: 8_000,
  /** A commercial API with an SLA. */
  vendor: 12_000,
  /** An open government register: slower, and worth waiting a little longer for. */
  register: 20_000,
  /** A scrape or an archive mirror: slowest, and the least reliable. */
  archive: 25_000,
} as const;

export type CallClass = keyof typeof CALL_CEILING_MS;

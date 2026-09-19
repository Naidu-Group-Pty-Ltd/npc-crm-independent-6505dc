/**
 * What the dispatcher decides, separated from how it talks to Postgres.
 *
 * Draining a queue has three judgement calls in it, and all three are the kind
 * that are wrong in production for months if they are only ever exercised
 * through a live run:
 *
 *   1. which live workflows an event should start (delegated to `matchTrigger`,
 *      which already states the rule once for both capture and dispatch);
 *   2. what a claimed event becomes afterwards — processed, retryable, or given
 *      up on;
 *   3. when to stop taking work, so a batch fits inside the Edge Function's
 *      wall-clock ceiling instead of being killed halfway through a workflow
 *      and leaving the event claimed.
 *
 * All three live here, pure, and are tested directly.
 */

import { matchTrigger, type MatchCandidate, type TriggerEvent, type TriggerMatch } from './triggerMatch.pure.ts';

/**
 * Attempts before an event is given up on.
 *
 * Retrying is worth doing — most dispatch failures are a vendor being briefly
 * unreachable — but retrying for ever turns one permanently broken workflow
 * into an endless source of side effects. Five spreads over ~5 minutes at the
 * dispatcher's one-minute cadence, which clears a transient outage and stops
 * well short of a loop.
 */
export const MAX_ATTEMPTS = 5;

/**
 * How long a batch may spend before it stops claiming more work.
 *
 * Supabase Edge Functions are killed at around 150 seconds. A workflow's steps
 * can each take seconds, so the budget is what a *batch* may spend, checked
 * between events rather than mid-workflow: the aim is to never begin an event
 * that cannot finish, because an event killed mid-flight stays `claimed` and
 * waits for the stale reaper while its side effects have already happened.
 */
export const BATCH_BUDGET_MS = 90_000;

/** Longest a single event's workflows may take before the batch stops early. */
export const EVENT_BUDGET_MS = 45_000;

export interface ClaimedEvent {
  id: string;
  triggerType: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface WorkflowRunOutcome {
  workflowId: string;
  /** The engine's own verdict for the run. */
  status: 'succeeded' | 'failed' | 'halted';
  /** Set when the run could not be recorded or the engine threw outright. */
  error?: string;
}

export type EventStatus = 'processed' | 'pending' | 'failed';

export interface EventResolution {
  status: EventStatus;
  lastError: string | null;
  /** Only a terminal resolution stamps a processing time. */
  processed: boolean;
}

/**
 * Which live workflows this event starts.
 *
 * A thin wrapper over `matchTrigger` so the dispatcher never reaches for the
 * matching rule directly — one caller, one rule, and the wrapper is where the
 * "no live workflows at all" case is stated rather than inferred from an empty
 * array three layers up.
 */
export function planDispatch(event: TriggerEvent, candidates: MatchCandidate[]): TriggerMatch[] {
  return matchTrigger(event, candidates);
}

/**
 * What becomes of an event once its workflows have been attempted.
 *
 * A run that the *engine* reports as failed is not a dispatch failure: the
 * workflow ran, and its steps recorded why they failed, which is exactly what
 * the run history is for. Re-dispatching it would repeat every side effect the
 * successful steps already had. So only a failure to dispatch at all — the
 * engine throwing, or the run not being recordable — is retried.
 */
export function resolveEvent(
  outcomes: WorkflowRunOutcome[],
  attempts: number,
  matched: number,
): EventResolution {
  // Nothing was listening. That is a normal outcome, not a failure to retry:
  // most events happen while no workflow is live for them.
  if (matched === 0) {
    return { status: 'processed', lastError: null, processed: true };
  }

  const undispatched = outcomes.filter((o) => o.error);
  if (undispatched.length === 0) {
    return { status: 'processed', lastError: null, processed: true };
  }

  const detail = undispatched
    .map((o) => `${o.workflowId}: ${o.error}`)
    .join('; ')
    .slice(0, 2000);

  /**
   * A retry re-dispatches the event, which means re-running EVERY workflow it
   * matches — there is no per-workflow state on an event to retry only the one
   * that failed. So when some workflows already ran, retrying would send their
   * messages a second time, and duplicated client-facing side effects are worse
   * than a run that did not happen and said so: the failure is recorded on the
   * event, shown in red in the run panel, and can be started by hand from the
   * canvas. Retrying is therefore reserved for the case where re-running is
   * free because nothing ran — which is also the common case, since most events
   * match exactly one workflow.
   */
  const someRan = outcomes.some((o) => !o.error);
  if (someRan) {
    return {
      status: 'processed',
      lastError:
        `${outcomes.length - undispatched.length} of ${outcomes.length} workflows ran, so this `
        + `event was not retried — a retry would run them again. Did not run — ${detail}`,
      processed: true,
    };
  }

  if (attempts >= MAX_ATTEMPTS) {
    return {
      status: 'failed',
      lastError: `Gave up after ${attempts} attempts. ${detail}`,
      processed: true,
    };
  }

  // Nothing ran, so the whole event can safely go round again.
  return { status: 'pending', lastError: detail, processed: false };
}

/**
 * Whether the batch has room to begin another event.
 *
 * Deliberately conservative: it asks whether a *worst-case* event still fits,
 * not whether any time remains at all. Beginning an event with four seconds
 * left is how a workflow gets killed between its third and fourth step.
 */
export function hasRoomForAnotherEvent(elapsedMs: number, budgetMs = BATCH_BUDGET_MS): boolean {
  return elapsedMs + EVENT_BUDGET_MS <= budgetMs;
}

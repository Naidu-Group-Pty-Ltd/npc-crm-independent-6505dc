/**
 * The dispatcher's judgement calls.
 *
 * These decide what happens to a captured event with nobody watching: whether
 * it is retried, given up on, or left for the next tick. Getting them wrong is
 * quiet — a workflow that re-sends the same email every minute for ever, or an
 * event that is dropped the first time a vendor blinks — so they are stated as
 * pure functions in `_shared/workflow/dispatch.pure.ts` and asserted here
 * rather than being inferred from a production run.
 */

import { describe, expect, it } from 'vitest';
import {
  BATCH_BUDGET_MS,
  EVENT_BUDGET_MS,
  MAX_ATTEMPTS,
  hasRoomForAnotherEvent,
  planDispatch,
  resolveEvent,
  type WorkflowRunOutcome,
} from '../../../../supabase/functions/_shared/workflow/dispatch.pure';
import { LIVE_CAPABLE } from '../runtime/performers';
import {
  CLIENT_ONLY_STEP_TYPES,
  DESCRIBED_STEP_TYPES,
  SERVER_CAPABLE_STEP_TYPES,
} from '../liveCapability';
import type { MatchCandidate } from '../runtime/triggerMatch';

const clientAdded = (config: Record<string, unknown> = {}): MatchCandidate['graph'] => ({
  nodes: [
    { id: 'trigger', type: 'platform.client_created', position: { x: 0, y: 0 }, config },
    { id: 'step_1', type: 'core.notify_team', position: { x: 300, y: 0 }, config: {} },
  ],
  edges: [{ id: 'e1', source: 'trigger', target: 'step_1' }],
});

describe('which workflows an event starts', () => {
  const event = { triggerType: 'platform.client_created', payload: { stage: 'new', clientId: 'c1' } };

  it('starts a live workflow whose trigger accepts the event', () => {
    const matches = planDispatch(event, [
      { workflowId: 'w1', status: 'live', graph: clientAdded() },
    ]);
    expect(matches).toEqual([{ workflowId: 'w1', nodeId: 'trigger' }]);
  });

  it('leaves draft and paused workflows alone', () => {
    const matches = planDispatch(event, [
      { workflowId: 'w1', status: 'draft', graph: clientAdded() },
      { workflowId: 'w2', status: 'paused', graph: clientAdded() },
    ]);
    expect(matches).toEqual([]);
  });

  it('honours a filter on the trigger', () => {
    const matches = planDispatch(event, [
      { workflowId: 'w1', status: 'live', graph: clientAdded({ stage: 'settled' }) },
    ]);
    expect(matches).toEqual([]);
  });
});

describe('what becomes of a claimed event', () => {
  const ok: WorkflowRunOutcome = { workflowId: 'w1', status: 'succeeded' };
  const undispatchable: WorkflowRunOutcome = { workflowId: 'w1', status: 'failed', error: 'boom' };

  it('processes an event no live workflow listens for', () => {
    expect(resolveEvent([], 1, 0)).toMatchObject({ status: 'processed', processed: true });
  });

  /**
   * The distinction the whole retry policy rests on. A run the engine reports
   * as failed *ran*: its steps are in the history saying why. Re-dispatching it
   * would repeat every side effect the steps before the failure already had.
   */
  it('does not retry a workflow that ran and failed', () => {
    const ranAndFailed: WorkflowRunOutcome = { workflowId: 'w1', status: 'failed' };
    expect(resolveEvent([ranAndFailed], 1, 1)).toMatchObject({ status: 'processed' });
  });

  it('retries when the workflow could not be dispatched at all', () => {
    const resolution = resolveEvent([undispatchable], 1, 1);
    expect(resolution.status).toBe('pending');
    expect(resolution.processed).toBe(false);
    expect(resolution.lastError).toContain('boom');
  });

  it('gives up once the attempts are spent', () => {
    const resolution = resolveEvent([undispatchable], MAX_ATTEMPTS, 1);
    expect(resolution.status).toBe('failed');
    expect(resolution.processed).toBe(true);
    expect(resolution.lastError).toContain(`${MAX_ATTEMPTS} attempts`);
  });

  it('processes an event whose every workflow dispatched', () => {
    expect(resolveEvent([ok, ok], 1, 2)).toMatchObject({ status: 'processed' });
  });

  /**
   * A retry re-dispatches the whole event, so it re-runs every workflow it
   * matched. When one already ran, that means sending its message twice — worse
   * than the one that failed simply not running, which is recorded and can be
   * started by hand. Retrying is only safe when nothing ran.
   */
  it('does not retry when some workflows already ran', () => {
    const resolution = resolveEvent([ok, undispatchable], 1, 2);
    expect(resolution.status).toBe('processed');
    expect(resolution.lastError).toContain('1 of 2 workflows ran');
    expect(resolution.lastError).toContain('boom');
  });

  it('still retries when nothing ran, however many matched', () => {
    expect(resolveEvent([undispatchable, undispatchable], 1, 2)).toMatchObject({ status: 'pending' });
  });
});

describe('the batch wall-clock budget', () => {
  it('takes more work while a whole event still fits', () => {
    expect(hasRoomForAnotherEvent(0)).toBe(true);
    expect(hasRoomForAnotherEvent(BATCH_BUDGET_MS - EVENT_BUDGET_MS)).toBe(true);
  });

  /**
   * The point of the budget: not "is there time left" but "is there time for a
   * whole event". Starting one with seconds to spare is how a workflow gets
   * killed between two steps with its earlier side effects already committed.
   */
  it('stops before an event that could be cut in half', () => {
    expect(hasRoomForAnotherEvent(BATCH_BUDGET_MS - EVENT_BUDGET_MS + 1)).toBe(false);
    expect(hasRoomForAnotherEvent(BATCH_BUDGET_MS)).toBe(false);
  });

  it('leaves room inside the Edge Function ceiling', () => {
    expect(BATCH_BUDGET_MS).toBeLessThan(150_000);
  });
});

describe('what can run live', () => {
  /**
   * These were two hand-maintained lists kept honest by comparing them, which
   * works until somebody adds an integration and updates one. Both are now
   * derived from the catalog, so the assertion is about the *rule* rather than
   * about the two copies agreeing.
   */
  it('offers every operation the catalog taught to call itself', () => {
    expect(DESCRIBED_STEP_TYPES.length).toBeGreaterThan(0);
    for (const id of DESCRIBED_STEP_TYPES) {
      expect(SERVER_CAPABLE_STEP_TYPES.has(id)).toBe(true);
      expect(LIVE_CAPABLE.has(id)).toBe(true);
    }
  });

  it('keeps the client’s extra step off the server’s list', () => {
    // `core.webhook_respond` answers a caller the browser is holding open;
    // there is nothing for a server to do, so its allow-list must not offer it.
    for (const id of CLIENT_ONLY_STEP_TYPES) {
      expect(LIVE_CAPABLE.has(id)).toBe(true);
      expect(SERVER_CAPABLE_STEP_TYPES.has(id)).toBe(false);
    }
  });

  it('is the server’s set plus exactly that', () => {
    expect([...LIVE_CAPABLE].sort()).toEqual(
      [...new Set([...SERVER_CAPABLE_STEP_TYPES, ...CLIENT_ONLY_STEP_TYPES])].sort(),
    );
  });
});

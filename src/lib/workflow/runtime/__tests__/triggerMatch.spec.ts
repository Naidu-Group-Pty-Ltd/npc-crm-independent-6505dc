/**
 * Matching is the rule that decides whether a live workflow actually runs, so
 * these tests are the contract. The failure that matters is the quiet one: a
 * filter shown on the canvas that has no effect at dispatch, which starts
 * workflows their author explicitly narrowed.
 */

import { describe, expect, it } from 'vitest';
import { matchTrigger, triggerAccepts, type MatchCandidate } from '../triggerMatch';
import type { WorkflowGraph, WorkflowNode } from '../../types';

const trigger = (type: string, config: Record<string, unknown> = {}): WorkflowNode => ({
  id: 't',
  type,
  position: { x: 0, y: 0 },
  config,
});

const graphOf = (...nodes: WorkflowNode[]): WorkflowGraph => ({ nodes, edges: [] });

const candidate = (workflowId: string, status: string, ...nodes: WorkflowNode[]): MatchCandidate => ({
  workflowId,
  status,
  graph: graphOf(...nodes),
});

describe('a trigger deciding whether it wants an event', () => {
  it('ignores an event of another type', () => {
    expect(
      triggerAccepts(trigger('platform.client_created'), {
        triggerType: 'platform.report_generated',
        payload: {},
      }),
    ).toBe(false);
  });

  it('accepts anything when nothing is narrowed', () => {
    expect(
      triggerAccepts(trigger('platform.client_created', { source: '' }), {
        triggerType: 'platform.client_created',
        payload: { source: 'referral' },
      }),
    ).toBe(true);
  });

  it.each(['any', 'all', '', null, undefined])('treats %s as no opinion', (filter) => {
    expect(
      triggerAccepts(trigger('platform.client_created', { source: filter }), {
        triggerType: 'platform.client_created',
        payload: { source: 'referral' },
      }),
    ).toBe(true);
  });

  it('enforces an equality filter', () => {
    const node = trigger('platform.purchase_file_status_changed', { toStatus: 'settled' });

    expect(
      triggerAccepts(node, {
        triggerType: 'platform.purchase_file_status_changed',
        payload: { toStatus: 'settled' },
      }),
    ).toBe(true);

    // The case this whole module exists for: a narrowed workflow must not run
    // on a transition it did not ask for.
    expect(
      triggerAccepts(node, {
        triggerType: 'platform.purchase_file_status_changed',
        payload: { toStatus: 'unconditional' },
      }),
    ).toBe(false);
  });

  it('compares without caring about case or padding', () => {
    expect(
      triggerAccepts(trigger('platform.purchase_file_status_changed', { toStatus: ' Settled ' }), {
        triggerType: 'platform.purchase_file_status_changed',
        payload: { toStatus: 'settled' },
      }),
    ).toBe(true);
  });

  it('declines when the filter names a key the event does not carry', () => {
    // Passing here would silently ignore the filter, which is the failure mode
    // that looks like everything working.
    expect(
      triggerAccepts(trigger('platform.client_created', { source: 'referral' }), {
        triggerType: 'platform.client_created',
        payload: { clientId: 'c1' },
      }),
    ).toBe(false);
  });

  it('reads minDurationSeconds as a floor, not an equality', () => {
    const node = trigger('platform.call_completed', { minDurationSeconds: 60 });
    const call = (durationSeconds: number) => ({
      triggerType: 'platform.call_completed',
      payload: { durationSeconds },
    });

    expect(triggerAccepts(node, call(59))).toBe(false);
    expect(triggerAccepts(node, call(60))).toBe(true);
    expect(triggerAccepts(node, call(600))).toBe(true);
  });

  it('reads matchesName as a substring', () => {
    const node = trigger('platform.document_uploaded', { matchesName: 'passport' });

    expect(
      triggerAccepts(node, {
        triggerType: 'platform.document_uploaded',
        payload: { fileName: 'Rae-Passport-scan.pdf' },
      }),
    ).toBe(true);
    expect(
      triggerAccepts(node, {
        triggerType: 'platform.document_uploaded',
        payload: { fileName: 'drivers-licence.pdf' },
      }),
    ).toBe(false);
  });

  it('ignores a disabled trigger', () => {
    const node = { ...trigger('platform.client_created'), disabled: true };
    expect(triggerAccepts(node, { triggerType: 'platform.client_created', payload: {} })).toBe(false);
  });

  it('ignores config keys it has no rule for', () => {
    // A workflow saved before a field existed should keep running rather than
    // silently stop the day the catalog gains one.
    expect(
      triggerAccepts(trigger('platform.client_created', { somethingNew: 'x' }), {
        triggerType: 'platform.client_created',
        payload: { somethingNew: 'x' },
      }),
    ).toBe(true);
  });
});

describe('selecting workflows for an event', () => {
  const event = { triggerType: 'platform.client_created', payload: { source: 'referral' } };

  it('starts only live workflows', () => {
    const matches = matchTrigger(event, [
      candidate('live-one', 'live', trigger('platform.client_created')),
      candidate('draft-one', 'draft', trigger('platform.client_created')),
      candidate('paused-one', 'paused', trigger('platform.client_created')),
    ]);

    expect(matches.map((m) => m.workflowId)).toEqual(['live-one']);
  });

  it('names the trigger node that matched', () => {
    const matches = matchTrigger(event, [
      candidate('w', 'live', { ...trigger('platform.client_created'), id: 'start' }),
    ]);

    expect(matches).toEqual([{ workflowId: 'w', nodeId: 'start' }]);
  });

  it('starts a workflow once even when two of its triggers accept', () => {
    // One occurrence is one run. Two listeners should not double-send an email.
    const matches = matchTrigger(event, [
      candidate(
        'w',
        'live',
        { ...trigger('platform.client_created'), id: 'a' },
        { ...trigger('platform.client_created'), id: 'b' },
      ),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0].nodeId).toBe('a');
  });

  it('skips a live workflow whose filter excludes the event', () => {
    const matches = matchTrigger(event, [
      candidate('wants-referrals', 'live', trigger('platform.client_created', { source: 'referral' })),
      candidate('wants-paid', 'live', trigger('platform.client_created', { source: 'paid_ads' })),
    ]);

    expect(matches.map((m) => m.workflowId)).toEqual(['wants-referrals']);
  });

  it('ignores non-trigger nodes of a matching type name', () => {
    const matches = matchTrigger(
      { triggerType: 'core.template', payload: {} },
      [candidate('w', 'live', trigger('core.template', { template: 'x' }))],
    );

    expect(matches).toEqual([]);
  });

  it('survives a workflow with no nodes at all', () => {
    expect(matchTrigger(event, [{ workflowId: 'w', status: 'live', graph: { nodes: [], edges: [] } }])).toEqual([]);
  });
});

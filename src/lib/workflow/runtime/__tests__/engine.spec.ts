/**
 * The engine decides what a workflow *means*, so these tests are the contract:
 * which steps run, in what order, what a branch does to the paths it did not
 * take, and when a run stops.
 */

import { describe, expect, it, vi } from 'vitest';
import { runWorkflow, type Perform } from '../engine';
import { simulate } from '../performers';
import type { WorkflowGraph } from '../../types';

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
});

/** A clock that advances 10ms per read, so durations are deterministic. */
const fixedClock = () => {
  let tick = 0;
  return () => new Date(1_700_000_000_000 + (tick += 10));
};

const run = (graph: WorkflowGraph, options: Partial<Parameters<typeof runWorkflow>[1]> = {}) =>
  runWorkflow(graph, { perform: simulate, now: fixedClock(), ...options });

const statusOf = (result: Awaited<ReturnType<typeof runWorkflow>>, id: string) =>
  result.steps.find((s) => s.nodeId === id)?.status;

describe('running a workflow', () => {
  it('runs steps in dependency order', async () => {
    const graph: WorkflowGraph = {
      nodes: [node('t', 'core.manual'), node('a', 'core.template', { template: 'one' }), node('b', 'core.template', { template: 'two' })],
      edges: [
        { id: 'e1', source: 't', target: 'a' },
        { id: 'e2', source: 'a', target: 'b' },
      ],
    };
    const result = await run(graph);
    expect(result.steps.map((s) => s.nodeId)).toEqual(['t', 'a', 'b']);
    expect(result.status).toBe('succeeded');
  });

  it('seeds the scope from the trigger payload', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('t', 'platform.client_created'),
        node('greet', 'core.template', { template: 'Hi {{t.firstName}}' }),
      ],
      edges: [{ id: 'e1', source: 't', target: 'greet' }],
    };
    const result = await run(graph, { triggerPayload: { firstName: 'Rae' } });
    expect(result.steps[1].output.text).toBe('Hi Rae');
  });

  it('refuses a graph with a loop', async () => {
    const graph: WorkflowGraph = {
      nodes: [node('a', 'core.set'), node('b', 'core.set')],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
    };
    const result = await run(graph);
    expect(result.status).toBe('failed');
    expect(result.haltReason).toContain('loop');
  });

  it('skips a disabled step and everything behind it', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('t', 'core.manual'),
        { ...node('mid', 'core.template', { template: 'x' }), disabled: true },
        node('after', 'core.template', { template: 'y' }),
      ],
      edges: [
        { id: 'e1', source: 't', target: 'mid' },
        { id: 'e2', source: 'mid', target: 'after' },
      ],
    };
    const result = await run(graph);
    expect(statusOf(result, 'mid')).toBe('skipped');
    expect(statusOf(result, 'after')).toBe('skipped');
  });
});

describe('branching', () => {
  const branchGraph = (left: unknown, right: unknown): WorkflowGraph => ({
    nodes: [
      node('t', 'core.manual'),
      node('check', 'core.branch', { left, operator: 'eq', right }),
      node('yes', 'core.template', { template: 'matched' }),
      node('no', 'core.template', { template: 'otherwise' }),
    ],
    edges: [
      { id: 'e1', source: 't', target: 'check' },
      { id: 'e2', source: 'check', target: 'yes', sourceBranch: 'true' },
      { id: 'e3', source: 'check', target: 'no', sourceBranch: 'false' },
    ],
  });

  it('runs only the matching path', async () => {
    const result = await run(branchGraph('gold', 'gold'));
    expect(result.steps.find((s) => s.nodeId === 'check')?.branchTaken).toBe('true');
    expect(statusOf(result, 'yes')).toBe('succeeded');
    expect(statusOf(result, 'no')).toBe('skipped');
  });

  it('runs the other path when it does not match', async () => {
    const result = await run(branchGraph('silver', 'gold'));
    expect(statusOf(result, 'yes')).toBe('skipped');
    expect(statusOf(result, 'no')).toBe('succeeded');
  });

  it('resolves the compared values from earlier steps', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('t', 'platform.client_created'),
        node('check', 'core.branch', { left: '{{t.stage}}', operator: 'eq', right: 'qualified' }),
        node('yes', 'core.template', { template: 'ok' }),
        node('no', 'core.template', { template: 'no' }),
      ],
      edges: [
        { id: 'e1', source: 't', target: 'check' },
        { id: 'e2', source: 'check', target: 'yes', sourceBranch: 'true' },
        { id: 'e3', source: 'check', target: 'no', sourceBranch: 'false' },
      ],
    };
    const result = await run(graph, { triggerPayload: { stage: 'qualified' } });
    expect(statusOf(result, 'yes')).toBe('succeeded');
  });
});

describe('stopping', () => {
  it('halts the run when a filter does not match', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('t', 'core.manual'),
        node('gate', 'core.filter', { left: 'no', operator: 'eq', right: 'yes' }),
        node('after', 'core.template', { template: 'x' }),
      ],
      edges: [
        { id: 'e1', source: 't', target: 'gate' },
        { id: 'e2', source: 'gate', target: 'after' },
      ],
    };
    const result = await run(graph);
    expect(result.status).toBe('halted');
    expect(statusOf(result, 'gate')).toBe('halted');
    expect(result.steps.find((s) => s.nodeId === 'after')).toBeUndefined();
  });

  it('continues when a filter matches', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('t', 'core.manual'),
        node('gate', 'core.filter', { left: 'yes', operator: 'eq', right: 'yes' }),
        node('after', 'core.template', { template: 'x' }),
      ],
      edges: [
        { id: 'e1', source: 't', target: 'gate' },
        { id: 'e2', source: 'gate', target: 'after' },
      ],
    };
    const result = await run(graph);
    expect(result.status).toBe('succeeded');
    expect(statusOf(result, 'after')).toBe('succeeded');
  });

  it('records a stop step as a failure when told to', async () => {
    const graph: WorkflowGraph = {
      nodes: [node('t', 'core.manual'), node('stop', 'core.stop', { outcome: 'failed', reason: 'Not eligible' })],
      edges: [{ id: 'e1', source: 't', target: 'stop' }],
    };
    const result = await run(graph);
    expect(result.status).toBe('failed');
    expect(result.steps[1].error).toBe('Not eligible');
  });

  it('stops runaway graphs at the step limit', async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => node(`n${i}`, 'core.template', { template: 'x' }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: `n${i}`, target: n.id }));
    const result = await run({ nodes, edges }, { maxSteps: 5 });
    expect(result.status).toBe('halted');
    expect(result.haltReason).toContain('5 steps');
  });
});

describe('native steps', () => {
  it('names values and exposes them to later steps', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('t', 'core.manual'),
        node('vars', 'core.set', { values: [{ key: 'tier', value: 'premium' }] }),
        node('out', 'core.template', { template: 'Tier: {{vars.tier}}' }),
      ],
      edges: [
        { id: 'e1', source: 't', target: 'vars' },
        { id: 'e2', source: 'vars', target: 'out' },
      ],
    };
    const result = await run(graph);
    expect(result.steps[2].output.text).toBe('Tier: premium');
  });

  it('splits a list into batches', async () => {
    const graph: WorkflowGraph = {
      nodes: [node('t', 'core.manual'), node('b', 'core.batch', { items: [1, 2, 3, 4, 5], size: 2 })],
      edges: [{ id: 'e1', source: 't', target: 'b' }],
    };
    const result = await run(graph);
    expect(result.steps[1].output.count).toBe(3);
    expect((result.steps[1].output.batches as unknown[][])[0]).toEqual([1, 2]);
  });

  it('reports a delay without waiting in a test run', async () => {
    const graph: WorkflowGraph = {
      nodes: [node('t', 'core.manual'), node('wait', 'core.delay', { duration: '2d' })],
      edges: [{ id: 'e1', source: 't', target: 'wait' }],
    };
    const result = await run(graph);
    expect(result.steps[1].status).toBe('succeeded');
    expect(result.steps[1].simulationNote).toContain('continue immediately');
  });

  it('fails on a duration it cannot read', async () => {
    const graph: WorkflowGraph = {
      nodes: [node('t', 'core.manual'), node('wait', 'core.delay', { duration: 'soon' })],
      edges: [{ id: 'e1', source: 't', target: 'wait' }],
    };
    const result = await run(graph);
    expect(result.steps[1].status).toBe('failed');
    expect(result.status).toBe('failed');
  });

  it('merges the data from every path that reached it', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('t', 'core.manual'),
        node('a', 'core.set', { values: [{ key: 'left', value: 1 }] }),
        node('b', 'core.set', { values: [{ key: 'right', value: 2 }] }),
        node('m', 'core.merge', { mode: 'all' }),
      ],
      edges: [
        { id: 'e1', source: 't', target: 'a' },
        { id: 'e2', source: 't', target: 'b' },
        { id: 'e3', source: 'a', target: 'm' },
        { id: 'e4', source: 'b', target: 'm' },
      ],
    };
    const result = await run(graph);
    const combined = result.steps.find((s) => s.nodeId === 'm')?.output.combined as Record<string, unknown>;
    expect(combined.left).toBe(1);
    expect(combined.right).toBe(2);
  });
});

describe('integration steps', () => {
  it('simulates rather than sending, in a test run', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('t', 'core.manual'),
        node('mail', 'resend.send_email', { to: 'a@b.co', subject: 'Hi', html: 'Body' }),
      ],
      edges: [{ id: 'e1', source: 't', target: 'mail' }],
    };
    const result = await run(graph);
    expect(result.steps[1].status).toBe('simulated');
    expect(result.steps[1].simulationNote).toContain('Nothing was sent');
    expect(result.status).toBe('succeeded');
  });

  it('hands the performer fully resolved config', async () => {
    const perform = vi.fn<Perform>().mockResolvedValue({ status: 'succeeded', output: {} });
    const graph: WorkflowGraph = {
      nodes: [
        node('t', 'platform.client_created'),
        node('mail', 'resend.send_email', { to: '{{t.email}}', subject: 'For {{t.firstName}}', html: 'x' }),
      ],
      edges: [{ id: 'e1', source: 't', target: 'mail' }],
    };
    await run(graph, { perform, triggerPayload: { email: 'rae@example.com', firstName: 'Rae' } });

    expect(perform).toHaveBeenCalledOnce();
    const config = perform.mock.calls[0][0].config;
    expect(config.to).toBe('rae@example.com');
    expect(config.subject).toBe('For Rae');
  });

  it('records references that resolved to nothing', async () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('t', 'core.manual'),
        node('mail', 'resend.send_email', { to: '{{t.nope}}', subject: 's', html: 'h' }),
      ],
      edges: [{ id: 'e1', source: 't', target: 'mail' }],
    };
    const result = await run(graph);
    expect(result.steps[1].missingReferences).toContain('t.nope');
  });

  it('marks the run failed when a step fails, and keeps going', async () => {
    const perform: Perform = async ({ node: n }) =>
      n.id === 'bad'
        ? { status: 'failed', error: 'nope' }
        : { status: 'succeeded', output: {} };

    const graph: WorkflowGraph = {
      nodes: [node('t', 'core.manual'), node('bad', 'resend.send_email'), node('other', 'slack.post_message')],
      edges: [
        { id: 'e1', source: 't', target: 'bad' },
        { id: 'e2', source: 't', target: 'other' },
      ],
    };
    const result = await run(graph, { perform });
    expect(result.status).toBe('failed');
    expect(statusOf(result, 'other')).toBe('succeeded');
  });

  it('turns a thrown error into a failed step rather than losing the run', async () => {
    const perform: Perform = async () => {
      throw new Error('network down');
    };
    const graph: WorkflowGraph = {
      nodes: [node('t', 'core.manual'), node('mail', 'resend.send_email')],
      edges: [{ id: 'e1', source: 't', target: 'mail' }],
    };
    const result = await run(graph, { perform });
    expect(result.steps[1].status).toBe('failed');
    expect(result.steps[1].error).toBe('network down');
  });

  it('fails a step whose catalog entry has gone', async () => {
    const graph: WorkflowGraph = {
      nodes: [node('t', 'core.manual'), node('ghost', 'nowhere.gone')],
      edges: [{ id: 'e1', source: 't', target: 'ghost' }],
    };
    const result = await run(graph);
    expect(result.steps[1].status).toBe('failed');
    expect(result.steps[1].error).toContain('not in the step library');
  });
});

describe('steps that choose a branch', () => {
  // core.approval and core.retry declare branches, but `perform` returns a
  // PerformOutcome, which cannot name one. While they were delegated, every
  // step past an approval or a retry was permanently unreachable.
  const twoWay = (type: string, taken: string, other: string, config = {}): WorkflowGraph => ({
    nodes: [
      node('t', 'core.manual'),
      node('gate', type, config),
      node('yes', 'core.template', { template: 'went ' + taken }),
      node('no', 'core.template', { template: 'went ' + other }),
    ],
    edges: [
      { id: 'e1', source: 't', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'yes', sourceBranch: taken },
      { id: 'e3', source: 'gate', target: 'no', sourceBranch: other },
    ],
  });

  it('carries an approval through its approved path', async () => {
    const result = await run(twoWay('core.approval', 'approved', 'rejected', { approver: 'Finance' }));

    expect(statusOf(result, 'gate')).toBe('succeeded');
    expect(result.steps.find((s) => s.nodeId === 'gate')?.branchTaken).toBe('approved');
    expect(statusOf(result, 'yes')).toBe('succeeded');
    expect(statusOf(result, 'no')).toBe('skipped');
  });

  it('says an approval was assumed rather than obtained', async () => {
    const result = await run(twoWay('core.approval', 'approved', 'rejected', { approver: 'Finance' }));
    expect(result.steps.find((s) => s.nodeId === 'gate')?.simulationNote).toMatch(/Finance/);
  });

  it('carries a retry through its success path', async () => {
    const result = await run(twoWay('core.retry', 'success', 'exhausted', { maxAttempts: 5 }));

    expect(result.steps.find((s) => s.nodeId === 'gate')?.branchTaken).toBe('success');
    expect(statusOf(result, 'yes')).toBe('succeeded');
    expect(statusOf(result, 'no')).toBe('skipped');
  });
});

describe('an unfed trigger', () => {
  const graph: WorkflowGraph = {
    nodes: [
      node('t', 'platform.client_created', { source: 'any' }),
      node('greet', 'core.template', { template: 'Hi {{t.firstName}}' }),
    ],
    edges: [{ id: 'e1', source: 't', target: 'greet' }],
  };

  it('stands in for missing trigger data so the run is readable', async () => {
    // With an empty payload every {{trigger.…}} resolved to nothing, and a run
    // that was merely unfed read as a broken one.
    const result = await run(graph);

    expect(result.steps[0].output.firstName).toBe('[sample firstName]');
    expect(result.steps[1].output.text).toBe('Hi [sample firstName]');
    expect(result.steps[1].missingReferences).toEqual([]);
  });

  it('says the values were stand-ins', async () => {
    const result = await run(graph);
    expect(result.steps[0].simulationNote).toMatch(/sample values/i);
  });

  it('prefers real trigger data whenever it is given', async () => {
    const result = await run(graph, { triggerPayload: { firstName: 'Rae' } });

    expect(result.steps[0].output.firstName).toBe('Rae');
    expect(result.steps[1].output.text).toBe('Hi Rae');
    expect(result.steps[0].simulationNote).toBeUndefined();
  });
});

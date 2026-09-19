import { describe, expect, it } from 'vitest';
import {
  defaultConfigFor,
  evaluateReadiness,
  extractTokens,
  isFieldVisible,
  isRunnable,
  topologicalOrder,
  upstreamOf,
  wouldCreateCycle,
} from '../graph';
import type { WorkflowGraph } from '../types';

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
});

/** Trigger → email, with everything filled in. */
const workingGraph = (): WorkflowGraph => ({
  nodes: [
    node('trigger', 'platform.client_created', { source: 'any' }),
    node('email', 'resend.send_email', {
      to: '{{trigger.email}}',
      subject: 'Welcome',
      html: 'Hello',
    }),
  ],
  edges: [{ id: 'e1', source: 'trigger', target: 'email' }],
});

const allConfigured = new Set(['resend', 'comply_advantage', 'stripe']);

describe('topology', () => {
  it('orders nodes so every step follows the one it depends on', () => {
    const order = topologicalOrder(workingGraph());
    expect(order?.map((n) => n.id)).toEqual(['trigger', 'email']);
  });

  it('returns null when the graph contains a cycle', () => {
    const graph: WorkflowGraph = {
      nodes: [node('a', 'core.set'), node('b', 'core.set')],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
    };
    expect(topologicalOrder(graph)).toBeNull();
  });

  it('rejects an edge that would close a loop', () => {
    const graph: WorkflowGraph = {
      nodes: [node('a', 'core.set'), node('b', 'core.set'), node('c', 'core.set')],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
      ],
    };
    expect(wouldCreateCycle(graph, 'c', 'a')).toBe(true);
    expect(wouldCreateCycle(graph, 'a', 'c')).toBe(false);
  });

  it('rejects an edge from a node to itself', () => {
    expect(wouldCreateCycle(workingGraph(), 'trigger', 'trigger')).toBe(true);
  });

  it('collects upstream nodes nearest first', () => {
    const graph: WorkflowGraph = {
      nodes: [node('a', 'core.set'), node('b', 'core.set'), node('c', 'core.set')],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
      ],
    };
    expect(upstreamOf(graph, 'c').map((n) => n.id)).toEqual(['b', 'a']);
  });
});

describe('readiness', () => {
  const evaluate = (graph: WorkflowGraph, configured = allConfigured) =>
    evaluateReadiness({ graph, configuredIntegrations: configured, credentialsLoaded: true });

  it('clears a complete workflow', () => {
    const issues = evaluate(workingGraph());
    expect(issues).toEqual([]);
    expect(isRunnable(issues)).toBe(true);
  });

  it('says nothing about an empty canvas', () => {
    expect(evaluate({ nodes: [], edges: [] })).toEqual([]);
  });

  it('blocks a workflow with no trigger', () => {
    const graph: WorkflowGraph = {
      nodes: [node('email', 'resend.send_email', { to: 'a@b.co', subject: 's', html: 'h' })],
      edges: [],
    };
    const issues = evaluate(graph);
    expect(issues.some((i) => i.code === 'no-trigger')).toBe(true);
    expect(isRunnable(issues)).toBe(false);
  });

  it('blocks a second trigger and names the one to remove', () => {
    const graph = workingGraph();
    graph.nodes.push(node('extra', 'core.schedule', { preset: 'daily' }));
    graph.edges.push({ id: 'e2', source: 'extra', target: 'email' });

    const issue = evaluate(graph).find((i) => i.code === 'multiple-triggers');
    expect(issue?.nodeId).toBe('extra');
    expect(issue?.message).toContain('only start from one trigger');
  });

  it('blocks a step whose integration has no credentials', () => {
    const issues = evaluate(workingGraph(), new Set());
    const issue = issues.find((i) => i.code === 'missing-credential');
    expect(issue?.nodeId).toBe('email');
    expect(issue?.message).toContain('Integrations page');
  });

  it('stays quiet about credentials until they have loaded', () => {
    const issues = evaluateReadiness({
      graph: workingGraph(),
      configuredIntegrations: new Set(),
      credentialsLoaded: false,
    });
    expect(issues.some((i) => i.code === 'missing-credential')).toBe(false);
  });

  it('blocks a required field left blank', () => {
    const graph = workingGraph();
    graph.nodes[1].config.subject = '   ';
    const issue = evaluate(graph).find((i) => i.code === 'missing-field');
    expect(issue?.nodeId).toBe('email');
    expect(issue?.message).toContain('subject');
  });

  it('demands a required field only while it is visible', () => {
    // core.schedule requires the cron expression, but only when the preset is
    // custom — a daily schedule must not be blocked on a field it never shows.
    const daily: WorkflowGraph = {
      nodes: [node('t', 'core.schedule', { preset: 'daily' })],
      edges: [],
    };
    expect(evaluate(daily)).toEqual([]);

    const custom: WorkflowGraph = {
      nodes: [node('t', 'core.schedule', { preset: 'custom' })],
      edges: [],
    };
    const issue = evaluate(custom).find((i) => i.code === 'missing-field');
    expect(issue?.message.toLowerCase()).toContain('cron');
  });

  it('skips a disabled step entirely', () => {
    const graph = workingGraph();
    graph.nodes[1].disabled = true;
    graph.nodes[1].config.subject = '';
    expect(evaluate(graph, new Set()).some((i) => i.nodeId === 'email')).toBe(false);
  });

  it('warns about a branch with nothing connected', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('trigger', 'platform.client_created', { source: 'any' }),
        node('check', 'core.branch', { left: '{{trigger.stage}}', operator: 'eq', right: 'new' }),
        node('after', 'core.set', { values: [] }),
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'check' },
        { id: 'e2', source: 'check', target: 'after', sourceBranch: 'true' },
      ],
    };
    const issue = evaluate(graph).find((i) => i.code === 'empty-branch');
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toContain('otherwise');
  });

  it('warns about a step nothing leads into', () => {
    const graph = workingGraph();
    graph.nodes.push(node('stray', 'core.set', { values: [] }));
    const issue = evaluate(graph).find((i) => i.code === 'orphan-node');
    expect(issue?.nodeId).toBe('stray');
    expect(issue?.severity).toBe('warning');
  });

  it('reports blocking issues before warnings', () => {
    const graph = workingGraph();
    graph.nodes.push(node('stray', 'core.set', { values: [] }));
    graph.nodes[1].config.subject = '';

    const issues = evaluate(graph);
    const firstWarning = issues.findIndex((i) => i.severity === 'warning');
    const lastBlocking = issues.map((i) => i.severity).lastIndexOf('blocking');
    expect(lastBlocking).toBeLessThan(firstWarning);
  });

  it('a warning alone does not stop the workflow running', () => {
    const graph = workingGraph();
    graph.nodes.push(node('stray', 'core.set', { values: [] }));
    expect(isRunnable(evaluate(graph))).toBe(true);
  });
});

describe('field helpers', () => {
  it('shows a field when its dependency matches', () => {
    const field = { key: 'cron', label: 'Cron', type: 'cron' as const, showWhen: { field: 'preset', equals: ['custom'] } };
    expect(isFieldVisible(field, { preset: 'custom' })).toBe(true);
    expect(isFieldVisible(field, { preset: 'daily' })).toBe(false);
  });

  it('shows a field with no dependency', () => {
    expect(isFieldVisible({ key: 'a', label: 'A', type: 'text' }, {})).toBe(true);
  });

  it('extracts token references', () => {
    expect(extractTokens('Hi {{trigger.firstName}}, see {{report.pdfUrl}}')).toEqual([
      'trigger.firstName',
      'report.pdfUrl',
    ]);
    expect(extractTokens(42)).toEqual([]);
  });

  it('seeds a new node with the catalog defaults', () => {
    expect(defaultConfigFor('core.schedule')).toMatchObject({ preset: 'daily' });
    expect(defaultConfigFor('nope.nope')).toEqual({});
  });
});

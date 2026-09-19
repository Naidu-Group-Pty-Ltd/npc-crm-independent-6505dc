import { describe, expect, it } from 'vitest';
import { NODE_WIDTH } from '@/components/workflow/canvasGeometry';
import { computeLayout, layoutWouldChange } from '../layout';
import type { WorkflowGraph } from '../types';

const node = (id: string, type = 'core.set', x = 0, y = 0) => ({
  id,
  type,
  position: { x, y },
  config: {},
});

/** trigger → a → c, trigger → b → c (a diamond). */
const diamond = (): WorkflowGraph => ({
  nodes: [
    node('trigger', 'core.manual'),
    node('a'),
    node('b'),
    node('c'),
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'a' },
    { id: 'e2', source: 'trigger', target: 'b' },
    { id: 'e3', source: 'a', target: 'c' },
    { id: 'e4', source: 'b', target: 'c' },
  ],
});

describe('auto layout', () => {
  it('places each step to the right of everything feeding it', () => {
    const positions = computeLayout(diamond());
    expect(positions).not.toBeNull();

    const x = (id: string) => (positions as Map<string, { x: number; y: number }>).get(id)?.x ?? 0;
    expect(x('trigger')).toBeLessThan(x('a'));
    expect(x('trigger')).toBeLessThan(x('b'));
    expect(x('a')).toBeLessThan(x('c'));
    expect(x('b')).toBeLessThan(x('c'));
  });

  it('puts steps of the same depth in the same column', () => {
    const positions = computeLayout(diamond()) as Map<string, { x: number; y: number }>;
    expect(positions.get('a')?.x).toBe(positions.get('b')?.x);
    expect(positions.get('a')?.y).not.toBe(positions.get('b')?.y);
  });

  it('uses the longest path, so a step never overlaps one that feeds it', () => {
    // trigger → a → b → c, and also trigger → c. c must sit after b, not beside a.
    const graph: WorkflowGraph = {
      nodes: [node('trigger', 'core.manual'), node('a'), node('b'), node('c')],
      edges: [
        { id: 'e1', source: 'trigger', target: 'a' },
        { id: 'e2', source: 'a', target: 'b' },
        { id: 'e3', source: 'b', target: 'c' },
        { id: 'e4', source: 'trigger', target: 'c' },
      ],
    };
    const positions = computeLayout(graph) as Map<string, { x: number; y: number }>;
    expect(positions.get('c')?.x).toBeGreaterThan(positions.get('b')?.x ?? 0);
  });

  it('leaves at least a full step width between columns', () => {
    const positions = computeLayout(diamond()) as Map<string, { x: number; y: number }>;
    const gap = (positions.get('a')?.x ?? 0) - (positions.get('trigger')?.x ?? 0);
    expect(gap).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it('is deterministic — running it twice changes nothing', () => {
    const graph = diamond();
    const first = computeLayout(graph) as Map<string, { x: number; y: number }>;
    for (const n of graph.nodes) {
      const p = first.get(n.id);
      if (p) n.position = p;
    }
    expect(layoutWouldChange(graph)).toBe(false);
  });

  it('declines to lay out a graph with a cycle', () => {
    const graph: WorkflowGraph = {
      nodes: [node('a'), node('b')],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
    };
    expect(computeLayout(graph)).toBeNull();
    expect(layoutWouldChange(graph)).toBe(false);
  });

  it('reports a change when steps are out of place', () => {
    const graph = diamond();
    graph.nodes[1].position = { x: 999, y: 999 };
    expect(layoutWouldChange(graph)).toBe(true);
  });
});

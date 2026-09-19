/**
 * The editing gestures: multi-selection, clipboard, splicing and layout.
 *
 * These drive the real store rather than components, because the invariants
 * worth protecting are about the graph — that pasting keeps a cluster's shape,
 * that splicing rewires rather than duplicates, that a gesture is one undo.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { nodesWithin, tracePath, useWorkflowStore } from '../store';
import { EMPTY_GRAPH } from '../types';
import { NODE_HEIGHT, NODE_WIDTH } from '@/components/workflow/canvasGeometry';

const store = () => useWorkflowStore.getState();

beforeEach(() => store().loadGraph(EMPTY_GRAPH));

/** trigger → a → b, all connected. */
function chain() {
  const trigger = store().addNode('core.manual', { x: 0, y: 0 });
  const a = store().addNode('core.set', { x: 400, y: 0 });
  const b = store().addNode('core.template', { x: 800, y: 0 });
  store().beginConnection(trigger, { x: 0, y: 0 });
  store().completeConnection(a);
  store().beginConnection(a, { x: 0, y: 0 });
  store().completeConnection(b);
  return { trigger, a, b };
}

describe('selection', () => {
  it('replaces the selection on a plain select', () => {
    const { a, b } = chain();
    store().selectNode(a);
    store().selectNode(b);
    expect(store().selection).toEqual([b]);
    expect(store().selectedNodeId).toBe(b);
  });

  it('extends and removes with toggle', () => {
    const { a, b } = chain();
    store().selectNode(a);
    store().toggleInSelection(b);
    expect(store().selection).toEqual([a, b]);
    store().toggleInSelection(a);
    expect(store().selection).toEqual([b]);
  });

  it('tracks the primary as the last one added', () => {
    const { a, b } = chain();
    store().setSelection([a, b]);
    expect(store().selectedNodeId).toBe(b);
  });

  it('selects everything', () => {
    chain();
    store().selectAll();
    expect(store().selection).toHaveLength(3);
  });

  it('deletes the whole selection and its connections', () => {
    const { a, b } = chain();
    store().setSelection([a, b]);
    store().deleteSelection();
    expect(store().graph.nodes).toHaveLength(1);
    expect(store().graph.edges).toHaveLength(0);
    expect(store().selection).toEqual([]);
  });

  it('moves every selected step together', () => {
    const { a, b } = chain();
    store().setSelection([a, b]);
    store().moveSelection({ x: 50, y: 25 }, { commit: true });

    const nodes = store().graph.nodes;
    expect(nodes.find((n) => n.id === a)?.position).toEqual({ x: 450, y: 25 });
    expect(nodes.find((n) => n.id === b)?.position).toEqual({ x: 850, y: 25 });
    // The unselected trigger stays put.
    expect(nodes.find((n) => n.type === 'core.manual')?.position).toEqual({ x: 0, y: 0 });
  });

  it('nudges as one undo step', () => {
    const { a } = chain();
    store().selectNode(a);
    const before = store().past.length;
    store().nudgeSelection({ x: 16, y: 0 });
    expect(store().past.length).toBe(before + 1);
  });
});

describe('clipboard', () => {
  it('copies the connections between the copied steps', () => {
    const { a, b } = chain();
    store().setSelection([a, b]);
    store().copySelection();

    expect(store().clipboard?.nodes).toHaveLength(2);
    // a→b is internal to the selection and comes along; trigger→a does not.
    expect(store().clipboard?.edges).toHaveLength(1);
  });

  it('pastes with fresh ids and keeps the cluster shape', () => {
    const { a, b } = chain();
    store().setSelection([a, b]);
    store().copySelection();
    store().paste({ x: 0, y: 400 });

    expect(store().graph.nodes).toHaveLength(5);
    expect(store().graph.edges).toHaveLength(3);

    const pasted = store().selection;
    expect(pasted).toHaveLength(2);
    expect(pasted).not.toContain(a);
    expect(pasted).not.toContain(b);

    // Relative spacing preserved: the two originals were 400 apart.
    const positions = pasted.map((id) => store().graph.nodes.find((n) => n.id === id)?.position.x ?? 0);
    expect(Math.abs(positions[1] - positions[0])).toBe(400);
  });

  it('pastes nothing when nothing has been copied', () => {
    useWorkflowStore.setState({ clipboard: null });
    chain();
    store().paste({ x: 0, y: 0 });
    expect(store().graph.nodes).toHaveLength(3);
  });

  it('keeps the clipboard across workflows, so a cluster can be pasted into another', () => {
    const { a, b } = chain();
    store().setSelection([a, b]);
    store().copySelection();

    store().loadGraph(EMPTY_GRAPH);
    expect(store().clipboard?.nodes).toHaveLength(2);

    store().paste({ x: 0, y: 0 });
    expect(store().graph.nodes).toHaveLength(2);
    expect(store().graph.edges).toHaveLength(1);
  });

  it('duplicates the selection in one step', () => {
    const { a, b } = chain();
    store().setSelection([a, b]);
    store().duplicateSelection();
    expect(store().graph.nodes).toHaveLength(5);
  });
});

describe('splicing a step into a connection', () => {
  it('rewires A→B into A→n→B', () => {
    const { trigger, a } = chain();
    const loose = store().addNode('core.delay', { x: 200, y: 200 });
    const edge = store().graph.edges.find((e) => e.source === trigger && e.target === a);

    store().spliceNodeIntoEdge(loose, edge?.id as string);

    const edges = store().graph.edges;
    expect(edges.some((e) => e.source === trigger && e.target === loose)).toBe(true);
    expect(edges.some((e) => e.source === loose && e.target === a)).toBe(true);
    expect(edges.some((e) => e.source === trigger && e.target === a)).toBe(false);
  });

  it('is a single undo', () => {
    const { trigger, a } = chain();
    const loose = store().addNode('core.delay', { x: 200, y: 200 });
    const edge = store().graph.edges.find((e) => e.source === trigger && e.target === a);
    const before = store().past.length;

    store().spliceNodeIntoEdge(loose, edge?.id as string);
    expect(store().past.length).toBe(before + 1);

    store().undo();
    expect(store().graph.edges.some((e) => e.source === trigger && e.target === a)).toBe(true);
  });

  it('refuses a step that already has connections', () => {
    const { trigger, a, b } = chain();
    const edge = store().graph.edges.find((e) => e.source === trigger && e.target === a);
    const edgeCount = store().graph.edges.length;

    // b is already wired, so splicing it would risk closing a loop.
    store().spliceNodeIntoEdge(b, edge?.id as string);
    expect(store().graph.edges).toHaveLength(edgeCount);
  });

  it('creates and wires a new step with insertOnEdge', () => {
    const { trigger, a } = chain();
    const edge = store().graph.edges.find((e) => e.source === trigger && e.target === a);

    const inserted = store().insertOnEdge(edge?.id as string, 'core.delay');
    expect(inserted).toBeTruthy();
    expect(store().graph.nodes).toHaveLength(4);
    expect(store().graph.edges.some((e) => e.source === trigger && e.target === inserted)).toBe(true);
    expect(store().graph.edges.some((e) => e.source === inserted && e.target === a)).toBe(true);
  });
});

describe('quick add', () => {
  it('creates the step already connected to the port it came from', () => {
    const { b } = chain();
    const created = store().addConnectedNode('core.delay', { x: 1200, y: 0 }, b);

    expect(store().graph.edges.some((e) => e.source === b && e.target === created)).toBe(true);
    expect(store().selectedNodeId).toBe(created);
    expect(store().quickAdd).toBeNull();
  });

  it('carries the branch it was dragged from', () => {
    const trigger = store().addNode('core.manual', { x: 0, y: 0 });
    const branch = store().addNode('core.branch', { x: 400, y: 0 });
    store().beginConnection(trigger, { x: 0, y: 0 });
    store().completeConnection(branch);

    const created = store().addConnectedNode('core.set', { x: 800, y: 0 }, branch, 'false');
    const edge = store().graph.edges.find((e) => e.source === branch && e.target === created);
    expect(edge?.sourceBranch).toBe('false');
  });
});

describe('marquee', () => {
  it('picks up every step the band touches', () => {
    const { trigger, a } = chain();
    const ids = nodesWithin(
      store().graph,
      { origin: { x: -10, y: -10 }, cursor: { x: 500, y: 200 } },
      { width: NODE_WIDTH, height: NODE_HEIGHT },
    );
    expect(ids).toContain(trigger);
    expect(ids).toContain(a);
    expect(ids).toHaveLength(2);
  });

  it('adds to the selection when extended', () => {
    const { trigger, a } = chain();
    store().selectNode(trigger);
    store().endMarquee([a], true);
    expect(store().selection).toEqual([trigger, a]);
  });

  it('replaces the selection otherwise', () => {
    const { trigger, a } = chain();
    store().selectNode(trigger);
    store().endMarquee([a], false);
    expect(store().selection).toEqual([a]);
  });
});

describe('path tracing', () => {
  it('collects everything downstream of a step', () => {
    const { trigger, a, b } = chain();
    expect([...tracePath(store().graph, trigger)].sort()).toEqual([a, b, trigger].sort());
    expect([...tracePath(store().graph, b)]).toEqual([b]);
  });
});

describe('auto layout through the store', () => {
  it('repositions steps and can be undone in one press', () => {
    const { a } = chain();
    store().moveNode(a, { x: 7, y: 913 }, { commit: true });
    const before = store().past.length;

    store().autoLayout();
    expect(store().past.length).toBe(before + 1);
    expect(store().graph.nodes.find((n) => n.id === a)?.position).not.toEqual({ x: 7, y: 913 });

    store().undo();
    expect(store().graph.nodes.find((n) => n.id === a)?.position).toEqual({ x: 7, y: 913 });
  });
});

/**
 * The "+" on a connection is exactly this pair of calls: place the step where
 * the button was, then let the store rewire the connection around it. The
 * canvas wires the gesture; this is the contract underneath it, and the thing
 * that must not break is that the downstream step keeps its input — inserting a
 * step that orphans everything after it is worse than not inserting one.
 */
describe('inserting a step into a connection', () => {
  it('rewires the connection through the new step', () => {
    const a = store().addNode('core.manual', { x: 0, y: 0 });
    const c = store().addNode('core.set', { x: 600, y: 0 });
    store().beginConnection(a, { x: 0, y: 0 });
    store().completeConnection(c);
    const original = store().graph.edges[0].id;

    const b = store().addNode('core.template', { x: 300, y: 0 });
    store().spliceNodeIntoEdge(b, original);

    const edges = store().graph.edges;
    expect(edges).toHaveLength(2);
    expect(edges.some((e) => e.source === a && e.target === b)).toBe(true);
    expect(edges.some((e) => e.source === b && e.target === c)).toBe(true);
    // The connection it replaced is gone, not left alongside the new pair.
    expect(edges.some((e) => e.id === original && e.target === c)).toBe(false);
  });

  it('preserves the branch the connection left from', () => {
    const branch = store().addNode('core.branch', { x: 0, y: 0 });
    const c = store().addNode('core.set', { x: 600, y: 0 });
    store().beginConnection(branch, { x: 0, y: 0 }, 'matches');
    store().completeConnection(c);

    const b = store().addNode('core.template', { x: 300, y: 0 });
    store().spliceNodeIntoEdge(b, store().graph.edges[0].id);

    const incoming = store().graph.edges.find((e) => e.target === b);
    expect(incoming?.sourceBranch).toBe('matches');
  });
});

/**
 * Automatic layout.
 *
 * A workflow is a DAG that reads left to right, so the tidy-up is a layered
 * (Sugiyama-style) pass rather than a force simulation: assign each step to a
 * column by its longest path from a trigger, then order rows within a column by
 * the average row of the steps feeding it. Barycentre ordering is what keeps the
 * connections from crossing each other more than they have to.
 *
 * Deterministic — the same graph always produces the same layout, so pressing
 * Tidy up twice never moves anything the second time.
 */

import { NODE_HEIGHT, NODE_WIDTH } from '@/components/workflow/canvasGeometry';
import { getCatalogNode } from './catalog';
import { incoming, outgoing, topologicalOrder } from './graph';
import type { Vec2, WorkflowGraph } from './types';

export const COLUMN_GAP = 96;
export const ROW_GAP = 40;

const COLUMN_STRIDE = NODE_WIDTH + COLUMN_GAP;
const ROW_STRIDE = NODE_HEIGHT + ROW_GAP;

export const LAYOUT_ORIGIN: Vec2 = { x: 80, y: 120 };

/**
 * Positions for every step, or null when the graph has a cycle (in which case
 * there is no sensible left-to-right reading and we leave the canvas alone).
 */
export function computeLayout(graph: WorkflowGraph): Map<string, Vec2> | null {
  const ordered = topologicalOrder(graph);
  if (!ordered) return null;

  // Column = longest path from a root, so a step always sits to the right of
  // everything that feeds it even when one branch is much longer than another.
  const column = new Map<string, number>();
  for (const node of ordered) {
    const parents = incoming(graph, node.id);
    const depth = parents.length
      ? Math.max(...parents.map((p) => (column.get(p.id) ?? 0) + 1))
      : 0;
    column.set(node.id, depth);
  }

  const columns = new Map<number, string[]>();
  for (const node of ordered) {
    const index = column.get(node.id) ?? 0;
    columns.set(index, [...(columns.get(index) ?? []), node.id]);
  }

  const row = new Map<string, number>();
  const sortedColumns = [...columns.keys()].sort((a, b) => a - b);

  for (const index of sortedColumns) {
    const ids = columns.get(index) ?? [];

    if (index === 0) {
      // Roots keep catalog order: triggers first, then anything left dangling.
      const rank = (id: string) => {
        const node = graph.nodes.find((n) => n.id === id);
        return getCatalogNode(node?.type ?? '')?.kind === 'trigger' ? 0 : 1;
      };
      ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      ids.forEach((id, position) => row.set(id, position));
      continue;
    }

    // Barycentre: sit each step next to the average row of its parents.
    const weight = new Map<string, number>();
    for (const id of ids) {
      const parents = incoming(graph, id).map((p) => row.get(p.id) ?? 0);
      weight.set(id, parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : 0);
    }
    ids.sort((a, b) => (weight.get(a) ?? 0) - (weight.get(b) ?? 0) || a.localeCompare(b));
    ids.forEach((id, position) => row.set(id, position));
  }

  // Centre each column vertically against the tallest one so the flow reads as
  // a spine rather than everything hugging the top edge.
  const tallest = Math.max(...sortedColumns.map((c) => (columns.get(c) ?? []).length));

  const positions = new Map<string, Vec2>();
  for (const index of sortedColumns) {
    const ids = columns.get(index) ?? [];
    const offset = (tallest - ids.length) / 2;
    for (const id of ids) {
      positions.set(id, {
        x: LAYOUT_ORIGIN.x + index * COLUMN_STRIDE,
        y: LAYOUT_ORIGIN.y + ((row.get(id) ?? 0) + offset) * ROW_STRIDE,
      });
    }
  }

  return positions;
}

/** Nodes that would move if the layout were applied. */
export function layoutWouldChange(graph: WorkflowGraph): boolean {
  const positions = computeLayout(graph);
  if (!positions) return false;
  return graph.nodes.some((node) => {
    const next = positions.get(node.id);
    return next && (next.x !== node.position.x || next.y !== node.position.y);
  });
}

/**
 * Where a step spliced into an existing connection should sit, and how much room
 * the steps downstream need to make for it.
 */
export function insertionPosition(graph: WorkflowGraph, sourceId: string, targetId: string): Vec2 {
  const source = graph.nodes.find((n) => n.id === sourceId);
  const target = graph.nodes.find((n) => n.id === targetId);
  if (!source || !target) return LAYOUT_ORIGIN;
  return {
    x: Math.round((source.position.x + target.position.x) / 2),
    y: Math.round((source.position.y + target.position.y) / 2),
  };
}

/**
 * Steps at or beyond `fromX`, excluding the ones feeding the insertion point.
 * Used to shift the tail of a flow right when a step is spliced in, so the new
 * step does not land on top of the one that followed it.
 */
export function downstreamOf(graph: WorkflowGraph, startId: string): Set<string> {
  const seen = new Set<string>();
  let frontier = outgoing(graph, startId);
  while (frontier.length) {
    const next = [];
    for (const node of frontier) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      next.push(...outgoing(graph, node.id));
    }
    frontier = next;
  }
  return seen;
}

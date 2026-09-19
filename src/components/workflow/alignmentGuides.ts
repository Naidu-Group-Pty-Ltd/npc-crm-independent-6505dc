/**
 * Smart guides.
 *
 * While a step is dragged, if one of its edges or its centre lines up with
 * another step's, we snap to it and draw the line. This is what makes a
 * hand-arranged canvas look deliberate without anyone reaching for Tidy up —
 * the grid alone gets you close, and the guides get you exact.
 */

import type { Vec2, WorkflowGraph } from '@/lib/workflow/types';
import { NODE_HEIGHT, NODE_WIDTH } from './canvasGeometry';

/** How near, in canvas pixels, before a guide takes hold. */
export const SNAP_TOLERANCE = 7;

export interface Guide {
  axis: 'x' | 'y';
  /** Canvas-space position of the line. */
  at: number;
  /** Span to draw, so the guide reaches both steps rather than the whole canvas. */
  from: number;
  to: number;
}

export interface SnapResult {
  position: Vec2;
  guides: Guide[];
}

interface Candidate {
  /** The value being matched — a left edge, a centre, a bottom edge. */
  value: number;
  /** Offset from the dragged step's origin to that value. */
  offset: number;
}

/**
 * Snaps a dragged step to its neighbours' edges and centres.
 *
 * `movingIds` are excluded from the targets so a multi-step drag does not try to
 * align the cluster to itself.
 */
export function snapToNeighbours(
  graph: WorkflowGraph,
  position: Vec2,
  movingIds: Set<string>,
): SnapResult {
  const others = graph.nodes.filter((n) => !movingIds.has(n.id));
  if (!others.length) return { position, guides: [] };

  const xCandidates: Candidate[] = [
    { value: position.x, offset: 0 },
    { value: position.x + NODE_WIDTH / 2, offset: NODE_WIDTH / 2 },
    { value: position.x + NODE_WIDTH, offset: NODE_WIDTH },
  ];
  const yCandidates: Candidate[] = [
    { value: position.y, offset: 0 },
    { value: position.y + NODE_HEIGHT / 2, offset: NODE_HEIGHT / 2 },
    { value: position.y + NODE_HEIGHT, offset: NODE_HEIGHT },
  ];

  const targetsX: number[] = [];
  const targetsY: number[] = [];
  for (const node of others) {
    targetsX.push(node.position.x, node.position.x + NODE_WIDTH / 2, node.position.x + NODE_WIDTH);
    targetsY.push(node.position.y, node.position.y + NODE_HEIGHT / 2, node.position.y + NODE_HEIGHT);
  }

  const best = (candidates: Candidate[], targets: number[]) => {
    let winner: { target: number; offset: number; distance: number } | null = null;
    for (const candidate of candidates) {
      for (const target of targets) {
        const distance = Math.abs(candidate.value - target);
        if (distance > SNAP_TOLERANCE) continue;
        if (!winner || distance < winner.distance) winner = { target, offset: candidate.offset, distance };
      }
    }
    return winner;
  };

  const snapX = best(xCandidates, targetsX);
  const snapY = best(yCandidates, targetsY);

  const snapped: Vec2 = {
    x: snapX ? snapX.target - snapX.offset : position.x,
    y: snapY ? snapY.target - snapY.offset : position.y,
  };

  const guides: Guide[] = [];

  if (snapX) {
    // Draw the guide only as far as the steps it actually relates.
    const aligned = others.filter((n) =>
      [n.position.x, n.position.x + NODE_WIDTH / 2, n.position.x + NODE_WIDTH].some(
        (v) => Math.abs(v - snapX.target) < 0.5,
      ),
    );
    const ys = [snapped.y, snapped.y + NODE_HEIGHT, ...aligned.flatMap((n) => [n.position.y, n.position.y + NODE_HEIGHT])];
    guides.push({ axis: 'x', at: snapX.target, from: Math.min(...ys), to: Math.max(...ys) });
  }

  if (snapY) {
    const aligned = others.filter((n) =>
      [n.position.y, n.position.y + NODE_HEIGHT / 2, n.position.y + NODE_HEIGHT].some(
        (v) => Math.abs(v - snapY.target) < 0.5,
      ),
    );
    const xs = [snapped.x, snapped.x + NODE_WIDTH, ...aligned.flatMap((n) => [n.position.x, n.position.x + NODE_WIDTH])];
    guides.push({ axis: 'y', at: snapY.target, from: Math.min(...xs), to: Math.max(...xs) });
  }

  return { position: snapped, guides };
}

/**
 * Distance from a point to a cubic bezier, sampled. Used to decide which
 * connection a dragged step is hovering over for a splice.
 */
export function distanceToEdge(point: Vec2, from: Vec2, to: Vec2, samples = 24): number {
  const dx = Math.abs(to.x - from.x);
  const curve = Math.max(32, Math.min(dx * 0.55, 160));
  const c1 = { x: from.x + curve, y: from.y };
  const c2 = { x: to.x - curve, y: to.y };

  let nearest = Infinity;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const mt = 1 - t;
    const x = mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * to.x;
    const y = mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * to.y;
    nearest = Math.min(nearest, Math.hypot(point.x - x, point.y - y));
  }
  return nearest;
}

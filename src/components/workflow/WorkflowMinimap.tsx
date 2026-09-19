/**
 * Overview of the whole graph, with the viewport drawn on it.
 *
 * Earns its space once a workflow outgrows the screen: click or drag to jump.
 * Hidden entirely below three steps, where it would be decoration.
 */

import { useCallback, useRef, type PointerEvent } from 'react';
import { getCatalogNode } from '@/lib/workflow/catalog';
import type { Vec2, WorkflowGraph } from '@/lib/workflow/types';
import { NODE_HEIGHT, NODE_WIDTH, graphBounds } from './canvasGeometry';

interface WorkflowMinimapProps {
  graph: WorkflowGraph;
  viewport: { x: number; y: number; zoom: number };
  /** Size of the visible canvas area, in screen pixels. */
  canvasSize: { width: number; height: number };
  selection: string[];
  onJumpTo: (canvasCentre: Vec2) => void;
}

const MAP_WIDTH = 176;
const MAP_HEIGHT = 112;
const PADDING = 8;

export function WorkflowMinimap({
  graph,
  viewport,
  canvasSize,
  selection,
  onJumpTo,
}: WorkflowMinimapProps) {
  const surfaceRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);

  const bounds = graphBounds(graph);

  const jump = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (!bounds || !surfaceRef.current) return;
      const rect = surfaceRef.current.getBoundingClientRect();
      const width = bounds.maxX - bounds.minX || 1;
      const height = bounds.maxY - bounds.minY || 1;
      const scale = Math.min((MAP_WIDTH - PADDING * 2) / width, (MAP_HEIGHT - PADDING * 2) / height);

      onJumpTo({
        x: bounds.minX + (event.clientX - rect.left - PADDING) / scale,
        y: bounds.minY + (event.clientY - rect.top - PADDING) / scale,
      });
    },
    [bounds, onJumpTo],
  );

  if (!bounds || graph.nodes.length < 3) return null;

  const width = bounds.maxX - bounds.minX || 1;
  const height = bounds.maxY - bounds.minY || 1;
  const scale = Math.min((MAP_WIDTH - PADDING * 2) / width, (MAP_HEIGHT - PADDING * 2) / height);
  const project = (x: number, y: number) => ({
    x: PADDING + (x - bounds.minX) * scale,
    y: PADDING + (y - bounds.minY) * scale,
  });

  // The slice of canvas currently on screen.
  const view = {
    ...project(-viewport.x / viewport.zoom, -viewport.y / viewport.zoom),
    w: (canvasSize.width / viewport.zoom) * scale,
    h: (canvasSize.height / viewport.zoom) * scale,
  };

  const selected = new Set(selection);

  return (
    <svg
      ref={surfaceRef}
      className="wf-minimap"
      width={MAP_WIDTH}
      height={MAP_HEIGHT}
      role="img"
      aria-label={`Overview of ${graph.nodes.length} steps. Click to move the view.`}
      onPointerDown={(event) => {
        draggingRef.current = true;
        surfaceRef.current?.setPointerCapture(event.pointerId);
        jump(event);
      }}
      onPointerMove={(event) => draggingRef.current && jump(event)}
      onPointerUp={(event) => {
        draggingRef.current = false;
        if (surfaceRef.current?.hasPointerCapture(event.pointerId)) {
          surfaceRef.current.releasePointerCapture(event.pointerId);
        }
      }}
    >
      {graph.edges.map((edge) => {
        const source = graph.nodes.find((n) => n.id === edge.source);
        const target = graph.nodes.find((n) => n.id === edge.target);
        if (!source || !target) return null;
        const a = project(source.position.x + NODE_WIDTH, source.position.y + NODE_HEIGHT / 2);
        const b = project(target.position.x, target.position.y + NODE_HEIGHT / 2);
        return <line key={edge.id} className="wf-minimap-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      })}

      {graph.nodes.map((node) => {
        const p = project(node.position.x, node.position.y);
        const isTrigger = getCatalogNode(node.type)?.kind === 'trigger';
        return (
          <rect
            key={node.id}
            className="wf-minimap-node"
            data-trigger={isTrigger}
            data-selected={selected.has(node.id)}
            x={p.x}
            y={p.y}
            width={Math.max(3, NODE_WIDTH * scale)}
            height={Math.max(2, NODE_HEIGHT * scale)}
            rx={1.5}
          />
        );
      })}

      <rect className="wf-minimap-view" x={view.x} y={view.y} width={view.w} height={view.h} rx={2} />
    </svg>
  );
}

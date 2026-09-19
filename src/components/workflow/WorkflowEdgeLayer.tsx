/**
 * The connections between steps.
 *
 * Rendered as one SVG beneath the nodes. Each edge gets an invisible wide
 * "hit" stroke so it can be selected without demanding pixel accuracy, and the
 * visible stroke stays thin.
 *
 * Three affordances live here. Hovering a connection reveals two buttons at its
 * midpoint — insert a step into it, or delete it — and dragging a step over a
 * connection marks it as a splice target so dropping inserts the step into that
 * connection rather than beside it.
 *
 * The insert button is the one that changes how the canvas feels. Adding a step
 * between two existing ones otherwise meant placing it somewhere free, deleting
 * the old connection and drawing two new ones. Now it is one click on the line
 * you want it in, which is where a person is already pointing.
 */

import { memo, useState } from 'react';
import type { Vec2, WorkflowGraph } from '@/lib/workflow/types';
import { EDGE_END_INSET, edgeMidpoint, edgePath, resolveEdges, sourcePort } from './canvasGeometry';

interface WorkflowEdgeLayerProps {
  graph: WorkflowGraph;
  selectedEdgeId: string | null;
  /** In-flight connection being dragged out of a port. */
  pending: { source: string; sourceBranch?: string; cursor: Vec2 } | null;
  /** Edge a dragged step is hovering over; dropping splices into it. */
  spliceTargetEdgeId: string | null;
  /** Steps on the highlighted path — their edges are emphasised. */
  tracedNodeIds: Set<string>;
  onSelectEdge: (edgeId: string | null) => void;
  onRemoveEdge: (edgeId: string) => void;
  /** Insert a step into this connection, at the point the button sits on. */
  onInsertOnEdge: (edgeId: string, at: Vec2) => void;
  /** True while a step is being dragged, which suppresses hover affordances. */
  dragging: boolean;
}

function WorkflowEdgeLayerImpl({
  graph,
  selectedEdgeId,
  pending,
  spliceTargetEdgeId,
  tracedNodeIds,
  onSelectEdge,
  onRemoveEdge,
  onInsertOnEdge,
  dragging,
}: WorkflowEdgeLayerProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const edges = resolveEdges(graph);
  const pendingSource = pending ? graph.nodes.find((n) => n.id === pending.source) : undefined;

  return (
    <svg className="wf-edges" aria-hidden="true">
      <defs>
        {/* Direction is otherwise only inferable from the layout, which stops
            being true the moment a step is dragged to the left of its source. */}
        <marker
          id="wf-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path className="wf-edge-arrow" d="M 0 1 L 7 4 L 0 7 z" />
        </marker>
      </defs>

      {edges.map(({ edge, from, to, label }) => {
        const midpoint = edgeMidpoint(from, to);
        // The hit area keeps the full span so the line stays easy to grab; only
        // the visible stroke stops short, to leave room for its arrowhead.
        const hitPath = edgePath(from, to);
        const path = edgePath(from, to, EDGE_END_INSET);
        const traced = tracedNodeIds.has(edge.source) && tracedNodeIds.has(edge.target);
        const showActions = !dragging && hovered === edge.id;

        return (
          <g
            key={edge.id}
            className="wf-edge-group"
            data-selected={selectedEdgeId === edge.id}
            data-splice={spliceTargetEdgeId === edge.id}
            data-traced={traced}
            onPointerEnter={() => setHovered(edge.id)}
            onPointerLeave={() => setHovered((current) => (current === edge.id ? null : current))}
          >
            <path
              className="wf-edge-hit"
              d={hitPath}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectEdge(edge.id);
              }}
            />
            <path className="wf-edge-path" d={path} markerEnd="url(#wf-arrow)" />

            {label && !showActions && (
              <text className="wf-edge-label" x={midpoint.x} y={midpoint.y - 6}>
                {label}
              </text>
            )}

            {/* Insert and delete, revealed on hover at the midpoint. */}
            {showActions && (
              <g transform={`translate(${midpoint.x}, ${midpoint.y})`}>
                <g
                  className="wf-edge-action wf-edge-action-add"
                  transform="translate(-11, 0)"
                  role="button"
                  aria-label="Insert a step into this connection"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onInsertOnEdge(edge.id, midpoint);
                  }}
                >
                  <circle r="9" />
                  <path d="M -3.6 0 L 3.6 0 M 0 -3.6 L 0 3.6" />
                </g>
                <g
                  className="wf-edge-action"
                  transform="translate(11, 0)"
                  role="button"
                  aria-label="Delete this connection"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onRemoveEdge(edge.id);
                  }}
                >
                  <circle r="9" />
                  <path d="M -3.2 -3.2 L 3.2 3.2 M 3.2 -3.2 L -3.2 3.2" />
                </g>
              </g>
            )}
          </g>
        );
      })}

      {pending && pendingSource && (
        <path
          className="wf-edge-pending"
          d={edgePath(sourcePort(pendingSource, pending.sourceBranch), pending.cursor)}
        />
      )}
    </svg>
  );
}

export const WorkflowEdgeLayer = memo(WorkflowEdgeLayerImpl);

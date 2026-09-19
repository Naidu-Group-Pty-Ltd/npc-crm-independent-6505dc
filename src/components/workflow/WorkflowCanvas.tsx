/**
 * The plotting surface.
 *
 * Pointer handling is centralised here rather than spread across the node cards:
 * a drag that starts on a node, a port or the background all end up in the same
 * move/up handlers, which is what keeps the gestures from fighting each other.
 *
 * The gestures, and how they are told apart at pointer-down:
 *   on a port            → drag a connection; dropping on empty canvas opens the
 *                          quick-add picker and wires whatever is chosen
 *   on a node            → drag it (and the rest of the selection) with smart
 *                          guides; dropping on a connection splices it in
 *   on the background    → marquee-select, or pan when space or middle-button
 *                          is held
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { LayoutGrid, Maximize2, Minus, MousePointer2, Plus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getCatalogNode } from '@/lib/workflow/catalog';
import { layoutWouldChange } from '@/lib/workflow/layout';
import { nodesWithin, tracePath, useWorkflowStore } from '@/lib/workflow/store';
import type { Vec2 } from '@/lib/workflow/types';
import {
  GRID_SIZE,
  NODE_HEIGHT,
  NODE_WIDTH,
  clampZoom,
  graphBounds,
  resolveEdges,
  snap,
  toCanvasSpace,
} from './canvasGeometry';
import { type Guide, distanceToEdge, snapToNeighbours } from './alignmentGuides';
import { QuickAddPicker } from './QuickAddPicker';
import { WorkflowEdgeLayer } from './WorkflowEdgeLayer';
import { WorkflowMinimap } from './WorkflowMinimap';
import { WorkflowNodeCard } from './WorkflowNodeCard';

interface WorkflowCanvasProps {
  configuredIntegrations: Set<string>;
  credentialsLoaded: boolean;
  /** Node ids a readiness issue points at. */
  flaggedNodeIds: Set<string>;
  /** Outcome of the last run, keyed by node id. Empty until one has been run. */
  runStepStatuses?: Map<string, string>;
  onDropCatalogNode: (catalogId: string, position: Vec2) => void;
  /**
   * Opens the step library. The canvas cannot do this itself — the library is
   * a sibling panel, and below `lg` it is not on screen at all — so the empty
   * state hands the request back to the page.
   */
  onBrowseSteps?: () => void;
  /**
   * A step was picked *without* being moved — a tap or an Enter, i.e. "show me
   * this one". The page uses it to reveal the settings panel where that panel
   * is not already docked. Deliberately not fired for a drag: selection starts
   * at pointer-down, and opening a modal panel there would abandon the drag.
   */
  onOpenNodeSettings?: (nodeId: string) => void;
}

/**
 * Whether a step's credentials are in place. Platform and logic steps have no
 * integration behind them, so they are always satisfied; while credentials are
 * still loading everything is treated as fine to avoid a flash of warnings.
 */
function isNodeConfigured(
  catalogId: string,
  configuredIntegrations: Set<string>,
  credentialsLoaded: boolean,
): boolean {
  if (!credentialsLoaded) return true;
  const integrationId = getCatalogNode(catalogId)?.integrationId;
  if (!integrationId) return true;
  return configuredIntegrations.has(integrationId);
}

/** Distance in canvas pixels at which a dragged step latches onto a connection. */
const SPLICE_RADIUS = 44;

type DragState =
  | { kind: 'none' }
  | { kind: 'node'; nodeId: string; grabOffset: Vec2; origin: Vec2; moved: boolean }
  | { kind: 'pan'; origin: Vec2; start: Vec2 }
  | { kind: 'marquee'; additive: boolean }
  | { kind: 'connect' };

export function WorkflowCanvas({
  configuredIntegrations,
  credentialsLoaded,
  flaggedNodeIds,
  runStepStatuses,
  onDropCatalogNode,
  onBrowseSteps,
  onOpenNodeSettings,
}: WorkflowCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>({ kind: 'none' });
  const spaceHeldRef = useRef(false);

  const [dragKind, setDragKind] = useState<DragState['kind']>('none');
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const graph = useWorkflowStore((s) => s.graph);
  const viewport = useWorkflowStore((s) => s.viewport);
  const pending = useWorkflowStore((s) => s.pending);
  const quickAdd = useWorkflowStore((s) => s.quickAdd);
  const marquee = useWorkflowStore((s) => s.marquee);
  const selection = useWorkflowStore((s) => s.selection);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useWorkflowStore((s) => s.selectedEdgeId);
  const spliceTargetEdgeId = useWorkflowStore((s) => s.spliceTargetEdgeId);

  const selectionSet = new Set(selection);

  // Path highlight: hovering a step dims everything it cannot reach.
  const traced = hoveredNodeId && !dragKind.startsWith('n') ? tracePath(graph, hoveredNodeId) : new Set<string>();

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const measure = () =>
      setCanvasSize({ width: surface.clientWidth, height: surface.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const pointToCanvas = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return toCanvasSpace({ x: clientX, y: clientY }, rect, useWorkflowStore.getState().viewport);
    },
    [],
  );

  const setDrag = (state: DragState) => {
    dragRef.current = state;
    setDragKind(state.kind);
  };

  // --- Node drag ----------------------------------------------------------
  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, nodeId: string) => {
      // Ports and menu buttons own their own gestures.
      if ((event.target as HTMLElement).closest('[data-port], [role="menuitem"], button')) return;
      event.stopPropagation();

      const store = useWorkflowStore.getState();
      const node = store.graph.nodes.find((n) => n.id === nodeId);
      if (!node) return;

      // Shift/meta extends the selection; otherwise a click on an unselected
      // step replaces it, and a click on a selected one keeps the group so the
      // whole cluster can be dragged.
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        store.toggleInSelection(nodeId);
      } else if (!store.selection.includes(nodeId)) {
        store.selectNode(nodeId);
      }

      const point = pointToCanvas(event.clientX, event.clientY);
      setDrag({
        kind: 'node',
        nodeId,
        grabOffset: { x: point.x - node.position.x, y: point.y - node.position.y },
        origin: { ...node.position },
        moved: false,
      });
      surfaceRef.current?.setPointerCapture(event.pointerId);
    },
    [pointToCanvas],
  );

  // --- Connection drag ----------------------------------------------------
  const handleStartConnection = useCallback(
    (event: ReactPointerEvent<HTMLElement>, nodeId: string, branch?: string) => {
      event.stopPropagation();
      event.preventDefault();
      setDrag({ kind: 'connect' });
      useWorkflowStore.getState().beginConnection(nodeId, pointToCanvas(event.clientX, event.clientY), branch);
      surfaceRef.current?.setPointerCapture(event.pointerId);
    },
    [pointToCanvas],
  );

  const handleFinishConnection = useCallback((nodeId: string) => {
    if (dragRef.current.kind === 'connect') useWorkflowStore.getState().completeConnection(nodeId);
  }, []);

  /**
   * The "+" on a connection.
   *
   * Opens the same picker a dropped connection opens, with the edge recorded so
   * the choice is spliced in rather than appended. The new step lands on the
   * connection's own midpoint, which is where the person just clicked — placing
   * it anywhere else means they have to go and find it.
   */
  const handleInsertOnEdge = useCallback((edgeId: string, at: Vec2) => {
    const store = useWorkflowStore.getState();
    const edge = store.graph.edges.find((e) => e.id === edgeId);
    if (!edge) return;

    const rect = surfaceRef.current?.getBoundingClientRect();
    const { x, y, zoom } = store.viewport;
    store.openQuickAdd({
      source: edge.source,
      sourceBranch: edge.sourceBranch,
      insertEdgeId: edgeId,
      canvasPosition: { x: snap(at.x - NODE_WIDTH / 2), y: snap(at.y - NODE_HEIGHT / 2) },
      // Canvas space back to screen space, so the picker opens under the cursor.
      screenPosition: {
        x: (rect?.left ?? 0) + at.x * zoom + x,
        y: (rect?.top ?? 0) + at.y * zoom + y,
      },
    });
  }, []);

  // --- Background: pan or marquee -----------------------------------------
  const handleSurfacePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button === 2) return; // right-click opens the context menu

      // The controls and minimap sit inside the canvas, so a press on them would
      // otherwise start a marquee and — worse — capture the pointer, which
      // redirects the pointerup and stops the button ever seeing a click.
      if ((event.target as HTMLElement).closest('[data-canvas-overlay]')) return;

      const store = useWorkflowStore.getState();

      const panning = event.button === 1 || spaceHeldRef.current;
      if (panning) {
        setDrag({
          kind: 'pan',
          origin: { x: event.clientX, y: event.clientY },
          start: { x: viewport.x, y: viewport.y },
        });
      } else {
        if (!event.shiftKey) store.selectNode(null);
        store.selectEdge(null);
        setDrag({ kind: 'marquee', additive: event.shiftKey });
        store.beginMarquee(pointToCanvas(event.clientX, event.clientY));
      }
      surfaceRef.current?.setPointerCapture(event.pointerId);
    },
    [pointToCanvas, viewport.x, viewport.y],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const store = useWorkflowStore.getState();

      if (drag.kind === 'node') {
        const point = pointToCanvas(event.clientX, event.clientY);
        const raw = { x: point.x - drag.grabOffset.x, y: point.y - drag.grabOffset.y };

        // Guides win over the grid: an explicit alignment beats a coarse snap.
        const moving = new Set(store.selection.length ? store.selection : [drag.nodeId]);
        const { position, guides: nextGuides } = snapToNeighbours(store.graph, raw, moving);
        const settled = nextGuides.length
          ? position
          : { x: snap(position.x), y: snap(position.y) };

        const node = store.graph.nodes.find((n) => n.id === drag.nodeId);
        if (node) {
          const delta = { x: settled.x - node.position.x, y: settled.y - node.position.y };
          if (delta.x || delta.y) {
            if (moving.size > 1) store.moveSelection(delta);
            else store.moveNode(drag.nodeId, settled);
            dragRef.current = { ...drag, moved: true };
          }
        }
        setGuides(nextGuides);

        // Splice targeting only makes sense for a single step with no edges yet.
        if (moving.size === 1) {
          const isolated = !store.graph.edges.some((e) => e.source === drag.nodeId || e.target === drag.nodeId);
          if (isolated) {
            const centre = { x: settled.x + NODE_WIDTH / 2, y: settled.y + NODE_HEIGHT / 2 };
            let nearest: { id: string; distance: number } | null = null;
            for (const { edge, from, to } of resolveEdges(store.graph)) {
              if (edge.source === drag.nodeId || edge.target === drag.nodeId) continue;
              const distance = distanceToEdge(centre, from, to);
              if (distance < SPLICE_RADIUS && (!nearest || distance < nearest.distance)) {
                nearest = { id: edge.id, distance };
              }
            }
            store.setSpliceTarget(nearest?.id ?? null);
          }
        }
      } else if (drag.kind === 'pan') {
        store.setViewport({
          ...store.viewport,
          x: drag.start.x + (event.clientX - drag.origin.x),
          y: drag.start.y + (event.clientY - drag.origin.y),
        });
      } else if (drag.kind === 'connect') {
        store.moveConnection(pointToCanvas(event.clientX, event.clientY));
      } else if (drag.kind === 'marquee') {
        store.moveMarquee(pointToCanvas(event.clientX, event.clientY));
      }
    },
    [pointToCanvas],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const store = useWorkflowStore.getState();

      if (drag.kind === 'node') {
        if (drag.moved) {
          const node = store.graph.nodes.find((n) => n.id === drag.nodeId);
          // Commit the finished gesture so undo steps back the whole drag.
          if (node) store.moveNode(drag.nodeId, node.position, { commit: true });
          // Then, if it landed on a connection, rewire it into that connection.
          if (store.spliceTargetEdgeId) {
            store.spliceNodeIntoEdge(drag.nodeId, store.spliceTargetEdgeId);
          }
        } else if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
          // Pressed and released without moving: a request to look at the step,
          // not to place it. Modifier-held presses are extending a selection.
          onOpenNodeSettings?.(drag.nodeId);
        }
        store.setSpliceTarget(null);
        setGuides([]);
      }

      if (drag.kind === 'connect') {
        const landed = (event.target as HTMLElement)?.closest?.('[data-node-id]');
        const nodeId = landed?.getAttribute('data-node-id');
        if (nodeId) {
          store.completeConnection(nodeId);
        } else if (store.pending) {
          // Dropped on empty canvas — offer to create the next step here.
          const canvasPosition = pointToCanvas(event.clientX, event.clientY);
          store.openQuickAdd({
            source: store.pending.source,
            sourceBranch: store.pending.sourceBranch,
            canvasPosition: { x: snap(canvasPosition.x), y: snap(canvasPosition.y - NODE_HEIGHT / 2) },
            screenPosition: { x: event.clientX + 8, y: event.clientY + 8 },
          });
        }
      }

      if (drag.kind === 'marquee' && store.marquee) {
        store.endMarquee(nodesWithin(store.graph, store.marquee, { width: NODE_WIDTH, height: NODE_HEIGHT }), drag.additive);
      }

      setDrag({ kind: 'none' });
      if (surfaceRef.current?.hasPointerCapture(event.pointerId)) {
        surfaceRef.current.releasePointerCapture(event.pointerId);
      }
    },
    [pointToCanvas],
  );

  // --- Zoom ---------------------------------------------------------------
  const zoomAt = useCallback((factor: number, anchor?: Vec2) => {
    const store = useWorkflowStore.getState();
    const rect = surfaceRef.current?.getBoundingClientRect();
    const nextZoom = clampZoom(store.viewport.zoom * factor);
    if (nextZoom === store.viewport.zoom) return;

    const focus = anchor ?? { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
    const ratio = nextZoom / store.viewport.zoom;
    store.setViewport({
      zoom: nextZoom,
      x: focus.x - (focus.x - store.viewport.x) * ratio,
      y: focus.y - (focus.y - store.viewport.y) * ratio,
    });
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    // Non-passive so ctrl+wheel zooms instead of scrolling the page, and a
    // plain wheel pans the canvas rather than the document.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const store = useWorkflowStore.getState();
      if (event.ctrlKey || event.metaKey) {
        const rect = surface.getBoundingClientRect();
        zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      } else {
        store.setViewport({
          ...store.viewport,
          x: store.viewport.x - event.deltaX,
          y: store.viewport.y - event.deltaY,
        });
      }
    };

    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const fitToView = useCallback(() => {
    const store = useWorkflowStore.getState();
    const bounds = graphBounds(store.graph);
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!bounds || !rect) return;

    const padding = 72;
    const zoom = clampZoom(
      Math.min(
        (rect.width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX),
        (rect.height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY),
        1,
      ),
    );
    store.setViewport({
      zoom,
      x: rect.width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
      y: rect.height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
    });
  }, []);

  const centreOn = useCallback((canvasPoint: Vec2) => {
    const store = useWorkflowStore.getState();
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    store.setViewport({
      ...store.viewport,
      x: rect.width / 2 - canvasPoint.x * store.viewport.zoom,
      y: rect.height / 2 - canvasPoint.y * store.viewport.zoom,
    });
  }, []);

  // --- Keyboard -----------------------------------------------------------
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) =>
      (target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTypingTarget(event.target)) {
        spaceHeldRef.current = true;
      }
      if (isTypingTarget(event.target)) return;

      const store = useWorkflowStore.getState();
      const meta = event.metaKey || event.ctrlKey;

      if (event.key === 'Escape') {
        store.cancelConnection();
        store.closeQuickAdd();
        setDrag({ kind: 'none' });
        return;
      }

      if (meta && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        store.selectAll();
      } else if (meta && event.key.toLowerCase() === 'c') {
        store.copySelection();
      } else if (meta && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        const bounds = graphBounds(store.graph);
        store.paste({ x: (bounds?.minX ?? 80) + 48, y: (bounds?.maxY ?? 120) + 48 });
      } else if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        store.duplicateSelection();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (store.selectedEdgeId) store.removeEdge(store.selectedEdgeId);
        else store.deleteSelection();
      } else if (event.key.startsWith('Arrow') && store.selection.length) {
        event.preventDefault();
        const step = event.shiftKey ? GRID_SIZE * 4 : GRID_SIZE;
        const delta: Vec2 = {
          x: event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0,
          y: event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0,
        };
        store.nudgeSelection(delta);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceHeldRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const marqueeRect = marquee
    ? {
        left: Math.min(marquee.origin.x, marquee.cursor.x),
        top: Math.min(marquee.origin.y, marquee.cursor.y),
        width: Math.abs(marquee.cursor.x - marquee.origin.x),
        height: Math.abs(marquee.cursor.y - marquee.origin.y),
      }
    : null;

  const canTidy = graph.nodes.length > 1 && layoutWouldChange(graph);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={surfaceRef}
            className="wf-canvas h-full w-full"
            data-panning={dragKind === 'pan'}
            data-connecting={dragKind === 'connect'}
            data-marquee={dragKind === 'marquee'}
            style={{
              backgroundSize: `${GRID_SIZE * viewport.zoom}px ${GRID_SIZE * viewport.zoom}px`,
              backgroundPosition: `${viewport.x}px ${viewport.y}px`,
            }}
            onPointerDown={handleSurfacePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(event) => {
              event.preventDefault();
              const catalogId = event.dataTransfer.getData('application/x-workflow-node');
              if (!catalogId) return;
              const point = pointToCanvas(event.clientX, event.clientY);
              onDropCatalogNode(catalogId, {
                x: snap(point.x - NODE_WIDTH / 2),
                y: snap(point.y - NODE_HEIGHT / 2),
              });
            }}
          >
            <div
              className="wf-viewport"
              style={{
                transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
              }}
            >
              <WorkflowEdgeLayer
                graph={graph}
                selectedEdgeId={selectedEdgeId}
                pending={pending}
                spliceTargetEdgeId={spliceTargetEdgeId}
                tracedNodeIds={traced}
                dragging={dragKind === 'node'}
                onSelectEdge={(id) => useWorkflowStore.getState().selectEdge(id)}
                onRemoveEdge={(id) => useWorkflowStore.getState().removeEdge(id)}
                onInsertOnEdge={handleInsertOnEdge}
              />

              {/* Smart guides, drawn only while dragging. */}
              {guides.length > 0 && (
                <svg className="wf-guides" aria-hidden="true">
                  {guides.map((guide, index) => (
                    <line
                      key={`${guide.axis}-${guide.at}-${index}`}
                      className="wf-guide"
                      x1={guide.axis === 'x' ? guide.at : guide.from}
                      y1={guide.axis === 'x' ? guide.from : guide.at}
                      x2={guide.axis === 'x' ? guide.at : guide.to}
                      y2={guide.axis === 'x' ? guide.to : guide.at}
                    />
                  ))}
                </svg>
              )}

              {graph.nodes.map((node) => (
                <WorkflowNodeCard
                  key={node.id}
                  node={node}
                  selected={selectionSet.has(node.id)}
                  primary={selectedNodeId === node.id}
                  dragging={dragKind === 'node' && selectionSet.has(node.id)}
                  dimmed={traced.size > 0 && !traced.has(node.id)}
                  flagged={flaggedNodeIds.has(node.id)}
                  runStatus={runStepStatuses?.get(node.id)}
                  configured={isNodeConfigured(node.type, configuredIntegrations, credentialsLoaded)}
                  onPointerDownCard={handleNodePointerDown}
                  onStartConnection={handleStartConnection}
                  onFinishConnection={handleFinishConnection}
                  onHoverChange={(hovering) =>
                    setHoveredNodeId((current) => (hovering ? node.id : current === node.id ? null : current))
                  }
                  onSelect={(id) => {
                    // The keyboard route onto a step — Enter on a focused card.
                    useWorkflowStore.getState().selectNode(id);
                    onOpenNodeSettings?.(id);
                  }}
                  onDelete={(id) => useWorkflowStore.getState().removeNode(id)}
                  onDuplicate={(id) => useWorkflowStore.getState().duplicateNode(id)}
                  onToggleDisabled={(id) => useWorkflowStore.getState().toggleDisabled(id)}
                />
              ))}

              {marqueeRect && (
                <div
                  className="wf-marquee"
                  style={{
                    transform: `translate3d(${marqueeRect.left}px, ${marqueeRect.top}px, 0)`,
                    width: marqueeRect.width,
                    height: marqueeRect.height,
                  }}
                  aria-hidden="true"
                />
              )}
            </div>

            {/* A blank canvas is otherwise indistinguishable from a broken
                one, and below `lg` the step library is not on screen to
                suggest otherwise. */}
            {graph.nodes.length === 0 && (
              <div
                data-canvas-overlay="empty"
                className="pointer-events-none absolute inset-0 grid place-items-center p-6"
              >
                <div className="glass-raised pointer-events-auto max-w-sm rounded-2xl p-6 text-center">
                  <span className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-border">
                    <Zap className="h-5 w-5 text-primary" aria-hidden="true" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-foreground">Nothing on the canvas yet</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    A workflow begins with a trigger — the thing that decides when it runs, like a
                    client being added or a report finishing. Add one, then wire the follow-up
                    steps onto it.
                  </p>
                  {onBrowseSteps && (
                    <Button size="sm" className="mt-4" onClick={onBrowseSteps}>
                      <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      Browse the step library
                    </Button>
                  )}
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Drag a step onto the canvas, or drag from a step's right-hand dot to add the
                    next one.
                  </p>
                </div>
              </div>
            )}

            {/* Controls */}
            <div
              data-canvas-overlay="controls"
              className="pointer-events-auto absolute bottom-4 right-4 flex items-center gap-1 rounded-xl border border-border/70 bg-card/90 p-1 shadow-sm backdrop-blur"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out">
                    <Minus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zoom out</TooltipContent>
              </Tooltip>

              <button
                type="button"
                onClick={() => useWorkflowStore.getState().setViewport({ ...viewport, zoom: 1 })}
                className="min-w-[3rem] rounded px-1 text-center text-xs tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Reset zoom to 100%"
              >
                {Math.round(viewport.zoom * 100)}%
              </button>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomAt(1.2)} aria-label="Zoom in">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zoom in</TooltipContent>
              </Tooltip>

              <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fitToView} aria-label="Fit to view">
                    <Maximize2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Fit to view</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={!canTidy}
                      onClick={() => {
                        useWorkflowStore.getState().autoLayout();
                        requestAnimationFrame(fitToView);
                      }}
                      aria-label="Tidy up the layout"
                    >
                      <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {canTidy ? 'Tidy up — arrange steps left to right' : 'Already tidy'}
                </TooltipContent>
              </Tooltip>
            </div>

            <div data-canvas-overlay="minimap" className="pointer-events-auto absolute bottom-4 left-4">
              <WorkflowMinimap
                graph={graph}
                viewport={viewport}
                canvasSize={canvasSize}
                selection={selection}
                onJumpTo={centreOn}
              />
            </div>

            {selection.length > 1 && (
              <div
                data-canvas-overlay="status"
                className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-border/70 bg-card/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur"
              >
                <MousePointer2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {selection.length} steps selected
              </div>
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-52">
          <ContextMenuItem
            onSelect={() => useWorkflowStore.getState().duplicateSelection()}
            disabled={!selection.length}
          >
            Duplicate
            <span className="ml-auto text-[10px] text-muted-foreground">⌘D</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => useWorkflowStore.getState().copySelection()} disabled={!selection.length}>
            Copy
            <span className="ml-auto text-[10px] text-muted-foreground">⌘C</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => useWorkflowStore.getState().selectAll()} disabled={!graph.nodes.length}>
            Select all
            <span className="ml-auto text-[10px] text-muted-foreground">⌘A</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={fitToView} disabled={!graph.nodes.length}>
            Fit to view
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => useWorkflowStore.getState().autoLayout()} disabled={!canTidy}>
            Tidy up
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => useWorkflowStore.getState().deleteSelection()}
            disabled={!selection.length}
            className="text-destructive"
          >
            Delete
            <span className="ml-auto text-[10px] text-muted-foreground">⌫</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {quickAdd && (
        <QuickAddPicker
          at={quickAdd.screenPosition}
          configuredIntegrations={configuredIntegrations}
          credentialsLoaded={credentialsLoaded}
          onChoose={(catalogId) => {
            const store = useWorkflowStore.getState();
            if (quickAdd.insertEdgeId) {
              // Place it, then let the store rewire the connection around it —
              // the same path a step dragged onto a connection takes.
              const id = store.addNode(catalogId, quickAdd.canvasPosition);
              store.spliceNodeIntoEdge(id, quickAdd.insertEdgeId);
              store.closeQuickAdd();
              return;
            }
            store.addConnectedNode(catalogId, quickAdd.canvasPosition, quickAdd.source, quickAdd.sourceBranch);
          }}
          onDismiss={() => useWorkflowStore.getState().closeQuickAdd()}
        />
      )}
    </>
  );
}

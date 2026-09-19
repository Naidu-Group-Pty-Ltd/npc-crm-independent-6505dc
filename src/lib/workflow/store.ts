/**
 * Canvas state.
 *
 * History is snapshot-based rather than a command log: graphs are small (tens of
 * nodes) and snapshots make undo correct by construction, which matters more
 * here than the memory a command log would save. Drags coalesce into a single
 * history entry so undo steps back one gesture, not one mouse-move.
 *
 * `selection` is the source of truth for what is selected; `selectedNodeId` is
 * the primary of that set and is what the inspector shows. Keeping both means a
 * marquee can select ten steps while the inspector still has one subject.
 */

import { create } from 'zustand';
import { EMPTY_GRAPH, type Vec2, type WorkflowGraph, type WorkflowNode } from './types';
import { defaultConfigFor, makeId, outgoing, wouldCreateCycle } from './graph';
import { computeLayout, downstreamOf, insertionPosition } from './layout';

const HISTORY_LIMIT = 50;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** A connection being dragged out of a port, before it lands. */
export interface PendingConnection {
  source: string;
  sourceBranch?: string;
  /** Canvas-space cursor position. */
  cursor: Vec2;
}

/**
 * A connection dropped on empty canvas. The picker opens here and whatever is
 * chosen is created already wired to `source`.
 */
export interface QuickAdd {
  source: string;
  sourceBranch?: string;
  /**
   * Set when the picker was opened from the "+" on a connection. The chosen
   * step is spliced into that connection rather than hung off its source, so
   * the step downstream keeps its input instead of being orphaned.
   */
  insertEdgeId?: string;
  /** Canvas space — where the new step lands. */
  canvasPosition: Vec2;
  /** Screen space — where the picker opens. */
  screenPosition: Vec2;
}

/** Rubber-band selection, in canvas space. */
export interface Marquee {
  origin: Vec2;
  cursor: Vec2;
}

interface WorkflowState {
  graph: WorkflowGraph;
  /** Every selected step. */
  selection: string[];
  /** The primary selection — what the inspector edits. */
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  viewport: Viewport;
  pending: PendingConnection | null;
  quickAdd: QuickAdd | null;
  marquee: Marquee | null;
  /** Edge the cursor is over while dragging a step — dropping splices it in. */
  spliceTargetEdgeId: string | null;
  clipboard: WorkflowGraph | null;
  dirty: boolean;
  past: WorkflowGraph[];
  future: WorkflowGraph[];

  loadGraph: (graph: WorkflowGraph) => void;
  markSaved: () => void;

  addNode: (catalogId: string, position: Vec2) => string;
  /** Adds a step already connected to `source` — used by quick-add. */
  addConnectedNode: (catalogId: string, position: Vec2, source: string, sourceBranch?: string) => string;
  moveNode: (id: string, position: Vec2, options?: { commit?: boolean }) => void;
  /** Moves every selected step by the same delta. */
  moveSelection: (delta: Vec2, options?: { commit?: boolean }) => void;
  removeNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  toggleDisabled: (id: string) => void;
  renameNode: (id: string, label: string) => void;
  updateConfig: (id: string, key: string, value: unknown) => void;

  selectNode: (id: string | null) => void;
  setSelection: (ids: string[]) => void;
  toggleInSelection: (id: string) => void;
  selectAll: () => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  paste: (at: Vec2) => void;
  nudgeSelection: (delta: Vec2) => void;

  beginConnection: (source: string, cursor: Vec2, sourceBranch?: string) => void;
  moveConnection: (cursor: Vec2) => void;
  completeConnection: (target: string) => void;
  cancelConnection: () => void;
  removeEdge: (id: string) => void;
  selectEdge: (id: string | null) => void;
  /** Splices a new step into an existing connection. */
  insertOnEdge: (edgeId: string, catalogId: string) => string | null;
  /** Rewires an existing, unconnected step into a connection: A→B → A→n→B. */
  spliceNodeIntoEdge: (nodeId: string, edgeId: string) => void;
  setSpliceTarget: (edgeId: string | null) => void;

  openQuickAdd: (quickAdd: QuickAdd) => void;
  closeQuickAdd: () => void;

  beginMarquee: (origin: Vec2) => void;
  moveMarquee: (cursor: Vec2) => void;
  endMarquee: (ids: string[], additive: boolean) => void;

  setViewport: (viewport: Viewport) => void;
  autoLayout: () => void;

  undo: () => void;
  redo: () => void;
}

const clone = (graph: WorkflowGraph): WorkflowGraph => ({
  nodes: graph.nodes.map((n) => ({ ...n, position: { ...n.position }, config: { ...n.config } })),
  edges: graph.edges.map((e) => ({ ...e })),
});

export const useWorkflowStore = create<WorkflowState>((set, get) => {
  /** Applies a change and records the pre-change graph for undo. */
  const commit = (mutate: (graph: WorkflowGraph) => WorkflowGraph) =>
    set((state) => {
      const next = mutate(clone(state.graph));
      return {
        graph: next,
        past: [...state.past, state.graph].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
      };
    });

  const freshNodeId = (taken: Set<string>) => makeId('step', taken);

  return {
    graph: EMPTY_GRAPH,
    selection: [],
    selectedNodeId: null,
    selectedEdgeId: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    pending: null,
    quickAdd: null,
    marquee: null,
    spliceTargetEdgeId: null,
    clipboard: null,
    dirty: false,
    past: [],
    future: [],

    /**
     * Opens a workflow on the canvas. The clipboard deliberately survives, so a
     * cluster copied in one workflow can be pasted into another — everything
     * else is per-workflow and resets.
     */
    loadGraph: (graph) =>
      set({
        graph: clone(graph),
        past: [],
        future: [],
        dirty: false,
        selection: [],
        selectedNodeId: null,
        selectedEdgeId: null,
        pending: null,
        quickAdd: null,
        marquee: null,
        spliceTargetEdgeId: null,
      }),

    markSaved: () => set({ dirty: false }),

    addNode: (catalogId, position) => {
      const id = freshNodeId(new Set(get().graph.nodes.map((n) => n.id)));
      commit((graph) => {
        graph.nodes.push({ id, type: catalogId, position, config: defaultConfigFor(catalogId) });
        return graph;
      });
      set({ selection: [id], selectedNodeId: id, selectedEdgeId: null });
      return id;
    },

    addConnectedNode: (catalogId, position, source, sourceBranch) => {
      const { graph } = get();
      const id = freshNodeId(new Set(graph.nodes.map((n) => n.id)));
      const edgeId = makeId('link', new Set(graph.edges.map((e) => e.id)));
      commit((next) => {
        next.nodes.push({ id, type: catalogId, position, config: defaultConfigFor(catalogId) });
        next.edges.push({ id: edgeId, source, target: id, sourceBranch });
        return next;
      });
      set({ selection: [id], selectedNodeId: id, selectedEdgeId: null, quickAdd: null, pending: null });
      return id;
    },

    /**
     * Dragging calls this on every pointer move with `commit: false`, so the
     * graph updates live but only the drag's end lands in history.
     */
    moveNode: (id, position, options) => {
      const apply = (graph: WorkflowGraph) => {
        const node = graph.nodes.find((n) => n.id === id);
        if (node) node.position = position;
        return graph;
      };
      if (options?.commit) {
        commit(apply);
      } else {
        set((state) => ({ graph: apply(clone(state.graph)), dirty: true }));
      }
    },

    moveSelection: (delta, options) => {
      const ids = new Set(get().selection);
      if (!ids.size) return;
      const apply = (graph: WorkflowGraph) => {
        for (const node of graph.nodes) {
          if (!ids.has(node.id)) continue;
          node.position = { x: node.position.x + delta.x, y: node.position.y + delta.y };
        }
        return graph;
      };
      if (options?.commit) commit(apply);
      else set((state) => ({ graph: apply(clone(state.graph)), dirty: true }));
    },

    removeNode: (id) => {
      commit((graph) => ({
        nodes: graph.nodes.filter((n) => n.id !== id),
        edges: graph.edges.filter((e) => e.source !== id && e.target !== id),
      }));
      set((state) => ({
        selection: state.selection.filter((s) => s !== id),
        selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      }));
    },

    duplicateNode: (id) => {
      const source = get().graph.nodes.find((n) => n.id === id);
      if (!source) return;
      const newId = freshNodeId(new Set(get().graph.nodes.map((n) => n.id)));
      commit((graph) => {
        graph.nodes.push({
          ...source,
          id: newId,
          position: { x: source.position.x + 40, y: source.position.y + 40 },
          config: { ...source.config },
        });
        return graph;
      });
      set({ selection: [newId], selectedNodeId: newId });
    },

    toggleDisabled: (id) =>
      commit((graph) => {
        const node = graph.nodes.find((n) => n.id === id);
        if (node) node.disabled = !node.disabled;
        return graph;
      }),

    renameNode: (id, label) =>
      commit((graph) => {
        const node = graph.nodes.find((n) => n.id === id);
        if (node) node.label = label;
        return graph;
      }),

    updateConfig: (id, key, value) =>
      commit((graph) => {
        const node = graph.nodes.find((n) => n.id === id);
        if (node) node.config = { ...node.config, [key]: value };
        return graph;
      }),

    // --- Selection --------------------------------------------------------
    selectNode: (id) =>
      set({ selection: id ? [id] : [], selectedNodeId: id, selectedEdgeId: null }),

    setSelection: (ids) => set({ selection: ids, selectedNodeId: ids[ids.length - 1] ?? null, selectedEdgeId: null }),

    toggleInSelection: (id) =>
      set((state) => {
        const next = state.selection.includes(id)
          ? state.selection.filter((s) => s !== id)
          : [...state.selection, id];
        return { selection: next, selectedNodeId: next[next.length - 1] ?? null, selectedEdgeId: null };
      }),

    selectAll: () =>
      set((state) => {
        const ids = state.graph.nodes.map((n) => n.id);
        return { selection: ids, selectedNodeId: ids[ids.length - 1] ?? null, selectedEdgeId: null };
      }),

    deleteSelection: () => {
      const ids = new Set(get().selection);
      if (!ids.size) return;
      commit((graph) => ({
        nodes: graph.nodes.filter((n) => !ids.has(n.id)),
        edges: graph.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
      }));
      set({ selection: [], selectedNodeId: null });
    },

    /**
     * Copies the selected steps and every connection *between* them, so pasting
     * a branch keeps its internal shape instead of arriving as loose steps.
     */
    copySelection: () => {
      const { graph, selection } = get();
      const ids = new Set(selection);
      if (!ids.size) return;
      set({
        clipboard: {
          nodes: graph.nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...n, config: { ...n.config } })),
          edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e })),
        },
      });
    },

    paste: (at) => {
      const { clipboard, graph } = get();
      if (!clipboard?.nodes.length) return;

      // Anchor the pasted cluster at the cursor while keeping its inner spacing.
      const minX = Math.min(...clipboard.nodes.map((n) => n.position.x));
      const minY = Math.min(...clipboard.nodes.map((n) => n.position.y));

      const takenNodes = new Set(graph.nodes.map((n) => n.id));
      const takenEdges = new Set(graph.edges.map((e) => e.id));
      const remap = new Map<string, string>();

      for (const node of clipboard.nodes) {
        const id = freshNodeId(takenNodes);
        takenNodes.add(id);
        remap.set(node.id, id);
      }

      const created = [...remap.values()];
      commit((next) => {
        for (const node of clipboard.nodes) {
          next.nodes.push({
            ...node,
            id: remap.get(node.id) as string,
            position: { x: at.x + (node.position.x - minX), y: at.y + (node.position.y - minY) },
            config: { ...node.config },
          });
        }
        for (const edge of clipboard.edges) {
          const id = makeId('link', takenEdges);
          takenEdges.add(id);
          next.edges.push({
            ...edge,
            id,
            source: remap.get(edge.source) as string,
            target: remap.get(edge.target) as string,
          });
        }
        return next;
      });
      set({ selection: created, selectedNodeId: created[created.length - 1] ?? null });
    },

    duplicateSelection: () => {
      get().copySelection();
      const { clipboard } = get();
      if (!clipboard?.nodes.length) return;
      const minX = Math.min(...clipboard.nodes.map((n) => n.position.x));
      const minY = Math.min(...clipboard.nodes.map((n) => n.position.y));
      get().paste({ x: minX + 48, y: minY + 48 });
    },

    nudgeSelection: (delta) => get().moveSelection(delta, { commit: true }),

    // --- Connections ------------------------------------------------------
    beginConnection: (source, cursor, sourceBranch) => set({ pending: { source, cursor, sourceBranch } }),

    moveConnection: (cursor) =>
      set((state) => (state.pending ? { pending: { ...state.pending, cursor } } : {})),

    completeConnection: (target) => {
      const { pending, graph } = get();
      if (!pending || pending.source === target) return set({ pending: null });

      const duplicate = graph.edges.some(
        (e) => e.source === pending.source && e.target === target && e.sourceBranch === pending.sourceBranch,
      );
      if (duplicate || wouldCreateCycle(graph, pending.source, target)) return set({ pending: null });

      const id = makeId('link', new Set(graph.edges.map((e) => e.id)));
      commit((next) => {
        next.edges.push({ id, source: pending.source, target, sourceBranch: pending.sourceBranch });
        return next;
      });
      set({ pending: null });
    },

    cancelConnection: () => set({ pending: null }),

    removeEdge: (id) =>
      set((state) => {
        const next = {
          nodes: state.graph.nodes,
          edges: state.graph.edges.filter((e) => e.id !== id),
        };
        return {
          graph: clone(next),
          past: [...state.past, state.graph].slice(-HISTORY_LIMIT),
          future: [],
          dirty: true,
          selectedEdgeId: state.selectedEdgeId === id ? null : state.selectedEdgeId,
        };
      }),

    selectEdge: (id) => set({ selectedEdgeId: id, selection: [], selectedNodeId: null }),

    /**
     * Splices a step into a connection: A→B becomes A→new→B. Everything
     * downstream shifts right to make room, so the flow stays readable instead
     * of the new step landing on top of B.
     */
    insertOnEdge: (edgeId, catalogId) => {
      const { graph } = get();
      const edge = graph.edges.find((e) => e.id === edgeId);
      if (!edge) return null;

      const id = freshNodeId(new Set(graph.nodes.map((n) => n.id)));
      const takenEdges = new Set(graph.edges.map((e) => e.id));
      const secondEdgeId = makeId('link', takenEdges);
      takenEdges.add(secondEdgeId);

      const position = insertionPosition(graph, edge.source, edge.target);
      const shift = downstreamOf(graph, edge.source);

      commit((next) => {
        for (const node of next.nodes) {
          if (shift.has(node.id)) node.position = { ...node.position, x: node.position.x + 200 };
        }
        next.nodes.push({ id, type: catalogId, position, config: defaultConfigFor(catalogId) });
        next.edges = next.edges.filter((e) => e.id !== edgeId);
        next.edges.push({ id: edgeId, source: edge.source, target: id, sourceBranch: edge.sourceBranch });
        next.edges.push({ id: secondEdgeId, source: id, target: edge.target });
        return next;
      });

      set({ selection: [id], selectedNodeId: id, selectedEdgeId: null, spliceTargetEdgeId: null });
      return id;
    },

    /**
     * Drops an already-placed step into a connection. One commit, so undo puts
     * both the step's position and the rewiring back in a single press.
     */
    spliceNodeIntoEdge: (nodeId, edgeId) => {
      const { graph } = get();
      const edge = graph.edges.find((e) => e.id === edgeId);
      if (!edge || edge.source === nodeId || edge.target === nodeId) return;
      // Only safe for a step with no connections of its own; otherwise the
      // rewiring could close a loop.
      if (graph.edges.some((e) => e.source === nodeId || e.target === nodeId)) return;

      const secondEdgeId = makeId('link', new Set(graph.edges.map((e) => e.id)));
      commit((next) => {
        next.edges = next.edges.filter((e) => e.id !== edgeId);
        next.edges.push({ id: edgeId, source: edge.source, target: nodeId, sourceBranch: edge.sourceBranch });
        next.edges.push({ id: secondEdgeId, source: nodeId, target: edge.target });
        return next;
      });
      set({ spliceTargetEdgeId: null, selection: [nodeId], selectedNodeId: nodeId });
    },

    setSpliceTarget: (edgeId) => set({ spliceTargetEdgeId: edgeId }),

    // --- Quick add --------------------------------------------------------
    openQuickAdd: (quickAdd) => set({ quickAdd, pending: null }),
    closeQuickAdd: () => set({ quickAdd: null }),

    // --- Marquee ----------------------------------------------------------
    beginMarquee: (origin) => set({ marquee: { origin, cursor: origin } }),
    moveMarquee: (cursor) => set((state) => (state.marquee ? { marquee: { ...state.marquee, cursor } } : {})),
    endMarquee: (ids, additive) =>
      set((state) => {
        const next = additive ? [...new Set([...state.selection, ...ids])] : ids;
        return { marquee: null, selection: next, selectedNodeId: next[next.length - 1] ?? null };
      }),

    setViewport: (viewport) => set({ viewport }),

    autoLayout: () => {
      const positions = computeLayout(get().graph);
      if (!positions) return;
      commit((graph) => {
        for (const node of graph.nodes) {
          const next = positions.get(node.id);
          if (next) node.position = next;
        }
        return graph;
      });
    },

    undo: () =>
      set((state) => {
        const previous = state.past[state.past.length - 1];
        if (!previous) return {};
        return {
          graph: previous,
          past: state.past.slice(0, -1),
          future: [state.graph, ...state.future].slice(0, HISTORY_LIMIT),
          dirty: true,
        };
      }),

    redo: () =>
      set((state) => {
        const [next, ...rest] = state.future;
        if (!next) return {};
        return {
          graph: next,
          past: [...state.past, state.graph].slice(-HISTORY_LIMIT),
          future: rest,
          dirty: true,
        };
      }),
  };
});

/** Steps whose box intersects the marquee. */
export function nodesWithin(
  graph: WorkflowGraph,
  marquee: Marquee,
  nodeSize: { width: number; height: number },
): string[] {
  const left = Math.min(marquee.origin.x, marquee.cursor.x);
  const right = Math.max(marquee.origin.x, marquee.cursor.x);
  const top = Math.min(marquee.origin.y, marquee.cursor.y);
  const bottom = Math.max(marquee.origin.y, marquee.cursor.y);

  return graph.nodes
    .filter((node: WorkflowNode) => {
      const nodeRight = node.position.x + nodeSize.width;
      const nodeBottom = node.position.y + nodeSize.height;
      return node.position.x < right && nodeRight > left && node.position.y < bottom && nodeBottom > top;
    })
    .map((n) => n.id);
}

/** Every step reachable downstream of the given one, for path highlighting. */
export function tracePath(graph: WorkflowGraph, nodeId: string): Set<string> {
  const seen = new Set<string>([nodeId]);
  let frontier = outgoing(graph, nodeId);
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

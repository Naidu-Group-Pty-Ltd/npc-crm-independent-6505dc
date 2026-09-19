/**
 * Graph analysis: topology, data flow and run readiness.
 *
 * Pure functions over `WorkflowGraph` — no React, no network — so the rules a
 * workflow has to satisfy are testable on their own and the canvas and the
 * readiness rail cannot disagree about whether something is valid.
 */

import { getCatalogNode } from './catalog/index.pure.ts';
import type { NodeField, ReadinessIssue, WorkflowGraph, WorkflowNode } from './types.pure.ts';

export const nodeLabel = (node: WorkflowNode): string =>
  node.label?.trim() || getCatalogNode(node.type)?.name || 'Unknown step';

/** Direct predecessors of a node. */
export function incoming(graph: WorkflowGraph, nodeId: string): WorkflowNode[] {
  const sources = graph.edges.filter((e) => e.target === nodeId).map((e) => e.source);
  return graph.nodes.filter((n) => sources.includes(n.id));
}

/** Direct successors of a node. */
export function outgoing(graph: WorkflowGraph, nodeId: string): WorkflowNode[] {
  const targets = graph.edges.filter((e) => e.source === nodeId).map((e) => e.target);
  return graph.nodes.filter((n) => targets.includes(n.id));
}

/**
 * Every node that can run before `nodeId`, nearest first. This is the set whose
 * outputs the node may reference, so it drives the token picker.
 */
export function upstreamOf(graph: WorkflowGraph, nodeId: string): WorkflowNode[] {
  const seen = new Set<string>();
  const ordered: WorkflowNode[] = [];
  let frontier = incoming(graph, nodeId);

  while (frontier.length) {
    const next: WorkflowNode[] = [];
    for (const node of frontier) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      ordered.push(node);
      next.push(...incoming(graph, node.id));
    }
    frontier = next;
  }
  return ordered;
}

/** Nodes in run order. Returns null when the graph contains a cycle. */
export function topologicalOrder(graph: WorkflowGraph): WorkflowNode[] | null {
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const edge of graph.edges) {
    if (!indegree.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
  const ordered: WorkflowNode[] = [];

  while (queue.length) {
    const node = queue.shift() as WorkflowNode;
    ordered.push(node);
    for (const next of outgoing(graph, node.id)) {
      const remaining = (indegree.get(next.id) ?? 0) - 1;
      indegree.set(next.id, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  return ordered.length === graph.nodes.length ? ordered : null;
}

/** Adding this edge would close a loop. */
export function wouldCreateCycle(graph: WorkflowGraph, source: string, target: string): boolean {
  if (source === target) return true;
  const probe: WorkflowGraph = {
    nodes: graph.nodes,
    edges: [...graph.edges, { id: '__probe', source, target }],
  };
  return topologicalOrder(probe) === null;
}

/** `{{step.key}}` references inside a configured value. */
export function extractTokens(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]);
}

/** Whether a field should be shown, given the rest of the node's config. */
export function isFieldVisible(field: NodeField, config: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  const current = config[field.showWhen.field];
  return field.showWhen.equals.includes(String(current ?? ''));
}

const isBlank = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

export interface ReadinessInput {
  graph: WorkflowGraph;
  /** Integration ids with every required credential saved. */
  configuredIntegrations: Set<string>;
  /** False while credentials are still loading, to avoid a flash of false alarms. */
  credentialsLoaded: boolean;
}

/**
 * Everything standing between this workflow and a successful run.
 *
 * Ordered by how much it blocks: no trigger first, then credentials, then
 * per-node configuration. Each message names the fix, not just the fault.
 */
export function evaluateReadiness({
  graph,
  configuredIntegrations,
  credentialsLoaded,
}: ReadinessInput): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  if (!graph.nodes.length) return issues;

  const triggers = graph.nodes.filter((n) => getCatalogNode(n.type)?.kind === 'trigger');

  if (triggers.length === 0) {
    issues.push({
      severity: 'blocking',
      code: 'no-trigger',
      message: 'Add a trigger so the workflow knows when to run.',
    });
  } else if (triggers.length > 1) {
    for (const extra of triggers.slice(1)) {
      issues.push({
        severity: 'blocking',
        code: 'multiple-triggers',
        nodeId: extra.id,
        message: `Remove “${nodeLabel(extra)}” — a workflow can only start from one trigger.`,
      });
    }
  }

  if (topologicalOrder(graph) === null) {
    issues.push({
      severity: 'blocking',
      code: 'cycle',
      message: 'Two steps depend on each other. Remove a connection to break the loop.',
    });
  }

  for (const node of graph.nodes) {
    if (node.disabled) continue;
    const definition = getCatalogNode(node.type);
    if (!definition) continue;

    if (definition.integrationId && credentialsLoaded && !configuredIntegrations.has(definition.integrationId)) {
      issues.push({
        severity: 'blocking',
        code: 'missing-credential',
        nodeId: node.id,
        message: `“${nodeLabel(node)}” needs credentials. Add them on the Integrations page.`,
      });
    }

    for (const field of definition.fields) {
      if (!field.required || !isFieldVisible(field, node.config)) continue;
      if (isBlank(node.config[field.key])) {
        issues.push({
          severity: 'blocking',
          code: 'missing-field',
          nodeId: node.id,
          message: `“${nodeLabel(node)}” is missing ${field.label.toLowerCase()}.`,
        });
      }
    }

    // A branch with nothing on one side silently drops half its runs.
    if (definition.branches?.length) {
      for (const branch of definition.branches) {
        const connected = graph.edges.some((e) => e.source === node.id && e.sourceBranch === branch.id);
        if (!connected) {
          issues.push({
            severity: 'warning',
            code: 'empty-branch',
            nodeId: node.id,
            message: `“${nodeLabel(node)}” has nothing connected to its ${branch.label.toLowerCase()} path.`,
          });
        }
      }
    }

    const isTrigger = definition.kind === 'trigger';
    const hasConnection = graph.edges.some((e) => e.source === node.id || e.target === node.id);
    if (!hasConnection && graph.nodes.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'orphan-node',
        nodeId: node.id,
        message: `“${nodeLabel(node)}” is not connected to anything, so it will never run.`,
      });
    } else if (!isTrigger && !incoming(graph, node.id).length && graph.nodes.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'orphan-node',
        nodeId: node.id,
        message: `Nothing leads into “${nodeLabel(node)}”, so it will never run.`,
      });
    }
  }

  const rank = (i: ReadinessIssue) => (i.severity === 'blocking' ? 0 : 1);
  return issues.sort((a, b) => rank(a) - rank(b));
}

export const isRunnable = (issues: ReadinessIssue[]) => !issues.some((i) => i.severity === 'blocking');

/** Fresh id for a node or edge. Collision-checked against the graph it joins. */
export function makeId(prefix: string, taken: Set<string>): string {
  let n = 1;
  let candidate = `${prefix}_${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${prefix}_${n}`;
  }
  return candidate;
}

/** Default config for a freshly dropped node, from the catalog's defaults. */
export function defaultConfigFor(catalogId: string): Record<string, unknown> {
  const definition = getCatalogNode(catalogId);
  if (!definition) return {};
  const config: Record<string, unknown> = {};
  for (const field of definition.fields) {
    if (field.defaultValue !== undefined) config[field.key] = field.defaultValue;
  }
  return config;
}

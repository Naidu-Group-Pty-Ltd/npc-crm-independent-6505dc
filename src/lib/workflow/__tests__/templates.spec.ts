/**
 * Templates reference catalog node ids by hand, so they are exactly the thing
 * that rots when an operation is renamed. These tests are the guard.
 */

import { describe, expect, it } from 'vitest';
import { getCatalogNode } from '../catalog';
import { topologicalOrder } from '../graph';
import { WORKFLOW_TEMPLATES } from '../templates';
import { INTEGRATIONS } from '@/lib/integrations/registry';

describe('starter templates', () => {
  it('has a unique id per template', () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(WORKFLOW_TEMPLATES)('$name uses only catalog steps that exist', (template) => {
    const unknown = template.graph.nodes.filter((n) => !getCatalogNode(n.type)).map((n) => n.type);
    expect(unknown).toEqual([]);
  });

  it.each(WORKFLOW_TEMPLATES)('$name connects only nodes it declares', (template) => {
    const ids = new Set(template.graph.nodes.map((n) => n.id));
    const dangling = template.graph.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
    expect(dangling).toEqual([]);
  });

  it.each(WORKFLOW_TEMPLATES)('$name starts from exactly one trigger', (template) => {
    const triggers = template.graph.nodes.filter((n) => getCatalogNode(n.type)?.kind === 'trigger');
    expect(triggers).toHaveLength(1);
  });

  it.each(WORKFLOW_TEMPLATES)('$name has no cycles', (template) => {
    expect(topologicalOrder(template.graph)).not.toBeNull();
  });

  it.each(WORKFLOW_TEMPLATES)('$name leaves every step reachable', (template) => {
    const withIncoming = new Set(template.graph.edges.map((e) => e.target));
    const orphans = template.graph.nodes
      .filter((n) => getCatalogNode(n.type)?.kind !== 'trigger' && !withIncoming.has(n.id))
      .map((n) => n.id);
    expect(orphans).toEqual([]);
  });

  it.each(WORKFLOW_TEMPLATES)('$name names real branches on branching steps', (template) => {
    const bad: string[] = [];
    for (const edge of template.graph.edges) {
      if (!edge.sourceBranch) continue;
      const source = template.graph.nodes.find((n) => n.id === edge.source);
      const branches = source ? getCatalogNode(source.type)?.branches ?? [] : [];
      if (!branches.some((b) => b.id === edge.sourceBranch)) bad.push(`${edge.source}:${edge.sourceBranch}`);
    }
    expect(bad).toEqual([]);
  });

  it.each(WORKFLOW_TEMPLATES)('$name connects every branch of a branching step', (template) => {
    const unconnected: string[] = [];
    for (const node of template.graph.nodes) {
      const branches = getCatalogNode(node.type)?.branches ?? [];
      for (const branch of branches) {
        const wired = template.graph.edges.some((e) => e.source === node.id && e.sourceBranch === branch.id);
        if (!wired) unconnected.push(`${node.id}:${branch.id}`);
      }
    }
    expect(unconnected).toEqual([]);
  });

  it.each(WORKFLOW_TEMPLATES)('$name only configures fields its steps declare', (template) => {
    const unknown: string[] = [];
    for (const node of template.graph.nodes) {
      const keys = new Set((getCatalogNode(node.type)?.fields ?? []).map((f) => f.key));
      for (const key of Object.keys(node.config)) {
        if (!keys.has(key)) unknown.push(`${node.type}.${key}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it.each(WORKFLOW_TEMPLATES)('$name declares the integrations it actually uses', (template) => {
    const used = new Set(
      template.graph.nodes
        .map((n) => getCatalogNode(n.type)?.integrationId)
        .filter((id): id is string => Boolean(id)),
    );
    expect([...used].sort()).toEqual([...template.requires].sort());
  });

  it.each(WORKFLOW_TEMPLATES)('$name names only integrations in the registry', (template) => {
    const known = new Set(INTEGRATIONS.map((i) => i.id));
    expect(template.requires.filter((id) => !known.has(id))).toEqual([]);
  });

  it.each(WORKFLOW_TEMPLATES)('$name references only upstream data', (template) => {
    // A `{{step.key}}` pointing at a step that runs later would resolve to nothing.
    const order = topologicalOrder(template.graph) ?? [];
    const positionOf = new Map(order.map((n, index) => [n.id, index]));
    const bad: string[] = [];

    for (const node of template.graph.nodes) {
      for (const value of Object.values(node.config)) {
        if (typeof value !== 'string') continue;
        for (const match of value.matchAll(/\{\{\s*([\w-]+)\.[\w.-]+\s*\}\}/g)) {
          const referenced = match[1];
          if (!positionOf.has(referenced)) {
            bad.push(`${node.id} → unknown step ${referenced}`);
          } else if ((positionOf.get(referenced) as number) >= (positionOf.get(node.id) as number)) {
            bad.push(`${node.id} → ${referenced} runs later`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

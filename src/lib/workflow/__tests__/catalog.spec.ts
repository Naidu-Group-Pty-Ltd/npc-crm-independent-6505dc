import { describe, expect, it } from 'vitest';
import { INTEGRATION_CATEGORIES, INTEGRATIONS } from '@/lib/integrations/registry';
import { CATALOG, COVERED_INTEGRATIONS, getCatalogNode, searchCatalog } from '../catalog';
import { INTEGRATION_CATEGORY_IDS } from '../types';

describe('node catalog integrity', () => {
  /**
   * `types.pure.ts` restates the category union rather than importing it: it has
   * to parse under Deno, where `@/lib/integrations/registry` resolves to nothing.
   * Restating means the two can drift, so the drift is what is asserted.
   */
  it('agrees with the integration registry about the category list', () => {
    expect([...INTEGRATION_CATEGORY_IDS].sort()).toEqual(
      INTEGRATION_CATEGORIES.map((c) => c.id).sort(),
    );
  });

  it('gives every integration in the registry at least one operation', () => {
    const missing = INTEGRATIONS.filter((i) => !COVERED_INTEGRATIONS.has(i.id)).map((i) => i.id);
    expect(missing).toEqual([]);
  });

  it('references no integration that is absent from the registry', () => {
    const known = new Set(INTEGRATIONS.map((i) => i.id));
    const unknown = [...COVERED_INTEGRATIONS].filter((id) => !known.has(id));
    expect(unknown).toEqual([]);
  });

  it('has unique node ids', () => {
    const ids = CATALOG.map((n) => n.id);
    const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    expect(duplicates).toEqual([]);
  });

  it('prefixes every integration node id with its integration', () => {
    const mismatched = CATALOG.filter(
      (n) => n.integrationId && !n.id.startsWith(`${n.integrationId}.`),
    ).map((n) => n.id);
    expect(mismatched).toEqual([]);
  });

  it('gives every node a name and a summary written as a sentence', () => {
    const bad = CATALOG.filter((n) => !n.name.trim() || !/^[A-Z].*\.$/.test(n.summary)).map((n) => n.id);
    expect(bad).toEqual([]);
  });

  it('has unique field keys within each node', () => {
    const offenders = CATALOG.filter((node) => {
      const keys = node.fields.map((f) => f.key);
      return new Set(keys).size !== keys.length;
    }).map((n) => n.id);
    expect(offenders).toEqual([]);
  });

  it('has unique output keys within each node', () => {
    const offenders = CATALOG.filter((node) => {
      const keys = node.outputs.map((o) => o.key);
      return new Set(keys).size !== keys.length;
    }).map((n) => n.id);
    expect(offenders).toEqual([]);
  });

  it('points every showWhen at a field that exists on the same node', () => {
    const dangling: string[] = [];
    for (const node of CATALOG) {
      const keys = new Set(node.fields.map((f) => f.key));
      for (const field of node.fields) {
        if (field.showWhen && !keys.has(field.showWhen.field)) {
          dangling.push(`${node.id}.${field.key} → ${field.showWhen.field}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it('gives select fields at least two options', () => {
    const thin: string[] = [];
    for (const node of CATALOG) {
      for (const field of node.fields) {
        if ((field.type === 'select' || field.type === 'multiselect') && (field.options?.length ?? 0) < 2) {
          thin.push(`${node.id}.${field.key}`);
        }
      }
    }
    expect(thin).toEqual([]);
  });

  it('gives every branching node at least two labelled paths', () => {
    const bad = CATALOG.filter((n) => n.branches && n.branches.length < 2).map((n) => n.id);
    expect(bad).toEqual([]);
  });

  it('never marks a trigger as needing an input connection', () => {
    // Triggers start a run, so a branch on a trigger would have nothing upstream.
    const bad = CATALOG.filter((n) => n.kind === 'trigger' && n.branches?.length).map((n) => n.id);
    expect(bad).toEqual([]);
  });

  it('gives every integration-backed node a documentation link', () => {
    const undocumented = CATALOG.filter((n) => n.integrationId && !n.docsUrl).map((n) => n.id);
    expect(undocumented).toEqual([]);
  });

  it('offers at least one trigger, action and logic step', () => {
    expect(CATALOG.filter((n) => n.kind === 'trigger').length).toBeGreaterThan(0);
    expect(CATALOG.filter((n) => n.kind === 'action').length).toBeGreaterThan(0);
    expect(CATALOG.filter((n) => n.kind === 'logic').length).toBeGreaterThan(0);
  });
});

describe('catalog lookup', () => {
  it('resolves a known node', () => {
    expect(getCatalogNode('stripe.create_invoice')?.name).toBe('Create and send an invoice');
  });

  it('returns undefined for inherited object properties', () => {
    for (const key of ['__proto__', 'constructor', 'toString', 'valueOf']) {
      expect(getCatalogNode(key)).toBeUndefined();
    }
  });
});

describe('catalog search', () => {
  it('matches on the integration id as well as the name', () => {
    const results = searchCatalog({ query: 'cotality' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((n) => n.integrationId === 'cotality')).toBe(true);
  });

  it('matches on hand-written keywords', () => {
    const results = searchCatalog({ query: 'zoning' });
    expect(results.map((n) => n.id)).toContain('landchecker.planning_overlays');
  });

  it('requires every token to match', () => {
    const results = searchCatalog({ query: 'send email' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((n) => n.id)).toContain('resend.send_email');
    expect(results.map((n) => n.id)).not.toContain('core.branch');
  });

  it('filters by kind', () => {
    expect(searchCatalog({ kind: 'trigger' }).every((n) => n.kind === 'trigger')).toBe(true);
  });

  it('returns everything when nothing is asked for', () => {
    expect(searchCatalog({}).length).toBe(CATALOG.length);
  });
});

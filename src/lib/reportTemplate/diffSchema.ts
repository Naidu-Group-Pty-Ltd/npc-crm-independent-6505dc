/**
 * Schema diff engine for ReportTemplate snapshots.
 * Pure, dependency-free, side-effect free.
 *
 * Produces a structured diff so the UI can render
 * page/block-level changes with affordances to drill in.
 */
import type { ReportTemplate } from './templateSchema';

export type ChangeKind = 'added' | 'removed' | 'modified' | 'unchanged';

export interface FieldChange {
  path: string;             // e.g. "title", "props.size"
  before: unknown;
  after: unknown;
}

export interface BlockDiff {
  id: string;
  kind: ChangeKind;
  type: string;             // block type for label (e.g. "text", "image")
  changes: FieldChange[];   // only populated when kind === 'modified'
}

export interface PageDiff {
  id: string;
  kind: ChangeKind;
  title: string;
  blockCountBefore: number;
  blockCountAfter: number;
  blocks: BlockDiff[];
  tokenChanges: FieldChange[]; // page-level token/master overrides if present
}

export interface TemplateDiff {
  // Top-level counters for badges
  summary: {
    pagesAdded: number;
    pagesRemoved: number;
    pagesModified: number;
    blocksAdded: number;
    blocksRemoved: number;
    blocksModified: number;
    tokenChanges: number;
  };
  tokenChanges: FieldChange[];
  pages: PageDiff[];
}

/** Stable stringify so deep-compare is order-independent on object keys. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`)
    .join(',')}}`;
}

function isEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Flatten an object into [path, value] tuples (skips arrays — treated as leaves). */
function flatten(obj: unknown, prefix = ''): Array<[string, unknown]> {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    return [[prefix, obj]];
  }
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatten(v, path));
    } else {
      out.push([path, v]);
    }
  }
  return out;
}

function diffObjects(before: unknown, after: unknown): FieldChange[] {
  const a = new Map(flatten(before));
  const b = new Map(flatten(after));
  const keys = new Set([...a.keys(), ...b.keys()]);
  const out: FieldChange[] = [];
  for (const k of keys) {
    const av = a.get(k);
    const bv = b.get(k);
    if (!isEqual(av, bv)) out.push({ path: k || '(root)', before: av, after: bv });
  }
  return out;
}

function indexBy<T extends { id?: string }>(arr: T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  (arr || []).forEach((x, i) => m.set(x.id || `__idx_${i}`, x));
  return m;
}

export function diffTemplates(before: ReportTemplate, after: ReportTemplate): TemplateDiff {
  const tokenChanges = diffObjects(before?.tokens ?? {}, after?.tokens ?? {});

  const beforePages = indexBy(before?.pages as any[]);
  const afterPages = indexBy(after?.pages as any[]);
  const allPageIds = new Set([...beforePages.keys(), ...afterPages.keys()]);

  const pages: PageDiff[] = [];
  const sum = {
    pagesAdded: 0,
    pagesRemoved: 0,
    pagesModified: 0,
    blocksAdded: 0,
    blocksRemoved: 0,
    blocksModified: 0,
    tokenChanges: tokenChanges.length,
  };

  for (const pid of allPageIds) {
    const bp = beforePages.get(pid) as any;
    const ap = afterPages.get(pid) as any;
    const title = (ap?.title || bp?.title || pid) as string;

    if (bp && !ap) {
      sum.pagesRemoved += 1;
      sum.blocksRemoved += (bp.blocks || []).length;
      pages.push({
        id: pid,
        kind: 'removed',
        title,
        blockCountBefore: (bp.blocks || []).length,
        blockCountAfter: 0,
        blocks: (bp.blocks || []).map((b: any) => ({
          id: b.id, kind: 'removed' as ChangeKind, type: b.type || '?', changes: [],
        })),
        tokenChanges: [],
      });
      continue;
    }
    if (!bp && ap) {
      sum.pagesAdded += 1;
      sum.blocksAdded += (ap.blocks || []).length;
      pages.push({
        id: pid,
        kind: 'added',
        title,
        blockCountBefore: 0,
        blockCountAfter: (ap.blocks || []).length,
        blocks: (ap.blocks || []).map((b: any) => ({
          id: b.id, kind: 'added' as ChangeKind, type: b.type || '?', changes: [],
        })),
        tokenChanges: [],
      });
      continue;
    }

    // Both present — diff blocks + page-level fields
    const beforeBlocks = indexBy<any>(bp.blocks);
    const afterBlocks = indexBy<any>(ap.blocks);
    const allBlockIds = new Set([...beforeBlocks.keys(), ...afterBlocks.keys()]);
    const blocks: BlockDiff[] = [];

    for (const bid of allBlockIds) {
      const bb = beforeBlocks.get(bid);
      const ab = afterBlocks.get(bid);
      if (bb && !ab) {
        sum.blocksRemoved += 1;
        blocks.push({ id: bid, kind: 'removed', type: bb.type || '?', changes: [] });
      } else if (!bb && ab) {
        sum.blocksAdded += 1;
        blocks.push({ id: bid, kind: 'added', type: ab.type || '?', changes: [] });
      } else if (bb && ab) {
        const changes = diffObjects(bb, ab);
        if (changes.length > 0) {
          sum.blocksModified += 1;
          blocks.push({ id: bid, kind: 'modified', type: ab.type || bb.type || '?', changes });
        } else {
          blocks.push({ id: bid, kind: 'unchanged', type: ab.type || '?', changes: [] });
        }
      }
    }

    // Page-level diff excluding blocks (handled above)
    const { blocks: _bb, ...bpRest } = bp;
    const { blocks: _ab, ...apRest } = ap;
    const pageFieldChanges = diffObjects(bpRest, apRest);

    const modified = pageFieldChanges.length > 0 || blocks.some((b) => b.kind !== 'unchanged');
    if (modified) sum.pagesModified += 1;

    pages.push({
      id: pid,
      kind: modified ? 'modified' : 'unchanged',
      title,
      blockCountBefore: (bp.blocks || []).length,
      blockCountAfter: (ap.blocks || []).length,
      blocks,
      tokenChanges: pageFieldChanges,
    });
  }

  // Sort: changed pages first, then unchanged
  pages.sort((a, b) => {
    const order: Record<ChangeKind, number> = { added: 0, modified: 1, removed: 2, unchanged: 3 };
    return order[a.kind] - order[b.kind];
  });

  return { summary: sum, tokenChanges, pages };
}

/** Single-line summary for headers/badges. */
export function summariseDiff(d: TemplateDiff): string {
  const s = d.summary;
  const parts: string[] = [];
  if (s.pagesAdded) parts.push(`+${s.pagesAdded} pages`);
  if (s.pagesRemoved) parts.push(`−${s.pagesRemoved} pages`);
  if (s.pagesModified) parts.push(`${s.pagesModified} pages changed`);
  if (s.blocksAdded) parts.push(`+${s.blocksAdded} blocks`);
  if (s.blocksRemoved) parts.push(`−${s.blocksRemoved} blocks`);
  if (s.blocksModified) parts.push(`${s.blocksModified} blocks edited`);
  if (s.tokenChanges) parts.push(`${s.tokenChanges} token changes`);
  return parts.length ? parts.join(' · ') : 'No changes';
}

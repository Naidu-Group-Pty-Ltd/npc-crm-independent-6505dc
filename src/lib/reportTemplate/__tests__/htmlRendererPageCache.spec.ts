/**
 * Rehaul Phase 3 — per-page section cache for document-scope renders.
 *
 * Correctness invariant: rendering with a (warm or cold) pageCache must be
 * byte-identical to rendering without one, across edits, reorders, and
 * cross-page-context changes. Reuse invariant: editing one page must keep the
 * other pages' cache entries live (same keys), so only the edited page
 * re-renders.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { makeBlankTemplate, type Block, type Page, type ReportTemplate } from '../templateSchema';

const blk = (id: string, text: string): Block =>
  ({
    id,
    type: 'free',
    props: {},
    overlays: [
      { id: `${id}-o`, type: 'text', x: 40, y: 40, width: 300, height: 60, content: text, fontSize: 12 },
    ],
  }) as unknown as Block;

const pg = (id: string, name: string, blocks: Block[]): Page =>
  ({
    id,
    name,
    size: { width: 595, height: 842 },
    background: {},
    blocks,
  }) as unknown as Page;

function makeDoc(): ReportTemplate {
  return {
    ...makeBlankTemplate(),
    pages: [
      pg('p1', 'Cover', [blk('b1', 'Hello page one')]),
      pg('p2', 'Body', [blk('b2', 'Hello page two')]),
      pg('p3', 'Appendix', [blk('b3', 'Hello page three')]),
    ],
  };
}

const data = { propertyAddress: '1 Example St' };

describe('renderTemplateToHtml pageCache', () => {
  it('cold cache renders byte-identical to no cache', () => {
    const doc = makeDoc();
    const plain = renderTemplateToHtml(doc, { data, editorMode: true });
    const cache = new Map<string, string>();
    const cached = renderTemplateToHtml(doc, { data, editorMode: true, pageCache: cache });
    expect(cached.html).toBe(plain.html);
    expect(cache.size).toBe(3);
  });

  it('warm cache render is byte-identical and reuses entries', () => {
    const doc = makeDoc();
    const cache = new Map<string, string>();
    renderTemplateToHtml(doc, { data, editorMode: true, pageCache: cache });
    const keysAfterFirst = new Set(cache.keys());

    const again = renderTemplateToHtml(doc, { data, editorMode: true, pageCache: cache });
    expect(again.html).toBe(renderTemplateToHtml(doc, { data, editorMode: true }).html);
    expect(new Set(cache.keys())).toEqual(keysAfterFirst);
  });

  it('editing one page re-renders only that page (other entries stay live)', () => {
    const doc = makeDoc();
    const cache = new Map<string, string>();
    renderTemplateToHtml(doc, { data, editorMode: true, pageCache: cache });
    const keysBefore = new Set(cache.keys());

    // Immutable edit of page 2 only (structural sharing for p1/p3).
    const edited: ReportTemplate = {
      ...doc,
      pages: doc.pages.map((p) =>
        p.id === 'p2' ? { ...p, blocks: [blk('b2', 'EDITED page two')] } : p,
      ),
    };
    const cachedRender = renderTemplateToHtml(edited, { data, editorMode: true, pageCache: cache });
    const freshRender = renderTemplateToHtml(edited, { data, editorMode: true });
    expect(cachedRender.html).toBe(freshRender.html);
    expect(cachedRender.html).toContain('EDITED page two');

    // p1 and p3 keys survived; p2's key was replaced; stale entry pruned.
    const keysAfter = new Set(cache.keys());
    const surviving = [...keysBefore].filter((k) => keysAfter.has(k));
    expect(surviving.length).toBe(2);
    expect(cache.size).toBe(3);
  });

  it('stays correct when pages are reordered (index is part of the key)', () => {
    const doc = makeDoc();
    const cache = new Map<string, string>();
    renderTemplateToHtml(doc, { data, editorMode: true, pageCache: cache });

    const reordered: ReportTemplate = { ...doc, pages: [doc.pages[1], doc.pages[0], doc.pages[2]] };
    const cachedRender = renderTemplateToHtml(reordered, { data, editorMode: true, pageCache: cache });
    const freshRender = renderTemplateToHtml(reordered, { data, editorMode: true });
    expect(cachedRender.html).toBe(freshRender.html);
  });

  it('invalidates when cross-page context changes (page added)', () => {
    const doc = makeDoc();
    const cache = new Map<string, string>();
    renderTemplateToHtml(doc, { data, editorMode: true, pageCache: cache });

    const grown: ReportTemplate = {
      ...doc,
      pages: [...doc.pages, pg('p4', 'Extra', [blk('b4', 'Hello page four')])],
    };
    const cachedRender = renderTemplateToHtml(grown, { data, editorMode: true, pageCache: cache });
    const freshRender = renderTemplateToHtml(grown, { data, editorMode: true });
    expect(cachedRender.html).toBe(freshRender.html);
  });

  it('invalidates when sample data changes', () => {
    const doc = makeDoc();
    const cache = new Map<string, string>();
    renderTemplateToHtml(doc, { data, editorMode: true, pageCache: cache });

    const newData = { propertyAddress: '2 Other Rd' };
    const cachedRender = renderTemplateToHtml(doc, { data: newData, editorMode: true, pageCache: cache });
    const freshRender = renderTemplateToHtml(doc, { data: newData, editorMode: true });
    expect(cachedRender.html).toBe(freshRender.html);
  });
});

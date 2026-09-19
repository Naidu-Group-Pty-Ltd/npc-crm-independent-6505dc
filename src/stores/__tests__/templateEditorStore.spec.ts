/**
 * templateEditorStore — contracts the editor relies on:
 *
 * 1. Action identities never change (memoized panels depend on this).
 * 2. Slice references stay stable when an unrelated part of the document
 *    changes (slice subscribers depend on this to skip re-renders).
 * 3. Page-scoped mutators always operate on the *current* active page via
 *    get() — no stale closures.
 * 4. History/undo/redo semantics survive the store migration (the
 *    useTemplateHistory spec covers the React-facing behavior).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetTemplateEditor, useTemplateEditorStore } from '@/stores/templateEditorStore';
import { makeBlankTemplate, type Block, type Overlay, type Page, type ReportTemplate } from '@/lib/reportTemplate/templateSchema';

function makeOverlay(id: string): Overlay {
  return {
    id,
    type: 'text',
    x: 10, y: 10, width: 100, height: 40, rotation: 0, opacity: 1,
    content: `overlay ${id}`,
  } as Overlay;
}

function makeBlock(id: string, overlays: Overlay[] = []): Block {
  return { id, type: 'text', props: {}, overlays };
}

function makePage(id: string, blocks: Block[] = [makeBlock(`${id}-b1`)]): Page {
  return {
    id,
    name: `Page ${id}`,
    size: { width: 595, height: 842 },
    blocks,
  } as Page;
}

function makeDoc(): ReportTemplate {
  return { ...makeBlankTemplate(), pages: [makePage('p1'), makePage('p2')] };
}

const store = () => useTemplateEditorStore.getState();

beforeEach(() => {
  resetTemplateEditor();
});

describe('templateEditorStore', () => {
  it('keeps every action identity-stable across edits', () => {
    const before = store();
    store().loadTemplate(makeDoc());
    store().setActivePageId('p1');
    store().addOverlayToActivePage(makeOverlay('o1'));
    store().undo();
    const after = store();
    for (const key of Object.keys(before) as Array<keyof typeof before>) {
      if (typeof before[key] === 'function') {
        expect(after[key]).toBe(before[key]);
      }
    }
  });

  it('keeps the pages slice reference stable across unrelated edits', () => {
    store().loadTemplate(makeDoc());
    const pagesBefore = store().template.pages;
    store().setTemplate((t) => ({ ...t, tokens: { ...t.tokens, colors: { primary: '#123456' } } as any }));
    expect(store().template.pages).toBe(pagesBefore);
  });

  it('routes page-scoped mutators through the current active page', () => {
    store().loadTemplate(makeDoc());
    store().setActivePageId('p2');
    store().addOverlayToActivePage(makeOverlay('o-new'));
    const doc = store().template;
    expect(doc.pages[1].blocks.some((b) => b.overlays.some((o) => o.id === 'o-new'))).toBe(true);
    expect(doc.pages[0].blocks.every((b) => b.overlays.length === 0)).toBe(true);
    // The new overlay is selected.
    expect(store().selectedOverlayId).toBe('o-new');
  });

  it('moves the active page pointer when the active page is deleted', () => {
    store().loadTemplate(makeDoc());
    store().setActivePageId('p2');
    store().deletePage('p2');
    expect(store().activePageId).toBe('p1');
  });

  it('supports additive multi-select via handleCanvasSelectOverlay', () => {
    store().loadTemplate(makeDoc());
    store().setActivePageId('p1');
    store().handleCanvasSelectOverlay('o1', false);
    expect(store().selectedOverlayId).toBe('o1');
    expect(store().multiOverlayIds.size).toBe(0);
    store().handleCanvasSelectOverlay('o2', true);
    expect(store().multiOverlayIds.has('o2')).toBe(true);
    store().handleCanvasSelectOverlay(null, false);
    expect(store().selectedOverlayId).toBeNull();
    expect(store().multiOverlayIds.size).toBe(0);
  });

  it('records history for setTemplate and supports undo/redo', () => {
    store().loadTemplate(makeDoc());
    store().setTemplate((t) => ({ ...t, name: 'renamed' }));
    expect(store().template.name).toBe('renamed');
    store().undo();
    expect(store().template.name).not.toBe('renamed');
    store().redo();
    expect(store().template.name).toBe('renamed');
  });

  it('blocks edits while governance-locked', () => {
    store().loadTemplate(makeDoc());
    store().setGovernanceReadOnly(true);
    store().setTemplate((t) => ({ ...t, name: 'should not apply' }));
    expect(store().template.name).not.toBe('should not apply');
    store().setGovernanceReadOnly(false);
    store().setTemplate((t) => ({ ...t, name: 'applies now' }));
    expect(store().template.name).toBe('applies now');
  });

  it('reset returns to a blank session', () => {
    store().loadTemplate(makeDoc());
    store().setActivePageId('p1');
    store().handleCanvasSelectOverlay('o1', false);
    resetTemplateEditor();
    expect(store().template.pages.length).toBeGreaterThanOrEqual(1);
    expect(store().activePageId).toBeNull();
    expect(store().selectedOverlayId).toBeNull();
    expect(store().multiOverlayIds.size).toBe(0);
    store().undo(); // history cleared — must be a no-op
  });
});

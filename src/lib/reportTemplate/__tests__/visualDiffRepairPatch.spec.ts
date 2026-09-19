/**
 * visual-diff-repair-patch-v1 (Path-to-100 v2 · C9).
 *
 * Pins the runtime allowlist that replaced the unsafe `patches as
 * TemplateImportPatch[]` cast, the dedicated single-page apply, and the
 * operator-triggered orchestrator. The non-negotiables: model output is
 * validated before it can touch a template; a repair is page-scoped; text
 * content is never invented or rewritten; a failure never mutates.
 */
import { describe, it, expect } from 'vitest';
import { parseTemplate, type ReportTemplate } from '../templateSchema';
import {
  validateVisualDiffRepairPatches,
  applyVisualDiffRepairPatch,
  filterWellFormedRepairPatches,
  buildVisualDiffRepairAudit,
  VISUAL_DIFF_REPAIR_PATCH_VERSION,
} from '../ingestion/reconciliation/visualDiffRepairPatch';
import { runVisualDiffRepairRequest } from '../ingestion/reconciliation/visualDiffRepairRequest';

function template(): ReportTemplate {
  return parseTemplate({
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [
      {
        id: 'p1', name: 'P1', size: { width: 595, height: 842 }, background: {},
        blocks: [{
          id: 'b1', type: 'free', props: {}, overlays: [
            { id: 'ov-text', type: 'text', x: 40, y: 40, width: 300, height: 40, content: 'Original Heading' },
            { id: 'ov-shape', type: 'shape', x: 10, y: 10, width: 80, height: 80, shape: 'rect', fill: '#000000' },
          ],
        }],
      },
      {
        id: 'p2', name: 'P2', size: { width: 595, height: 842 }, background: {},
        blocks: [{ id: 'b2', type: 'free', props: {}, overlays: [{ id: 'ov-2', type: 'text', x: 0, y: 0, width: 100, height: 20, content: 'Page 2' }] }],
      },
    ],
  });
}

describe('validateVisualDiffRepairPatches — page-scoped allowlist', () => {
  it('accepts a geometry-only updateOverlay on the requested page', () => {
    const res = validateVisualDiffRepairPatches(
      [{ operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'ov-text', changes: { x: 50, y: 60 } }],
      { pageId: 'p1' },
    );
    expect(res.version).toBe(VISUAL_DIFF_REPAIR_PATCH_VERSION);
    expect(res.valid).toHaveLength(1);
    expect(res.rejected).toHaveLength(0);
  });

  it('rejects an unknown / malformed operation', () => {
    const res = validateVisualDiffRepairPatches([{ operation: 'deletePage', pageId: 'p1' }, { foo: 1 }], { pageId: 'p1' });
    expect(res.valid).toHaveLength(0);
    expect(res.rejected).toHaveLength(2);
    expect(res.rejected[0].reason).toMatch(/unknown or malformed/);
  });

  it('rejects a cross-page patch', () => {
    const res = validateVisualDiffRepairPatches(
      [{ operation: 'removeOverlay', pageId: 'p2', blockId: 'b2', overlayId: 'ov-2', reason: 'x' }],
      { pageId: 'p1' },
    );
    expect(res.valid).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/cross-page/);
  });

  it('rejects a text-content edit', () => {
    const res = validateVisualDiffRepairPatches(
      [{ operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'ov-text', changes: { content: 'Rewritten' } }],
      { pageId: 'p1' },
    );
    expect(res.valid).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/text-content/);
  });

  it.each([
    ['runs', { runs: [{ text: 'AI-invented visible text' }] }],
    ['rich', { rich: true }],
  ])('rejects an alternate text-rendering edit through %s', (_field, changes) => {
    const res = validateVisualDiffRepairPatches(
      [{ operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'ov-text', changes }],
      { pageId: 'p1' },
    );
    expect(res.valid).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/text-content/);
  });

  it('rejects adding a text overlay (invented text content)', () => {
    const res = validateVisualDiffRepairPatches(
      [{ operation: 'addOverlay', pageId: 'p1', blockId: 'b1', overlay: { id: 'x', type: 'text', x: 0, y: 0, width: 10, height: 10, content: 'New' } }],
      { pageId: 'p1' },
    );
    expect(res.valid).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/text overlays/);
  });

  it('enforces the per-request operation cap', () => {
    const patches = Array.from({ length: 5 }, () => ({ operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'ov-shape', changes: { x: 1 } }));
    const res = validateVisualDiffRepairPatches(patches, { pageId: 'p1', maxOperations: 2 });
    expect(res.valid).toHaveLength(2);
    expect(res.rejected).toHaveLength(3);
    expect(res.rejected[0].reason).toMatch(/max 2 operations/);
  });

  it('rejects a non-array payload', () => {
    const res = validateVisualDiffRepairPatches({ operation: 'updateOverlay' }, { pageId: 'p1' });
    expect(res.valid).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/not an array/);
  });
});

describe('applyVisualDiffRepairPatch — single-page, content-preserving', () => {
  it('applies geometry to the target page only and preserves text content + other pages', () => {
    const t = template();
    const res = applyVisualDiffRepairPatch(t, 'p1', [
      { operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'ov-text', changes: { x: 99, content: 'HACKED' } },
    ], {});
    // The content field in `changes` is refused at validation → nothing applied.
    expect(res.applied).toBe(0);
    expect(res.changed).toBe(false);

    const ok = applyVisualDiffRepairPatch(t, 'p1', [
      { operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'ov-text', changes: { x: 99 } },
    ], {});
    expect(ok.applied).toBe(1);
    expect(ok.changed).toBe(true);
    const ov = ok.template.pages[0].blocks[0].overlays!.find((o: any) => o.id === 'ov-text') as any;
    expect(ov.x).toBe(99);
    expect(ov.content).toBe('Original Heading'); // content preserved
    // Page 2 is byte-identical.
    expect(JSON.stringify(ok.template.pages[1])).toBe(JSON.stringify(t.pages[1]));
  });

  it.each([
    ['runs', { runs: [{ text: 'AI-invented visible text' }] }],
    ['rich', { rich: true }],
  ])('does not apply a text-rendering change through %s', (_field, changes) => {
    const t = template();
    const res = applyVisualDiffRepairPatch(t, 'p1', [
      { operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'ov-text', changes },
    ]);

    expect(res.applied).toBe(0);
    expect(res.changed).toBe(false);
    expect(res.template).toBe(t);
  });

  it('adds a shape overlay and removes an overlay on the target page', () => {
    const t = template();
    const added = applyVisualDiffRepairPatch(t, 'p1', [
      { operation: 'addOverlay', pageId: 'p1', blockId: 'b1', overlay: { id: 'ov-new', type: 'shape', x: 5, y: 5, width: 20, height: 20, shape: 'ellipse' } },
    ], {});
    expect(added.applied).toBe(1);
    expect(added.template.pages[0].blocks[0].overlays!.some((o: any) => o.id === 'ov-new')).toBe(true);

    const removed = applyVisualDiffRepairPatch(t, 'p1', [
      { operation: 'removeOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'ov-shape', reason: 'duplicate' },
    ], {});
    expect(removed.template.pages[0].blocks[0].overlays!.some((o: any) => o.id === 'ov-shape')).toBe(false);
  });

  it('rejects unknown block/overlay ids and does not mutate the input', () => {
    const t = template();
    const res = applyVisualDiffRepairPatch(t, 'p1', [
      { operation: 'updateOverlay', pageId: 'p1', blockId: 'nope', overlayId: 'ov-text', changes: { x: 1 } },
    ], {});
    expect(res.applied).toBe(0);
    expect(res.rejected[0].reason).toMatch(/unknown block/);
    expect(res.template).toBe(t); // unchanged reference on zero applied
    expect((t.pages[0].blocks[0].overlays![0] as any).x).toBe(40);
  });

  it('reports page_not_found for a missing page', () => {
    const res = applyVisualDiffRepairPatch(template(), 'missing', [
      { operation: 'updateOverlay', pageId: 'missing', blockId: 'b1', overlayId: 'ov', changes: { x: 1 } },
    ], {});
    expect(res.applied).toBe(0);
    expect(res.rejected.some((r) => /page missing not found/.test(r.reason))).toBe(true);
  });
});

describe('filterWellFormedRepairPatches (legacy document path)', () => {
  it('keeps well-formed patches and drops malformed / text edits', () => {
    const out = filterWellFormedRepairPatches([
      { operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'o', changes: { x: 1 } },
      { operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'o', changes: { content: 'x' } },
      { operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'o', changes: { runs: [{ text: 'x' }] } },
      { operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'o', changes: { rich: true } },
      { operation: 'nonsense' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].operation).toBe('updateOverlay');
  });

  it('returns [] for a non-array', () => {
    expect(filterWellFormedRepairPatches(null)).toEqual([]);
  });
});

describe('buildVisualDiffRepairAudit — metadata only', () => {
  it('records operation metadata and counts, never overlay content', () => {
    const t = template();
    const applied = applyVisualDiffRepairPatch(t, 'p1', [
      { operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'ov-shape', changes: { x: 12 } },
    ], {});
    const audit = buildVisualDiffRepairAudit(applied, { requestedOperations: 3, decidedAt: 'T' });
    expect(audit).toMatchObject({
      version: VISUAL_DIFF_REPAIR_PATCH_VERSION,
      pageId: 'p1',
      requestedOperations: 3,
      appliedOperations: 1,
      decidedBy: 'operator',
      decidedAt: 'T',
    });
    expect(audit.operations).toEqual([{ operation: 'updateOverlay', blockId: 'b1', overlayId: 'ov-shape' }]);
    expect(JSON.stringify(audit)).not.toContain('Original Heading');
  });
});

describe('runVisualDiffRepairRequest — operator orchestration, fail-open', () => {
  it('fetches, validates, and applies patches to the single page', async () => {
    const t = template();
    const res = await runVisualDiffRepairRequest({
      template: t,
      context: { pageId: 'p1' },
      fetchPatches: async () => [{ operation: 'updateOverlay', pageId: 'p1', blockId: 'b1', overlayId: 'ov-shape', changes: { x: 33 } }],
      now: () => new Date('2026-07-17T00:00:00Z'),
    });
    expect(res.changed).toBe(true);
    expect(res.applied).toBe(1);
    expect(res.requestedOperations).toBe(1);
    expect(res.audit.decidedAt).toBe('2026-07-17T00:00:00.000Z');
  });

  it('is fail-open: a fetch error returns the original template unchanged + an error', async () => {
    const t = template();
    const res = await runVisualDiffRepairRequest({
      template: t,
      context: { pageId: 'p1' },
      fetchPatches: async () => { throw new Error('agent 500'); },
    });
    expect(res.changed).toBe(false);
    expect(res.applied).toBe(0);
    expect(res.template).toBe(t);
    expect(res.error).toBe('agent 500');
  });

  it('drops a cross-page patch even when the fetcher returns one', async () => {
    const res = await runVisualDiffRepairRequest({
      template: template(),
      context: { pageId: 'p1' },
      fetchPatches: async () => [{ operation: 'removeOverlay', pageId: 'p2', blockId: 'b2', overlayId: 'ov-2', reason: 'x' }],
    });
    expect(res.applied).toBe(0);
    expect(res.rejected[0].reason).toMatch(/cross-page/);
  });
});

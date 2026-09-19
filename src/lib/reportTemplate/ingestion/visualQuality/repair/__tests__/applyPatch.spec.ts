import { describe, expect, it } from 'vitest';
import { CdirDocumentSchema, type CdirDocument } from '@/lib/reportTemplate/ingestion/cdir/schema';
import { applyPatch } from '../applyPatch';
import type { RepairPatch } from '../repairTypes';

function cdir(): CdirDocument {
  return CdirDocumentSchema.parse({
    version: 1,
    source: { kind: 'pdf', checksum: 'sha256:patch', filename: 'patch.pdf' },
    pages: [{
      id: 'page-1',
      label: 'Page 1',
      width: 595,
      height: 842,
      layers: [{
        id: 'text-1',
        kind: 'text',
        bounds: { x: 10, y: 10, width: 100, height: 20 },
        text: 'old text',
        runs: [{ text: 'old text', fontSize: 12 }],
      }],
    }],
  });
}

function patch(ops: RepairPatch['ops']): RepairPatch {
  return { pageId: 'page-1', ops, rationale: 'regression test', source: 'manual' };
}

describe('applyPatch text consistency', () => {
  it('keeps canonical text synchronized when replacing text', () => {
    const result = applyPatch(cdir(), patch([{
      kind: 'replace_text',
      pageId: 'page-1',
      layerId: 'text-1',
      text: 'new text',
    }]));

    const parsed = CdirDocumentSchema.parse(result.doc);
    const layer = parsed.pages[0].layers[0];
    expect(layer).toMatchObject({
      kind: 'text',
      text: 'new text',
      runs: [{ text: 'new text', fontSize: 12 }],
    });
  });

  it('creates schema-valid appended text layers with canonical text', () => {
    const result = applyPatch(cdir(), patch([{
      kind: 'append_text_layer',
      pageId: 'page-1',
      layer: {
        id: 'text-2',
        bounds: { x: 10, y: 40, width: 100, height: 20 },
        text: 'appended text',
        fontSize: 12,
        color: '#000000',
      },
    }]));

    const parsed = CdirDocumentSchema.parse(result.doc);
    expect(parsed.pages[0].layers[1]).toMatchObject({
      id: 'text-2',
      kind: 'text',
      text: 'appended text',
      runs: [{ text: 'appended text', fontSize: 12, color: '#000000' }],
    });
  });
});

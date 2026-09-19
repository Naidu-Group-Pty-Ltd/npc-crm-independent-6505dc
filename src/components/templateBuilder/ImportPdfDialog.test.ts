import { describe, expect, it } from 'vitest';
import { importProgressPercent } from './ImportPdfDialog';

describe('importProgressPercent', () => {
  it('reports completion when the final update only includes the total page count', () => {
    expect(importProgressPercent({ phase: 'done', totalPages: 4 })).toBe(100);
  });

  it('keeps in-progress page updates below completion', () => {
    expect(importProgressPercent({ phase: 'rasterizing', pagesCompleted: 4, pagesTotal: 4 })).toBe(95);
  });
});

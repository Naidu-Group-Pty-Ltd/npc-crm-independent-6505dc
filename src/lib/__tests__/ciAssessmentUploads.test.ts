/**
 * Folding an assessment's provenance into a list of documents.
 *
 * The tab this feeds answers "what did we get from the client, and how much of
 * the assessment came out of it". The rules that make that answer true rather
 * than merely plausible are what this covers.
 */

import { describe, expect, it } from 'vitest';
import { summariseUploads } from '../../../supabase/functions/_shared/ciAssessments/uploads.pure';

const entry = (over: Record<string, unknown> = {}) => ({
  field: 'property.address',
  source: 'document_import',
  sourceRef: 'Intake pack workbook',
  requiresConfirmation: true,
  capturedAt: '2026-08-04T22:00:00.000Z',
  ...over,
});

describe('summariseUploads', () => {
  it('gives one row per document, counting the fields it filled', () => {
    const rows = summariseUploads('a1', [entry(), entry({ field: 'property.purchasePrice' }), entry({ field: 'loan.rate' })]);
    expect(rows).toEqual([{
      assessmentId: 'a1',
      name: 'Intake pack workbook',
      source: 'document_import',
      fields: 3,
      capturedAt: '2026-08-04T22:00:00.000Z',
    }]);
  });

  it('leaves out what was typed or derived — neither is a document', () => {
    const rows = summariseUploads('a1', [
      entry({ source: 'manual', sourceRef: undefined }),
      entry({ source: 'calculated', sourceRef: 'engine' }),
      entry(),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Intake pack workbook');
  });

  it('keeps documents read by different importers apart', () => {
    const rows = summariseUploads('a1', [
      entry({ sourceRef: '15 Foundry Way' }),
      entry({ sourceRef: '15 Foundry Way', source: 'url_import' }),
    ]);
    expect(rows.map((row) => row.source)).toEqual(['document_import', 'url_import']);
  });

  it('reports the latest read, not the first', () => {
    const rows = summariseUploads('a1', [
      entry({ capturedAt: '2026-08-04T22:00:00.000Z' }),
      entry({ capturedAt: '2026-08-06T09:15:00.000Z' }),
      entry({ capturedAt: '2026-08-05T10:00:00.000Z' }),
    ]);
    expect(rows[0].capturedAt).toBe('2026-08-06T09:15:00.000Z');
  });

  it('names an import that recorded no file rather than dropping it', () => {
    // Under-reporting the import would be the worse error: the values are in
    // the assessment either way.
    const rows = summariseUploads('a1', [entry({ sourceRef: '   ' })]);
    expect(rows[0].name).toBe('Imported document');
    expect(rows[0].fields).toBe(1);
  });

  it('survives a payload with no provenance at all', () => {
    expect(summariseUploads('a1', undefined)).toEqual([]);
    expect(summariseUploads('a1', null)).toEqual([]);
    expect(summariseUploads('a1', 'not an array')).toEqual([]);
    expect(summariseUploads('a1', [null, 42, 'x'])).toEqual([]);
  });

  it('bounds a hostile file name rather than passing it through', () => {
    const rows = summariseUploads('a1', [entry({ sourceRef: 'x'.repeat(5000) })]);
    expect(rows[0].name).toHaveLength(200);
  });
});

import { describe, it, expect } from 'vitest';
import { detectReferenceKind, validateReconstructedSchema, describeFidelityMode } from '../referenceImport';

describe('detectReferenceKind', () => {
  it('detects PDFs by MIME or extension', () => {
    expect(detectReferenceKind({ type: 'application/pdf' })).toBe('pdf');
    expect(detectReferenceKind({ name: 'Report.PDF' })).toBe('pdf');
  });

  it('detects images by MIME or extension', () => {
    expect(detectReferenceKind({ type: 'image/png' })).toBe('image');
    expect(detectReferenceKind({ name: 'shot.jpeg' })).toBe('image');
    expect(detectReferenceKind({ name: 'logo.webp' })).toBe('image');
  });

  it('returns unsupported for other files and null', () => {
    expect(detectReferenceKind({ name: 'data.csv', type: 'text/csv' })).toBe('unsupported');
    expect(detectReferenceKind(null)).toBe('unsupported');
    expect(detectReferenceKind(undefined)).toBe('unsupported');
  });
});

describe('validateReconstructedSchema', () => {
  it('accepts a schema with at least one well-formed page', () => {
    const v = validateReconstructedSchema({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{ id: 'p', name: 'P', size: { width: 595, height: 842 }, background: {}, blocks: [] }],
    });
    expect(v.ok).toBe(true);
    expect(v.pageCount).toBe(1);
    expect(v.errors).toHaveLength(0);
  });

  it('rejects a reconstruction with no pages', () => {
    const v = validateReconstructedSchema({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [],
    });
    expect(v.ok).toBe(false);
    expect(v.pageCount).toBe(0);
    expect(v.errors.join(' ')).toMatch(/no pages/i);
  });
});

describe('describeFidelityMode', () => {
  it('describes known modes and is empty for unknown', () => {
    expect(describeFidelityMode('hybrid')).toMatch(/editable/i);
    expect(describeFidelityMode('pixel')).toMatch(/raster/i);
    expect(describeFidelityMode('nope')).toBe('');
  });
});
